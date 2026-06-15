import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { DayCell } from "./types.js";
import { parse as parseYaml } from "yaml";
import { createOctokit, readFile } from "../lib/github.js";
import type { AgentConfig } from "../lib/config.js";

/**
 * Map common timezone abbreviations to IANA names.
 * Same map as scheduled-publisher/index.ts — duplicated to keep
 * the stats module self-contained (no cross-directory agent import).
 */
const TIMEZONE_MAP: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
};

function resolveTimezone(tz: string): string {
  return TIMEZONE_MAP[tz.toUpperCase()] ?? tz;
}

/**
 * Compute the day-of-week index (0=Sun..6=Sat) and the week-of Sunday
 * date string (YYYY-MM-DD) for a given timezone and instant.
 *
 * @param timezone - Scheduler timezone abbreviation or IANA name
 * @param now - Current instant (injectable for testing)
 */
export function getDayIndexAndWeekOf(
  timezone: string,
  now: Date = new Date(),
): { dayIndex: number; weekOf: string } {
  const resolved = resolveTimezone(timezone);

  // Get current day-of-week in the scheduler's timezone (0=Sun..6=Sat)
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: resolved,
  }).format(now);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = Math.max(0, DAY_NAMES.indexOf(dayName));

  // Get today's date in the scheduler's timezone (YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Walk back to Sunday
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const sundayMs = todayMs - dayIndex * 86_400_000;
  const sunday = new Date(sundayMs);
  const weekOf = sunday.toISOString().slice(0, 10);

  return { dayIndex, weekOf };
}

export interface WeeklySummaryInput {
  allSiteDomains: string[];
  siteResults: Array<{
    domain: string;
    articlesRequested: number;
    articlesCreated: number;
  }>;
  skipped: Array<{ domain: string; reason: string }>;
  timezone: string;
  now?: Date;
}

/**
 * Upsert the weekly summary document for the current week.
 * Sets today's day-cell for every site in allSiteDomains.
 *
 * Failure-isolated — catches and logs errors, never throws.
 */
export async function updateWeeklySummary(input: WeeklySummaryInput): Promise<void> {
  try {
    const { allSiteDomains, siteResults, skipped, timezone, now } = input;
    const { dayIndex, weekOf } = getDayIndexAndWeekOf(timezone, now);

    const resultMap = new Map(siteResults.map((r) => [r.domain, r]));

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    for (const domain of allSiteDomains) {
      const result = resultMap.get(domain);
      if (result) {
        $set[`sites.${domain}.${dayIndex}`] = {
          expected: result.articlesRequested,
          created: result.articlesCreated,
        };
      } else {
        $set[`sites.${domain}.${dayIndex}`] = { expected: 0, created: 0 };
      }
    }

    const db = await getMongoDb();
    await db.collection(COLLECTIONS.weeklySummaries).updateOne(
      { _id: weekOf as any },
      { $set },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] updateWeeklySummary failed (non-fatal): ${msg}`);
  }
}

export interface SchedulerSummaryResponse {
  weekOf: string;
  timezone: string;
  days: string[];
  sites: Array<{
    domain: string;
    days: DayCell[];
    needReview: number;
  }>;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Read the weekly summary for the current week, merged with review counts.
 */
export async function getWeeklySummary(
  timezone: string,
  now: Date = new Date(),
): Promise<SchedulerSummaryResponse> {
  const { weekOf } = getDayIndexAndWeekOf(timezone, now);
  const db = await getMongoDb();

  const [weekDoc, reviewDocs] = await Promise.all([
    db.collection(COLLECTIONS.weeklySummaries).findOne({ _id: weekOf as any }),
    db.collection(COLLECTIONS.reviewCounts).find({}).toArray(),
  ]);

  const reviewMap = new Map(
    reviewDocs.map((d) => [d._id as unknown as string, Math.max(0, (d as any).count ?? 0)]),
  );

  const sitesMap = (weekDoc as any)?.sites as Record<string, DayCell[]> | undefined;
  if (!sitesMap) {
    return { weekOf, timezone, days: DAY_LABELS, sites: [] };
  }

  const sites = Object.entries(sitesMap)
    .map(([domain, days]) => ({
      domain,
      // MongoDB sparse arrays may be shorter than 7 if the scheduler hasn't
      // run every day this week yet — pad to 7, filling gaps with zeros.
      days: Array.from({ length: 7 }, (_, i) => days[i] ?? { expected: 0, created: 0 }),
      needReview: reviewMap.get(domain) ?? 0,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return { weekOf, timezone, days: DAY_LABELS, sites };
}

/**
 * Decrement the review count for a site. Used by dashboard after
 * approving or rejecting articles.
 *
 * Failure-isolated — catches and logs errors, never throws.
 */
export async function decrementReviewCount(domain: string, count: number): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.reviewCounts).updateOne(
      { _id: domain as any },
      { $inc: { count: -count }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] decrementReviewCount failed (non-fatal): ${msg}`);
  }
}

