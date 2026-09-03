import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { ScheduleSnapshot, GenerationSource } from "./types.js";
import { countTodayCreated } from "./daily.js";

export interface SiteStatsResponse {
  siteDomain: string;
  schedule: ScheduleSnapshot | null;
  lastAdded: { at: Date | null; source: GenerationSource | null; count: number | null };
  lastFailedAt: Date | null;
  thisWeek: { created: number; expected: number };   // expected = schedule?.weeklyTarget ?? 0
  failedArticles: { last7d: number; last30d: number };
  imageGenFailed: { last7d: number; last30d: number };
  today?: { created: number };
}

/**
 * Returns the start of the ISO week (Monday 00:00:00.000 UTC) containing `now`.
 * Choice rationale: ISO 8601 weeks start on Monday; all date arithmetic is in UTC
 * so the boundary is deterministic regardless of server timezone.
 *
 * Example: now = 2026-06-10 (Wednesday) → 2026-06-08T00:00:00.000Z (Monday)
 * Example: now = 2026-06-07 (Sunday)    → 2026-06-01T00:00:00.000Z (Monday 6 days earlier)
 */
export function startOfWeek(now: Date): Date {
  const d = new Date(now);
  // getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat
  // We want Monday as day 0 of the week.
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Days since last Monday: Mon→0, Tue→1, Wed→2, Thu→3, Fri→4, Sat→5, Sun→6
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Returns the cutoff date N days before `now` (exact millisecond offset). */
function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

/**
 * Sums a numeric field from `generation_events` for a given domain
 * where `finishedAt >= since`.
 */
async function sumField(
  domain: string,
  field: "created" | "failed",
  since: Date,
): Promise<number> {
  const db = await getMongoDb();
  const result = await db.collection(COLLECTIONS.generationEvents).aggregate<{ total: number }>([
    { $match: { siteDomain: domain, finishedAt: { $gte: since } } },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]).toArray();
  return result[0]?.total ?? 0;
}

/**
 * Sums a numeric field from `generation_events` for a given domain,
 * filtered by `finishedAt >= since` AND `status` in the given set.
 */
export async function sumFieldWithStatus(
  domain: string,
  field: "created" | "failed",
  since: Date,
  statuses: string[],
): Promise<number> {
  const db = await getMongoDb();
  const result = await db.collection(COLLECTIONS.generationEvents).aggregate<{ total: number }>([
    { $match: { siteDomain: domain, finishedAt: { $gte: since }, status: { $in: statuses } } },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]).toArray();
  return result[0]?.total ?? 0;
}

/**
 * Counts `image_gen_events` for a domain where `ok === false` and `at >= since`.
 */
async function countFailedImages(domain: string, since: Date): Promise<number> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.imageGenEvents).countDocuments({
    siteDomain: domain,
    ok: false,
    at: { $gte: since },
  });
}

/**
 * Reads the `site_stats` rollup doc for `domain` and aggregates generation_events
 * + image_gen_events over the relevant time windows:
 *
 *   thisWeek.created   — sum of `created` since startOfWeek(now) (Monday UTC)
 *   failedArticles     — sum of `failed` in last 7 / 30 days
 *   imageGenFailed     — count of failed image events in last 7 / 30 days
 *
 * If no site_stats doc exists, all rollup fields default to null/0.
 */
export async function getSiteStats(domain: string, now: Date): Promise<SiteStatsResponse> {
  const db = await getMongoDb();

  // Read rollup doc (may be absent)
  const rollup = await db.collection(COLLECTIONS.siteStats).findOne<{
    _id: string;
    schedule: ScheduleSnapshot | null;
    lastAddedAt: Date | null;
    lastAddedSource: GenerationSource | null;
    lastAddedCount: number | null;
    lastFailedAt: Date | null;
  }>({ _id: domain as any });

  const schedule = rollup?.schedule ?? null;

  // Time window boundaries
  const weekStart = startOfWeek(now);
  const cutoff7d = daysAgo(now, 7);
  const cutoff30d = daysAgo(now, 30);

  // Aggregate in parallel for efficiency
  const [
    thisWeekCreated,
    failed7d,
    failed30d,
    imgFailed7d,
    imgFailed30d,
    todayCreated,
  ] = await Promise.all([
    sumField(domain, "created", weekStart),
    sumField(domain, "failed", cutoff7d),
    sumField(domain, "failed", cutoff30d),
    countFailedImages(domain, cutoff7d),
    countFailedImages(domain, cutoff30d),
    countTodayCreated(domain, now),
  ]);

  return {
    siteDomain: domain,
    schedule,
    lastAdded: {
      at: rollup?.lastAddedAt ?? null,
      source: rollup?.lastAddedSource ?? null,
      count: rollup?.lastAddedCount ?? null,
    },
    lastFailedAt: rollup?.lastFailedAt ?? null,
    thisWeek: {
      created: thisWeekCreated,
      expected: schedule?.weeklyTarget ?? 0,
    },
    failedArticles: { last7d: failed7d, last30d: failed30d },
    imageGenFailed: { last7d: imgFailed7d, last30d: imgFailed30d },
    today: { created: todayCreated },
  };
}

/**
 * Returns one SiteStatsResponse per document in the `site_stats` collection.
 * Fetches all domains first, then resolves each in parallel.
 */
export async function getAllSiteStats(now: Date): Promise<SiteStatsResponse[]> {
  const db = await getMongoDb();
  const docs = await db.collection(COLLECTIONS.siteStats)
    .find<{ _id: string }>({}, { projection: { _id: 1 } })
    .toArray();
  return Promise.all(docs.map((doc) => getSiteStats(doc._id, now)));
}
