/**
 * Scheduled Publisher Agent
 *
 * Called by the CloudGrid cron job via HTTP. On each tick:
 * 1. Read global scheduler config from network repo (scheduler/config.yaml).
 *    Skip early unless enabled and current hour ∈ run_at_hours (or force=true).
 * 2. List all sites in the network repo.
 * 3. For each site, read brief.schedule. Skip unless today is a preferred day.
 * 4. Trigger ContentGenerationAgent with count = articles_per_day
 *    (fallback: ceil(articles_per_week / preferred_days.length)).
 *
 * Global hour gating lives in the network repo so schedule changes don't
 * require a platform redeploy. CloudGrid cron fires hourly; most ticks are
 * no-ops that return in ~50ms.
 */

import { parse as parseYaml } from "yaml";
import { createGitHubClient, readFile } from "../../lib/github.js";
import { listActiveSites, readSiteBriefWithFallback } from "../../lib/site-brief.js";
import { runContentGeneration } from "../content-generation/agent.js";
import type { AgentConfig } from "../../lib/config.js";
import type { PublishSchedule } from "../../types.js";

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
}

/** Read the scheduler config from the network repo. 404 → defaults. */
async function readSchedulerConfig(
  config: AgentConfig,
): Promise<{ config: SchedulerConfig; status: "ok" | "defaults" | "fetch_error" }> {
  const octokit = createGitHubClient(config.github);
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

/**
 * Main entry point: check all sites and trigger content generation for due sites.
 * When `force` is true, bypass global enabled/hour gating (per-site preferred_days
 * still applies).
 */
export async function runScheduledPublish(
  config: AgentConfig,
  force = false,
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

  // 2. List all active sites (from dashboard-index.yaml, non-deleted)
  const octokit = createGitHubClient(config.github);
  let activeSites: Array<{ domain: string; branch: string }>;
  try {
    activeSites = await listActiveSites(octokit, config.networkRepo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scheduled-publisher] Failed to list sites:", message);
    result.errors.push({ domain: "*", error: message });
    return result;
  }

  console.log(
    `[scheduled-publisher] Tick firing${force ? " (forced)" : ""}: checking ${activeSites.length} site(s) in tz=${schedCfg.timezone}`,
  );

  // 3. Iterate sites
  for (const { domain, branch: preferredBranch } of activeSites) {
    try {
      let brief;
      let writeBranch: string;
      try {
        const { data, branch: foundBranch } = await readSiteBriefWithFallback(
          octokit,
          config.networkRepo,
          domain,
          preferredBranch,
        );
        brief = data.brief;
        writeBranch = foundBranch;
      } catch {
        result.skipped.push({ domain, reason: "no brief configured" });
        continue;
      }

      const schedule = brief.schedule;
      if (!schedule) {
        result.skipped.push({ domain, reason: "no publishing schedule" });
        continue;
      }

      const articlesPerDay = resolveArticlesPerDay(schedule);
      if (articlesPerDay <= 0) {
        result.skipped.push({ domain, reason: "no publishing schedule" });
        continue;
      }

      if (!isTodayPreferredDay(schedule, schedCfg.timezone)) {
        result.skipped.push({
          domain,
          reason: `not a preferred day (${(schedule.preferred_days ?? []).join(", ")})`,
        });
        continue;
      }

      // 4. Trigger content generation for N articles on the site's staging
      //    branch so the writer commits via GitHub API (and Cloudflare Pages
      //    picks up the change). Passing an explicit branch also disables the
      //    local-FS write path in dev — otherwise articles land as untracked
      //    files on whatever branch happens to be checked out.
      console.log(
        `[scheduled-publisher] Triggering ${articlesPerDay} article(s) for ${domain} on ${writeBranch}`,
      );
      await runContentGeneration(
        { siteDomain: domain, count: articlesPerDay, branch: writeBranch },
        config,
      );
      result.triggered.push(domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-publisher] Error processing ${domain}:`, message);
      result.errors.push({ domain, error: message });
    }
  }

  console.log(
    `[scheduled-publisher] Done: ${result.triggered.length} triggered, ` +
      `${result.skipped.length} skipped, ${result.errors.length} errors`,
  );

  return result;
}
