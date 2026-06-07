/**
 * Alert runner — the orchestration heart of the Slack Alerts feature (Plan 4).
 *
 * Two entry points:
 *   - `runAlerts(now, opts?)`  — full cron tick: every site × every enabled
 *     condition, then the network-scoped reminders.
 *   - `runAfterRun(domain, now)` — a thin variant fired right after a
 *     generation run for a single site; re-checks only the two conditions a
 *     run can move (failed_articles, in_review).
 *
 * Persist-on-success rule (the core invariant):
 * ─────────────────────────────────────────────
 * The pure `evaluateCondition` engine stamps `lastFiredAt = now` into
 * `newState` whenever it returns `shouldFire`. This runner persists that
 * `newState` ONLY after `notifyAttention` resolves `true`. On a failed send we
 * persist NOTHING — the old state is left untouched so the next tick re-reads
 * it, re-fires, and `lastFiredAt` is never advanced by a failed send. When the
 * condition is NOT firing (recovery / steady-state), we always persist so
 * recovery clears the status and `lastValue` stays fresh; that path never
 * advances `lastFiredAt`.
 */

import type { Db } from "mongodb";
import { getMongoDb } from "../lib/mongo.js";
import { loadConfig } from "../lib/config.js";
import { createOctokit, readFile } from "../lib/github.js";
import { listActiveSites } from "../lib/site-brief.js";
import { notifyAttention, type NotificationConfig } from "../lib/notifications.js";
import { gatherInputs, type AlertInputs } from "./inputs.js";
import { loadAlertConfig, type AlertConfig } from "./config.js";
import { evaluateCondition } from "./engine.js";
import type { AlertState, ConditionId, EvalInput, FirePolicy } from "./types.js";

const COLLECTION = "alert_state";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunAlertsOptions {
  /** Scope the run to a single site (used by runAfterRun). */
  onlySite?: string;
}

/** A condition to evaluate for one site: its input + the message to send. */
interface ConditionPlan {
  conditionId: ConditionId;
  input: EvalInput;
  message: string;
}

/** Fresh "ok" default state for an absent _id. */
function defaultState(id: string): AlertState {
  return {
    _id: id,
    status: "ok",
    firstDetectedAt: null,
    lastFiredAt: null,
    lastValue: null,
  };
}

/**
 * Build the list of condition plans for a site from its inputs + config.
 * Only ENABLED conditions are included (skips when `cfg.enabled` is false or
 * the per-condition `enabled` flag is false). `imageGenFailed` is intentionally
 * not a runner condition.
 */
function planConditions(
  domain: string,
  inputs: AlertInputs,
  cfg: AlertConfig,
  only?: ReadonlySet<ConditionId>,
): ConditionPlan[] {
  const plans: ConditionPlan[] = [];
  if (!cfg.enabled) return plans;

  const want = (id: ConditionId): boolean => !only || only.has(id);

  if (want("failed_articles") && cfg.failedArticles.enabled) {
    plans.push({
      conditionId: "failed_articles",
      input: {
        alerting: inputs.failedArticles7d > cfg.failedArticles.limit,
        value: inputs.failedArticles7d,
        policy: "transition_then_daily" as FirePolicy,
      },
      message: `⚠ ${domain}: ${inputs.failedArticles7d} failed articles in 7d (limit ${cfg.failedArticles.limit})`,
    });
  }

  if (want("sync_failed") && cfg.syncFailed.enabled) {
    plans.push({
      conditionId: "sync_failed",
      input: {
        alerting: inputs.syncOk === false,
        value: null,
        policy: "transition_only" as FirePolicy,
      },
      message: `🔴 ${domain}: content sync failed — visitors see old content`,
    });
  }

  if (want("in_review") && cfg.inReview.enabled) {
    plans.push({
      conditionId: "in_review",
      input: {
        alerting: inputs.reviewCount > cfg.inReview.limit,
        value: inputs.reviewCount,
        policy: "transition_only" as FirePolicy,
      },
      message: `⚠ ${domain}: ${inputs.reviewCount} articles in review (limit ${cfg.inReview.limit})`,
    });
  }

  if (want("tracking_off") && cfg.trackingOff.enabled) {
    plans.push({
      conditionId: "tracking_off",
      input: {
        alerting: inputs.trackingOff,
        value: null,
        policy: "transition_only" as FirePolicy,
      },
      message: `⚠ ${domain}: analytics/pixel not firing`,
    });
  }

  return plans;
}

