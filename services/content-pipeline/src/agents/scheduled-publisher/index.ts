/**
 * Scheduled Publisher Agent
 *
 * Called by the CloudGrid cron job via HTTP. On each tick:
 * 1. Read global scheduler config from network repo (scheduler/config.yaml).
 *    Skip early unless enabled and current hour ∈ run_at_hours (or force=true).
 * 2. Queue path (production): enqueue one `scheduler-plan` job for the hour and
 *    return. The plan worker (`planSchedulerRun`) lists sites, reads each
 *    site.yaml, keeps the sites due today and creates the scheduler-run flow.
 *    Keeping per-site work out of the request is what lets the cron stay fast
 *    as the network grows (see the 2026-11 outage in docs/superpowers/specs).
 * 3. Direct path (no queue, local dev): same per-site checks inline, then
 *    trigger ContentGenerationAgent with count = articles_per_day
 *    (fallback: ceil(articles_per_week / preferred_days.length)).
 *
 * Global hour gating lives in the network repo so schedule changes don't
 * require a platform redeploy. CloudGrid cron fires hourly; most ticks are
 * no-ops that return in ~50ms.
 */

import { parse as parseYaml } from "yaml";
import { createOctokit, readFile } from "../../lib/github.js";
import { listActiveSites, readSiteBriefWithFallback } from "../../lib/site-brief.js";
import type { SiteBriefData } from "../../lib/site-brief.js";
import { runContentGeneration } from "../content-generation/agent.js";
import { recordGeneration } from "../../stats/recorder.js";
import { runAfterRun } from "../../alerts/run.js";
import { buildScheduleFromBrief } from "../../stats/schedule.js";
import { processWithConcurrency } from "../../lib/concurrency.js";
import type { AgentConfig } from "../../lib/config.js";
import type { PublishSchedule } from "../../types.js";
import { RunHistoryAccumulator } from "./history.js";
import type { SiteRunResult } from "./history.js";
import { createSchedulerFlow, buildRunId, shouldAutoPublish, autoPublishSite } from "../../queue/scheduler-flow.js";
import type { SchedulerSite } from "../../queue/scheduler-flow.js";
import type { QueueInstances } from "../../queue/index.js";
import type { FlowProducer, JobsOptions } from "bullmq";
import { SCHEDULER_PLAN_QUEUE, SCHEDULER_PLAN_JOB_OPTIONS } from "../../queue/types.js";
import type { SchedulerPlanData } from "../../queue/types.js";
import { notifyError, notifySummary } from "../../lib/notifications.js";
import { updateWeeklySummary } from "../../stats/weekly-summary.js";

const SCHEDULER_CONFIG_PATH = "scheduler/config.yaml";

/**
 * Map common timezone abbreviations to IANA names so Intl correctly
 * handles DST transitions. CloudGrid cron supports UTC, EST, PST —
 * without this map, "EST" resolves to fixed UTC-5 (no DST) and the
 * scheduler is off by 1 hour during summer (EDT).
 */
export const TIMEZONE_MAP: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
};

/** Resolve an abbreviation like "EST" to its IANA name, or pass through. */
export function resolveTimezone(tz: string): string {
  return TIMEZONE_MAP[tz.toUpperCase()] ?? tz;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  run_at_hours: [14],
  timezone: "EST",
};

export interface SchedulerConfig {
  enabled: boolean;
  run_at_hours: number[];
  timezone: string;
}

export interface ScheduledPublishResult {
  status: "ok";
  configStatus: "ok" | "defaults" | "fetch_error";
  skippedGlobal?: "disabled" | "hour_not_matched" | "fetch_error";
  triggered: string[];
  skipped: Array<{ domain: string; reason: string }>;
  errors: Array<{ domain: string; error: string }>;
  /** Queue path: the run was handed to a background planning job. */
  queued?: boolean;
  /** Queue path: a planning job for this hour already exists — nothing new was enqueued. */
  alreadyQueued?: boolean;
  /** Queue path: hourly run id (matches the scheduler-run flow and history entry). */
  runId?: string;
}