const SCHEDULER_CONFIG_PATH = "scheduler/config.yaml";

/** Read the scheduler timezone from the network repo. Falls back to "EST". */
export async function getSchedulerTimezone(config: AgentConfig): Promise<string> {
  try {
    const octokit = createOctokit(config.github);
    const raw = await readFile(octokit, config.networkRepo, SCHEDULER_CONFIG_PATH);
    const parsed = parseYaml(raw) as { timezone?: string } | null;
    return parsed?.timezone ?? "EST";
  } catch {
    return "EST";
  }
}

// ---------------------------------------------------------------------------
// Backfill from scheduler/history.json
// ---------------------------------------------------------------------------

interface HistoryEntry {
  timestamp: string;
  timezone: string;
  forced: boolean;
  sites: Array<{
    domain: string;
    status: string;
    articlesCreated: number;
    articlesRequested: number;
  }>;
  skipped?: Array<{ domain: string; reason: string }>;
}

export interface BackfillResult {
  weeksWritten: number;
  entriesProcessed: number;
  weeks: Array<{ weekOf: string; runsProcessed: number }>;
}

/**
 * Read scheduler/history.json from the network repo and backfill
 * the weekly_summaries collection from it.
 *
 * Groups history entries by week, then for each week upserts a single
 * document with every day's data merged. Safe to call repeatedly —
 * uses $set so later values overwrite earlier ones for the same day.
 */
export async function backfillWeeklySummary(config: AgentConfig): Promise<BackfillResult> {
  const octokit = createOctokit(config.github);
  const raw = await readFile(octokit, config.networkRepo, "scheduler/history.json");
  const history: HistoryEntry[] = JSON.parse(raw);

  // Group entries by weekOf
  const weekMap = new Map<string, Array<{ entry: HistoryEntry; dayIndex: number }>>();

  for (const entry of history) {
    const tz = entry.timezone || "EST";
    const { dayIndex, weekOf } = getDayIndexAndWeekOf(tz, new Date(entry.timestamp));
    if (!weekMap.has(weekOf)) weekMap.set(weekOf, []);
    weekMap.get(weekOf)!.push({ entry, dayIndex });
  }

  const db = await getMongoDb();
  const coll = db.collection(COLLECTIONS.weeklySummaries);
  const weekResults: BackfillResult["weeks"] = [];

  for (const [weekOf, runs] of weekMap) {
    // Build a single $set for the whole week
    const $set: Record<string, unknown> = { updatedAt: new Date() };

    for (const { entry, dayIndex } of runs) {
      // Collect all domains from both sites and skipped
      const allDomains = new Set<string>();
      for (const s of entry.sites) allDomains.add(s.domain);
      for (const s of entry.skipped ?? []) allDomains.add(s.domain);

      const resultMap = new Map(entry.sites.map((s) => [s.domain, s]));

      for (const domain of allDomains) {
        const result = resultMap.get(domain);
        $set[`sites.${domain}.${dayIndex}`] = result
          ? { expected: result.articlesRequested, created: result.articlesCreated }
          : { expected: 0, created: 0 };
      }
    }

    await coll.updateOne({ _id: weekOf as any }, { $set }, { upsert: true });
    weekResults.push({ weekOf, runsProcessed: runs.length });
  }

  return {
    weeksWritten: weekResults.length,
    entriesProcessed: history.length,
    weeks: weekResults.sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
  };
}