/** Upsert a full alert-state document by its `_id`. */
async function upsertState(db: Db, state: AlertState): Promise<void> {
  await db
    .collection<AlertState>(COLLECTION)
    .replaceOne({ _id: state._id }, state, { upsert: true });
}

/**
 * Core per-(site,condition) routine.
 *
 * 1. Load current state (or a fresh ok-state default).
 * 2. Evaluate via the pure engine.
 * 3. If shouldFire: send; persist newState ONLY on a successful send.
 * 4. If !shouldFire: always persist newState (recovery clear + lastValue).
 *
 * Failure-isolated: any error is logged and swallowed so one condition never
 * aborts the rest of the run.
 */
export async function evaluateAndMaybeFire(
  db: Db,
  domain: string,
  conditionId: ConditionId,
  input: EvalInput,
  message: string,
  now: Date,
  notifConfig: NotificationConfig,
): Promise<void> {
  const id = `${domain}:${conditionId}`;
  try {
    const existing = await db
      .collection<AlertState>(COLLECTION)
      .findOne({ _id: id });
    const state = existing ?? defaultState(id);

    const { newState, shouldFire } = evaluateCondition(state, input, now);

    if (shouldFire) {
      const ok = await notifyAttention(notifConfig, message);
      if (ok) {
        // Persist ONLY on a successful send — this is where lastFiredAt advances.
        await upsertState(db, newState);
      }
      // On failure: persist nothing, leaving old state intact so it retries.
      return;
    }

    // Not firing: persist recovery / steady-state (never advances lastFiredAt).
    await upsertState(db, newState);
  } catch (err) {
    console.error(`[alerts/run] ${id} evaluation failed:`, err);
  }
}

/**
 * Fire a network-scoped reminder if `shouldFire`, persisting `lastFiredAt=now`
 * on a successful send only. Failure-isolated.
 */
async function maybeFireReminder(
  db: Db,
  reminderId: string,
  shouldFire: boolean,
  state: AlertState,
  message: string,
  now: Date,
  notifConfig: NotificationConfig,
): Promise<void> {
  if (!shouldFire) return;
  try {
    const ok = await notifyAttention(notifConfig, message);
    if (ok) {
      await upsertState(db, { ...state, lastFiredAt: now });
    }
  } catch (err) {
    console.error(`[alerts/run] reminder ${reminderId} failed:`, err);
  }
}

/** Same UTC calendar date? */
function sameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

async function loadReminderState(db: Db, id: string): Promise<AlertState> {
  const existing = await db
    .collection<AlertState>(COLLECTION)
    .findOne({ _id: id });
  return existing ?? defaultState(id);
}

/**
 * Full alert tick. Never throws out of the cron — Mongo unavailable or any
 * setup failure is logged and the run returns cleanly.
 */