/** Read the scheduler config from the network repo. 404 → defaults. */
async function readSchedulerConfig(
  config: AgentConfig,
): Promise<{ config: SchedulerConfig; status: "ok" | "defaults" | "fetch_error" }> {
  const octokit = createOctokit(config.github);
  try {
    const raw = await readFile(octokit, config.networkRepo, SCHEDULER_CONFIG_PATH);
    const parsed = parseYaml(raw) as Partial<SchedulerConfig> | null;
    return {
      config: {
        enabled: parsed?.enabled ?? DEFAULT_SCHEDULER_CONFIG.enabled,
        run_at_hours:
          Array.isArray(parsed?.run_at_hours) && parsed!.run_at_hours!.length > 0
            ? parsed!.run_at_hours!
            : DEFAULT_SCHEDULER_CONFIG.run_at_hours,
        timezone: parsed?.timezone ?? DEFAULT_SCHEDULER_CONFIG.timezone,
      },
      status: "ok",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 404 = file doesn't exist yet → fall back to defaults
    if (/Not Found|404/.test(message)) {
      return { config: DEFAULT_SCHEDULER_CONFIG, status: "defaults" };
    }
    console.error("[scheduled-publisher] Failed to read scheduler config:", message);
    return { config: DEFAULT_SCHEDULER_CONFIG, status: "fetch_error" };
  }
}

/** Current hour (0-23) in a given IANA or abbreviated timezone. */
export function currentHourInTimezone(timezone: string): number {
  try {
    const resolved = resolveTimezone(timezone);
    const hour = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: resolved,
    }).format(new Date());
    const n = parseInt(hour, 10);
    return isNaN(n) ? new Date().getHours() : n;
  } catch {
    return new Date().getHours();
  }
}

/** Current day-of-week name in a given timezone. */
export function currentDayNameInTimezone(timezone: string): string {
  try {
    const resolved = resolveTimezone(timezone);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: resolved,
    }).format(new Date());
  } catch {
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return DAY_NAMES[new Date().getDay()]!;
  }
}

/** If preferred_days is empty, any day is valid. */
export function isTodayPreferredDay(schedule: PublishSchedule, timezone: string): boolean {
  if (!schedule.preferred_days || schedule.preferred_days.length === 0) return true;
  const today = currentDayNameInTimezone(timezone).toLowerCase();
  return schedule.preferred_days.some((d) => d.toLowerCase() === today);
}

/** Derive N articles/day from the schedule (dual-read). */
export function resolveArticlesPerDay(schedule: PublishSchedule): number {
  if (typeof schedule.articles_per_day === "number" && schedule.articles_per_day > 0) {
    return schedule.articles_per_day;
  }
  const perWeek = schedule.articles_per_week ?? 0;
  if (perWeek <= 0) return 0;
  const daysCount = schedule.preferred_days?.length || 7;
  return Math.max(1, Math.ceil(perWeek / daysCount));
}

// ---------------------------------------------------------------------------
// Per-site eligibility check (shared by queue and direct-execution paths)
// ---------------------------------------------------------------------------

type EligibilityResult =
  | { kind: "eligible"; branch: string; count: number; briefData: SiteBriefData }
  | { kind: "skipped"; reason: string };

async function checkSiteEligibility(
  octokit: ReturnType<typeof createOctokit>,
  siteEntry: { domain: string; branch: string },
  config: AgentConfig,
  timezone: string,
): Promise<EligibilityResult> {
  try {
    const { data, branch: foundBranch } = await readSiteBriefWithFallback(
      octokit,
      config.networkRepo,
      siteEntry.domain,
      siteEntry.branch,
    );
    if (data.themeTemplate === "grid") return { kind: "skipped", reason: "grid template" };
    const schedule = data.brief?.schedule;
    if (!schedule) return { kind: "skipped", reason: "no publishing schedule" };

    const count = resolveArticlesPerDay(schedule);
    if (count <= 0) return { kind: "skipped", reason: "no publishing schedule" };

    if (!isTodayPreferredDay(schedule, timezone)) {
      return {
        kind: "skipped",
        reason: `not a preferred day (${(schedule.preferred_days ?? []).join(", ")})`,
      };
    }

    return { kind: "eligible", branch: foundBranch, count, briefData: data };
  } catch {
    return { kind: "skipped", reason: "no brief configured" };
  }
}

