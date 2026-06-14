import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { DayCell } from "./types.js";

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

const EMPTY_WEEK: DayCell[] = Array.from({ length: 7 }, () => ({ expected: 0, created: 0 }));
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
    reviewDocs.map((d) => [d._id as string, Math.max(0, (d as any).count ?? 0)]),
  );

  const sitesMap = (weekDoc as any)?.sites as Record<string, DayCell[]> | undefined;
  if (!sitesMap) {
    return { weekOf, timezone, days: DAY_LABELS, sites: [] };
  }

  const sites = Object.entries(sitesMap)
    .map(([domain, days]) => ({
      domain,
      days: days.length === 7 ? days : EMPTY_WEEK,
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