export async function runAlerts(
  now: Date,
  opts?: RunAlertsOptions,
): Promise<void> {
  const config = loadConfig();
  const notifConfig: NotificationConfig = config.notifications;

  const cfg = await loadAlertConfig(() =>
    readFile(createOctokit(config.github), config.networkRepo, "scheduler/alerts.yaml"),
  );
  if (!cfg.enabled) return;

  let db: Db;
  try {
    db = await getMongoDb();
  } catch (err) {
    console.error("[alerts/run] Mongo unavailable, skipping run:", err);
    return;
  }

  let sites: Array<{ domain: string }>;
  try {
    sites = await listActiveSites(createOctokit(config.github), config.networkRepo);
  } catch (err) {
    console.error("[alerts/run] failed to list sites:", err);
    return;
  }

  if (opts?.onlySite) {
    sites = sites.filter((s) => s.domain === opts.onlySite);
  }

  let totalReviewCount = 0;

  for (const site of sites) {
    const { domain } = site;
    try {
      const inputs = await gatherInputs(domain, now);
      totalReviewCount += inputs.reviewCount;

      const plans = planConditions(domain, inputs, cfg);
      for (const plan of plans) {
        await evaluateAndMaybeFire(
          db,
          domain,
          plan.conditionId,
          plan.input,
          plan.message,
          now,
          notifConfig,
        );
      }
    } catch (err) {
      console.error(`[alerts/run] site ${domain} failed:`, err);
    }
  }

  // Reminders are network-scoped — only run on a full (non-scoped) tick.
  if (opts?.onlySite) return;

  await runReminders(db, cfg, totalReviewCount, now, notifConfig);
}

/**
 * Network-scoped reminders, evaluated after the site loop.
 * Each is independently failure-isolated.
 */
async function runReminders(
  db: Db,
  cfg: AlertConfig,
  totalReviewCount: number,
  now: Date,
  notifConfig: NotificationConfig,
): Promise<void> {
  // review_backlog — fire on its UTC weekday, at most once per UTC day.
  if (cfg.reminders.reviewBacklog.enabled) {
    try {
      const state = await loadReminderState(db, "__network__:review_backlog");
      const isWeekday = now.getUTCDay() === cfg.reminders.reviewBacklog.weekday;
      const alreadyFiredToday =
        state.lastFiredAt != null && sameUtcDate(state.lastFiredAt, now);
      const shouldFire = isWeekday && !alreadyFiredToday;
      await maybeFireReminder(
        db,
        "review_backlog",
        shouldFire,
        state,
        `${totalReviewCount} articles waiting for review across the network`,
        now,
        notifConfig,
      );
    } catch (err) {
      console.error("[alerts/run] review_backlog reminder failed:", err);
    }
  }

  // create_new_site — fire every `everyDays` interval.
  if (cfg.reminders.createNewSite.enabled) {
    try {
      const state = await loadReminderState(db, "__network__:create_new_site");
      const intervalMs = cfg.reminders.createNewSite.everyDays * DAY_MS;
      const shouldFire =
        state.lastFiredAt == null ||
        now.getTime() - state.lastFiredAt.getTime() >= intervalMs;
      await maybeFireReminder(
        db,
        "create_new_site",
        shouldFire,
        state,
        `Time to create a new site`,
        now,
        notifConfig,
      );
    } catch (err) {
      console.error("[alerts/run] create_new_site reminder failed:", err);
    }
  }
}

/**
 * Post-generation-run variant: a generation run changes failed_articles and
 * in_review, so re-evaluate ONLY those two conditions for the single domain.
 * Reuses the same config load + persist-on-success machinery. Failure-isolated.
 */
export async function runAfterRun(domain: string, now: Date): Promise<void> {
  const config = loadConfig();
  const notifConfig: NotificationConfig = config.notifications;

  const cfg = await loadAlertConfig(() =>
    readFile(createOctokit(config.github), config.networkRepo, "scheduler/alerts.yaml"),
  );
  if (!cfg.enabled) return;

  let db: Db;
  try {
    db = await getMongoDb();
  } catch (err) {
    console.error("[alerts/run] Mongo unavailable, skipping runAfterRun:", err);
    return;
  }

  try {
    const inputs = await gatherInputs(domain, now);
    const only = new Set<ConditionId>(["failed_articles", "in_review"]);
    const plans = planConditions(domain, inputs, cfg, only);
    for (const plan of plans) {
      await evaluateAndMaybeFire(
        db,
        domain,
        plan.conditionId,
        plan.input,
        plan.message,
        now,
        notifConfig,
      );
    }
  } catch (err) {
    console.error(`[alerts/run] runAfterRun ${domain} failed:`, err);
  }
}