// ---------------------------------------------------------------------------
// Background planning (queue path)
// ---------------------------------------------------------------------------

/** Sites whose site.yaml is read in parallel while planning a run. */
const PLAN_CONCURRENCY = 5;

/** The subset of a BullMQ Job that enqueueing a plan job needs. */
interface SchedulerPlanJobLike {
  getState(): Promise<string>;
  remove(): Promise<void>;
}

/** The subset of a BullMQ Queue that enqueueing a plan job needs. */
export interface SchedulerPlanQueueLike {
  getJob(jobId: string): Promise<SchedulerPlanJobLike | undefined>;
  add(name: string, data: SchedulerPlanData, opts: JobsOptions): Promise<unknown>;
}

/**
 * Enqueue the background planning job for this hour. The jobId is per hour, so
 * a duplicate cron tick or a second "Run now" in the same hour is a no-op —
 * unless that job failed all its retries, in which case it is replaced so an
 * operator can retry within the same hour.
 */
export async function enqueueSchedulerPlan(
  queue: SchedulerPlanQueueLike,
  data: SchedulerPlanData,
): Promise<{ alreadyQueued: boolean }> {
  const jobId = `scheduler-plan-${data.runId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) !== "failed") return { alreadyQueued: true };
    await existing.remove();
  }
  await queue.add(SCHEDULER_PLAN_QUEUE, data, { ...SCHEDULER_PLAN_JOB_OPTIONS, jobId });
  return { alreadyQueued: false };
}

export interface SchedulerPlanOutcome {
  enqueued: number;
  skipped: Array<{ domain: string; reason: string }>;
  /** Set when this hour's flow already existed (not an error worth retrying). */
  duplicate?: string;
}

/**
 * Plan one scheduler run inside the `scheduler-plan` worker: read every active
 * site's brief (one direct file read each, PLAN_CONCURRENCY at a time), keep
 * the sites due today, and hand them to the scheduler-run flow.
 *
 * Throws when the site list cannot be read so BullMQ retries the job.
 */
export async function planSchedulerRun(
  config: AgentConfig,
  data: SchedulerPlanData,
  flowProducer: FlowProducer,
): Promise<SchedulerPlanOutcome> {
  const octokit = createOctokit(config.github);
  const activeSites = await listActiveSites(octokit, config.networkRepo);
  console.log(
    `[scheduler-plan] ${data.runId}: checking ${activeSites.length} site(s) in tz=${data.timezone}${data.forced ? " (forced)" : ""}`,
  );

  const eligibleSites: SchedulerSite[] = [];
  const skippedSites: Array<{ domain: string; reason: string }> = [];
  await processWithConcurrency(
    activeSites,
    PLAN_CONCURRENCY,
    activeSites.length,
    async (siteEntry) => {
      const outcome = await checkSiteEligibility(octokit, siteEntry, config, data.timezone);
      if (outcome.kind === "eligible") {
        eligibleSites.push({
          domain: siteEntry.domain,
          branch: outcome.branch,
          count: outcome.count,
          briefJson: JSON.stringify(outcome.briefData),
        });
      } else {
        skippedSites.push({ domain: siteEntry.domain, reason: outcome.reason });
      }
    },
    () => true,
  );

  if (eligibleSites.length === 0) {
    console.log(`[scheduler-plan] ${data.runId}: no site due (${skippedSites.length} skipped)`);
    return { enqueued: 0, skipped: skippedSites };
  }

  try {
    const { enqueued } = await createSchedulerFlow(
      flowProducer,
      data.runId,
      data.timezone,
      data.forced,
      eligibleSites,
      skippedSites,
    );
    console.log(`[scheduler] Enqueued Flow: ${enqueued} site(s), runId=${data.runId}`);
    return { enqueued, skipped: skippedSites };
  } catch (err) {
    // flowProducer.add() throws if this hour's scheduler-run already exists.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scheduler] Flow creation failed (likely duplicate): ${message}`);
    return { enqueued: 0, skipped: skippedSites, duplicate: message };
  }
}

// ---------------------------------------------------------------------------
// Per-site processing (called concurrently in direct-execution fallback)
// ---------------------------------------------------------------------------

type SiteOutcome =
  | { kind: "skipped"; domain: string; reason: string }
  | { kind: "error"; domain: string; error: string; articlesRequested: number }
  | { kind: "triggered"; domain: string; siteResult: SiteRunResult };

async function processSingleSite(
  siteEntry: { domain: string; branch: string },
  config: AgentConfig,
  schedCfg: SchedulerConfig,
  forced: boolean,
): Promise<SiteOutcome> {
  const { domain, branch: preferredBranch } = siteEntry;
  const octokit = createOctokit(config.github);
  let articlesPerDay = 0;

  try {
    let briefData: SiteBriefData;
    let writeBranch: string;
    try {
      const { data, branch: foundBranch } = await readSiteBriefWithFallback(
        octokit,
        config.networkRepo,
        domain,
        preferredBranch,
      );
      briefData = data;
      writeBranch = foundBranch;
      if (data.themeTemplate === "grid") return { kind: "skipped", domain, reason: "grid template" };
    } catch {
      return { kind: "skipped", domain, reason: "no brief configured" };
    }

    const brief = briefData.brief;
    const schedule = brief.schedule;
    if (!schedule) {
      return { kind: "skipped", domain, reason: "no publishing schedule" };
    }

    articlesPerDay = resolveArticlesPerDay(schedule);
    if (articlesPerDay <= 0) {
      return { kind: "skipped", domain, reason: "no publishing schedule" };
    }

    if (!isTodayPreferredDay(schedule, schedCfg.timezone)) {
      return {
        kind: "skipped",
        domain,
        reason: `not a preferred day (${(schedule.preferred_days ?? []).join(", ")})`,
      };
    }

    // Trigger content generation for N articles on the site's staging branch
    console.log(
      `[scheduled-publisher] Triggering ${articlesPerDay} article(s) for ${domain} on ${writeBranch}`,
    );
    const startedAt = new Date();
    const genResult = await runContentGeneration(
      {
        siteDomain: domain,
        count: articlesPerDay,
        branch: writeBranch,
        preloadedBrief: {
          siteName: briefData.siteName,
          author: briefData.author,
          authors: briefData.authors,
          group: briefData.group,
          brief,
        },
        timezone: schedCfg.timezone,
        source: "scheduler",
      },
      config,
    );
    const finishedAt = new Date();
    await recordGeneration(
      genResult,
      {
        source: "scheduler",
        forced,
        topicName: null,
        startedAt,
        finishedAt,
      },
      buildScheduleFromBrief(brief),
    );

    // Re-evaluate run-sensitive alert conditions for this site (per-site, inside
    // the loop; fire-and-forget; failure-isolated; never alters generation).
    void runAfterRun(domain, new Date());

    const created = genResult.results.filter((r) => r.status === "created").length;
    const genErrors = genResult.results.filter((r) => r.status === "error");
    let siteStatus: SiteRunResult["status"];
    let siteMessage: string | undefined;

    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      if (genResult.eligibleTopicCount === 0) {
        siteMessage = "No topics configured on this site";
      } else {
        siteMessage = `Aggregator returned 0 items for ${genResult.eligibleTopicCount ?? "all"} eligible topic(s)`;
      }
    } else if (created === 0 && genErrors.length > 0) {
      siteStatus = "error";
      siteMessage = genErrors.map((e) => e.message ?? e.reason ?? "unknown").join("; ");
    } else if (created === 0 && genErrors.length === 0) {
      siteStatus = "no_content";
      siteMessage = `All ${genResult.totalSourced} item(s) checked were duplicates (${genResult.duplicateCount} dupes)`;
    } else if (created < articlesPerDay && genErrors.length > 0) {
      siteStatus = "partial";
      siteMessage = `${genErrors.length} article(s) failed: ${genErrors[0]?.message ?? "unknown"}`;
    } else {
      siteStatus = "success";
    }

    return {
      kind: "triggered",
      domain,
      siteResult: {
        domain,
        status: siteStatus,
        articlesCreated: created,
        articlesRequested: articlesPerDay,
        message: siteMessage,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduled-publisher] Error processing ${domain}:`, message);
    return { kind: "error", domain, error: message, articlesRequested: articlesPerDay };
  }
}

/**
 * Main entry point for a cron tick or "Run now". Applies the global gate, then
 * either queues the background planning job (queue path — returns `queued`) or
 * processes due sites inline (direct path). When `force` is true, bypass global
 * enabled/hour gating (per-site preferred_days still applies).
 */
export async function runScheduledPublish(
  config: AgentConfig,
  force = false,
  queueInstances?: QueueInstances,
): Promise<ScheduledPublishResult> {
  const result: ScheduledPublishResult = {
    status: "ok",
    configStatus: "ok",
    triggered: [],
    skipped: [],
    errors: [],
  };

  // 1. Read global scheduler config
  const { config: schedCfg, status: cfgStatus } = await readSchedulerConfig(config);
  result.configStatus = cfgStatus;

  if (cfgStatus === "fetch_error" && !force) {
    // Fail-safe: don't publish when we can't read config.
    console.warn("[scheduled-publisher] Config fetch failed — skipping tick");
    result.skippedGlobal = "fetch_error";
    return result;
  }

  if (!force) {
    if (!schedCfg.enabled) {
      console.log("[scheduled-publisher] Scheduler disabled — skipping tick");
      result.skippedGlobal = "disabled";
      return result;
    }
    const hourNow = currentHourInTimezone(schedCfg.timezone);
    if (!schedCfg.run_at_hours.includes(hourNow)) {
      console.log(
        `[scheduled-publisher] Hour ${hourNow} (${schedCfg.timezone}) not in run_at_hours [${schedCfg.run_at_hours.join(", ")}] — skipping`,
      );
      result.skippedGlobal = "hour_not_matched";
      return result;
    }
  }

  // ---------- Queue path: hand off to a background planning job ----------
  // The per-site checks run in the scheduler-plan worker, so this request
  // returns in about a second regardless of how many sites exist.
  if (queueInstances) {
    const runId = buildRunId();
    const { alreadyQueued } = await enqueueSchedulerPlan(queueInstances.schedulerPlanQueue, {
      runId,
      timezone: schedCfg.timezone,
      forced: force,
    });
    console.log(
      alreadyQueued
        ? `[scheduled-publisher] Run ${runId} already queued — nothing new enqueued`
        : `[scheduled-publisher] Queued planning job for run ${runId}${force ? " (forced)" : ""}`,
    );
    return {
      ...result,
      queued: !alreadyQueued,
      alreadyQueued,
      runId,
      errors: alreadyQueued
        ? [{ domain: "scheduler", error: `Run ${runId} was already queued this hour` }]
        : [],
    };
  }

  // 2. List all active sites (from dashboard-index.yaml, non-deleted)
  const octokit = createOctokit(config.github);
  let activeSites: Array<{ domain: string; branch: string; status: string }>;
  try {
    activeSites = await listActiveSites(octokit, config.networkRepo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scheduled-publisher] Failed to list sites:", message);
    result.errors.push({ domain: "*", error: message });
    void notifyError(config.notifications, {
      agent: "scheduled-publisher",
      error: `Failed to list active sites: ${message}`,
    });
    return result;
  }

  console.log(
    `[scheduled-publisher] Tick firing${force ? " (forced)" : ""}: checking ${activeSites.length} site(s) in tz=${schedCfg.timezone}`,
  );

  // ---------- Fallback: direct execution (no queue) ----------

  // 3. Process sites concurrently (max 3 in parallel to stay within API rate limits).
  //    History is flushed incrementally after each site completes so that partial
  //    progress survives a CloudGrid timeout.
  const MAX_SITES_CONCURRENT = 3;
  const history = new RunHistoryAccumulator(schedCfg.timezone, force, config);

  const siteOutcomes = await processWithConcurrency(
    activeSites,
    MAX_SITES_CONCURRENT,
    activeSites.length,
    async (siteEntry) => {
      const outcome = await processSingleSite(siteEntry, config, schedCfg, force);
      // Record to incremental history immediately
      if (outcome.kind === "skipped") {
        history.recordSkipped(outcome.domain, outcome.reason);
      } else if (outcome.kind === "error") {
        history.recordSiteResult({
          domain: outcome.domain,
          status: "error",
          articlesCreated: 0,
          articlesRequested: outcome.articlesRequested,
          message: outcome.error,
        });
      } else {
        history.recordSiteResult(outcome.siteResult);
      }
      return outcome;
    },
    () => true,
  );

  // Collect results from concurrent outcomes into the HTTP response
  for (const outcome of siteOutcomes) {
    if (outcome.kind === "skipped") {
      result.skipped.push({ domain: outcome.domain, reason: outcome.reason });
    } else if (outcome.kind === "error") {
      result.errors.push({ domain: outcome.domain, error: outcome.error });
    } else {
      result.triggered.push(outcome.domain);
    }
  }

  console.log(
    `[scheduled-publisher] Done: ${result.triggered.length} triggered, ` +
      `${result.skipped.length} skipped, ${result.errors.length} errors`,
  );

  // Notify if any sites errored or produced zero articles
  const zeroArticleSites = siteOutcomes
    .filter((o): o is Extract<SiteOutcome, { kind: "triggered" }> =>
      o.kind === "triggered" && o.siteResult.articlesCreated === 0,
    )
    .map((o) => o.domain);

  void notifySummary(config.notifications, {
    runId: buildRunId(),
    triggered: result.triggered.length,
    errors: result.errors,
    zeroArticleSites,
  });

  // 4. Final history flush — ensures any pending writes land before we return
  await history.finalize();

  // Update weekly summary in MongoDB
  const allSiteDomains = activeSites.map((s) => s.domain);
  await updateWeeklySummary({
    allSiteDomains,
    siteResults: siteOutcomes
      .filter((o): o is Extract<SiteOutcome, { kind: "triggered" }> => o.kind === "triggered")
      .map((o) => ({
        domain: o.domain,
        articlesRequested: o.siteResult.articlesRequested,
        articlesCreated: o.siteResult.articlesCreated,
      })),
    skipped: result.skipped,
    timezone: schedCfg.timezone,
  });

  // 5. Auto-publish: merge staging → main for Live sites with new articles.
  //    Mirrors the queue path logic in scheduler-flow.ts processSchedulerRun().
  const siteStatusMap = new Map(activeSites.map((s) => [s.domain, s.status]));
  const siteBranchMap = new Map(activeSites.map((s) => [s.domain, s.branch]));

  const autoPublished: string[] = [];
  for (const outcome of siteOutcomes) {
    if (outcome.kind !== "triggered") continue;
    const status = siteStatusMap.get(outcome.domain) ?? "";
    if (!shouldAutoPublish(outcome.siteResult, status)) continue;

    const branch = siteBranchMap.get(outcome.domain);
    if (!branch) continue;

    try {
      await autoPublishSite(octokit, config.networkRepo, outcome.domain, branch);
      autoPublished.push(outcome.domain);
    } catch (pubErr) {
      const msg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      console.error(`[auto-publish] Failed for ${outcome.domain}: ${msg}`);
    }
  }

  if (autoPublished.length > 0) {
    console.log(
      `[scheduled-publisher] Auto-published ${autoPublished.length} site(s): ${autoPublished.join(", ")}`,
    );
  }

  return result;
}
