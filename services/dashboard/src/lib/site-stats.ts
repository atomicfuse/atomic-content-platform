/**
 * Dashboard-side enrichment helpers for the ops-console /api/site-stats proxy.
 *
 * The content-pipeline serves raw per-site stats; the dashboard enriches each
 * site with:
 *   - recentArticles: the most-recent N articles (with quality_score backfilled
 *     from Git when the KV path doesn't carry it).
 *   - schedule.nextRun: computed from the global scheduler gate + the site's
 *     preferred days (see computeNextRun below).
 */

// ---------------------------------------------------------------------------
// mapWithConcurrency
// ---------------------------------------------------------------------------

/**
 * Like Promise.all(items.map(fn)) but caps the number of in-flight calls to
 * `limit`. Preserves result order. No external dependencies.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

import { getSiteConfig as readSiteConfig } from "@/lib/db/site-configs";
import { readArticlesFromDb } from "@/lib/db/articles";
import type { ArticleEntry } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// recentArticles
// ---------------------------------------------------------------------------

export interface RecentArticle {
  title: string;
  score: number | null;
  status: string;
  slug: string;
  publishDate: string;
}

/**
 * Pure mapping/sort step: sort entries by publishDate desc, take the first N,
 * and project to the RecentArticle shape. `score` is `quality_score ?? null`
 * (an ArticleEntry without a numeric score maps to `null`).
 *
 * Kept side-effect-free so it can be unit-tested with in-memory fixtures.
 */
export function mapRecentArticles(entries: ArticleEntry[], n = 5): RecentArticle[] {
  return [...entries]
    .sort((a, b) => (b.publishDate ?? "").localeCompare(a.publishDate ?? ""))
    .slice(0, n)
    .map((e) => ({
      title: e.title,
      score: typeof e.score === "number" ? e.score : null,
      status: e.status,
      slug: e.slug,
      publishDate: e.publishDate ?? "",
    }));
}

/**
 * General-image predicate. Mirrors `isGeneralImage` in
 * services/content-pipeline/src/agents/content-generation/bulk-image.ts so the
 * `generalImages` count agrees with the bulk-image scanner: a missing image OR
 * a `featuredImage` containing the substring "general-article" counts as a
 * default/general image.
 */
function isGeneralImage(featuredImage: string | undefined): boolean {
  if (!featuredImage) return true;
  return featuredImage.includes("general-article");
}

/**
 * Pure count step over the FULL article list:
 *   - reviewCount: entries with `status === "review"`.
 *   - generalImages: entries whose `featuredImage` is a default/general image
 *     (see `isGeneralImage`).
 *
 * Side-effect-free so it can be unit-tested with in-memory fixtures.
 */
export function countArticleStats(entries: ArticleEntry[]): {
  reviewCount: number;
  generalImages: number;
} {
  let reviewCount = 0;
  let generalImages = 0;
  for (const e of entries) {
    if (e.status === "review") reviewCount++;
    if (isGeneralImage(e.featuredImage)) generalImages++;
  }
  return { reviewCount, generalImages };
}

/**
 * Map the most-recent N articles, backfilling `score` from Git where the KV
 * path left it null. Pure given the already-fetched `entries`; the only side
 * effect is the conditional Git read for score backfill.
 */
async function buildRecentArticles(
  entries: ArticleEntry[],
  domain: string,
  branch: string,
  n: number,
): Promise<RecentArticle[]> {
  const top = mapRecentArticles(entries, n);

  // If any of the selected articles lack a score (KV path), backfill from Git.
  if (top.some((a) => a.score === null)) {
    try {
      const gitArticles = await readArticlesFromDb(domain, branch);
      const scoreBySlug = new Map<string, number | undefined>(
        gitArticles.map((g) => [g.slug, g.score]),
      );
      for (const a of top) {
        if (a.score === null) {
          const s = scoreBySlug.get(a.slug);
          if (typeof s === "number") a.score = s;
        }
      }
    } catch {
      // Git read failed — keep nulls rather than failing the whole request.
    }
  }

  return top;
}

export interface ArticleAggregates {
  recentArticles: RecentArticle[];
  reviewCount: number;
  generalImages: number;
}

/**
 * Resolve recentArticles + reviewCount + generalImages for a site from a SINGLE
 * article fetch.
 *
 * Enumeration goes through `readArticlesFromDb` (MongoDB → KV → Git) ONCE.
 * `reviewCount`/`generalImages` are computed over the FULL list; `recentArticles`
 * is the top-N (with `quality_score` backfilled from Git when the KV path didn't
 * carry it — the Git read is only invoked if at least one of the top-N lacks a
 * score). Failure-isolated: if the fetch throws, returns all-empty/zero.
 */
export async function articleAggregates(
  domain: string,
  branch: string,
  n = 5,
): Promise<ArticleAggregates> {
  let entries: ArticleEntry[];
  try {
    entries = await readArticlesFromDb(domain, branch);
  } catch {
    return { recentArticles: [], reviewCount: 0, generalImages: 0 };
  }

  const { reviewCount, generalImages } = countArticleStats(entries);
  const recent = await buildRecentArticles(entries, domain, branch, n);

  return { recentArticles: recent, reviewCount, generalImages };
}

/**
 * Resolve the most-recent N articles for a site. Thin wrapper over
 * `articleAggregates` for backward compatibility.
 */
export async function recentArticles(
  domain: string,
  branch: string,
  n = 5,
): Promise<RecentArticle[]> {
  const { recentArticles: recent } = await articleAggregates(domain, branch, n);
  return recent;
}

// ---------------------------------------------------------------------------
// computeNextRun
//
// Keep in sync with services/content-pipeline/src/stats/schedule.ts computeNextRun
// (content-pipeline and dashboard can't share a module; both inline this).
// ---------------------------------------------------------------------------

export interface SchedulerGate {
  enabled: boolean;
  run_at_hours: number[];
  timezone: string;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23 (hourCycle h23)
  weekday: number; // 0=Sunday..6=Saturday
}

/** Returns the wall-clock parts of `instant` in the given IANA timezone. */
function zonedParts(instant: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = fmt.formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const weekdayStr = get("weekday"); // "Sun", "Mon", ...
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = WEEKDAYS.indexOf(weekdayStr);

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10),
    weekday: weekday === -1 ? 0 : weekday,
  };
}

/**
 * Find the UTC instant for "zoned date (year/month/day) at (hour):00:00 in tz".
 *
 * Strategy: start from a naive UTC guess (pretend the local time is UTC), then
 * correct using the offset seen at that guess. One or two iterations converge
 * (handles DST transitions robustly).
 */
function zonedToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  tz: string,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));

  for (let i = 0; i < 2; i++) {
    const zp = zonedParts(guess, tz);
    const guessWallMs = Date.UTC(zp.year, zp.month - 1, zp.day, zp.hour, 0, 0, 0);
    const targetWallMs = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
    const offsetMs = guessWallMs - targetWallMs;
    guess = new Date(guess.getTime() - offsetMs);
  }

  return guess;
}

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Maps "Monday", "Mon", "monday", "mon" → 0-6 (Sun=0). Returns -1 if unknown. */
function parseDayName(name: string): number {
  const norm = name.toLowerCase().slice(0, 3);
  return WEEKDAY_NAMES.findIndex((d) => d.startsWith(norm));
}

/**
 * Compute the next UTC instant at which the scheduler would fire for a site
 * with the given preferred weekdays.
 *
 * @param gate          - Global scheduler gate (enabled, run_at_hours, timezone).
 * @param preferredDays - Site's preferred days (e.g. ["Monday", "Wed"]).
 * @param now           - Injected current time (no Date.now()).
 * @returns The earliest Date strictly after `now` that satisfies all conditions,
 *          or null if the scheduler is disabled / no valid candidates.
 */
export function computeNextRun(
  gate: SchedulerGate,
  preferredDays: string[],
  now: Date,
): Date | null {
  if (!gate.enabled) return null;
  if (!preferredDays.length || !gate.run_at_hours.length) return null;

  const preferredNums = new Set(
    preferredDays.map(parseDayName).filter((n) => n !== -1),
  );
  if (preferredNums.size === 0) return null;

  const sortedHours = [...gate.run_at_hours].sort((a, b) => a - b);

  const nowParts = zonedParts(now, gate.timezone);

  for (let addDays = 0; addDays <= 14; addDays++) {
    const targetDate = new Date(
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) +
        addDays * 86_400_000,
    );
    const targetParts = zonedParts(targetDate, gate.timezone);
    const { year, month, day, weekday } = targetParts;

    if (!preferredNums.has(weekday)) continue;

    for (const hour of sortedHours) {
      const candidate = zonedToUtc(year, month, day, hour, gate.timezone);
      if (candidate.getTime() > now.getTime()) {
        const verifyParts = zonedParts(candidate, gate.timezone);
        if (verifyParts.hour !== hour) continue; // skip ambiguous DST times
        return candidate;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// computeTodayExpected
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns articlesPerDay if today (UTC) is one of the preferredDays, else 0.
 * Case-insensitive: handles both "Monday" and "monday" from YAML configs.
 */
export function computeTodayExpected(
  articlesPerDay: number,
  preferredDays: string[],
  now: Date,
): number {
  const todayName = DAY_NAMES[now.getUTCDay()].toLowerCase();
  return preferredDays.some((d) => d.toLowerCase() === todayName) ? articlesPerDay : 0;
}

// ---------------------------------------------------------------------------
// Per-site enrichment (shared by /api/site-stats and /api/site-stats/[domain])
//
// These live here, NOT in the route files: a Next.js App Router `route.ts` may
// only export route handlers (GET/POST/…). Exporting helpers/types from a route
// breaks the production build (`.next/types` enforces an index signature of
// `never` on extra exports). Keeping them in this lib lets both routes import.
// ---------------------------------------------------------------------------

/** Schedule shape served by content-pipeline's SiteStatsResponse. */
export interface ScheduleSnapshot {
  articlesPerDay: number;
  preferredDays: string[];
  weeklyTarget: number;
}

/** One raw site from the content-pipeline /site-stats proxy. */
export interface SiteStatsResponse {
  siteDomain: string;
  schedule: ScheduleSnapshot | null;
  lastAdded: {
    at: string | null;
    source: string | null;
    count: number | null;
  };
  lastFailedAt: string | null;
  thisWeek: { created: number; expected: number };
  today?: { created: number };
  failedArticles: { last7d: number; last30d: number };
  imageGenFailed: { last7d: number; last30d: number };
}

/** Enriched site = raw stats + recentArticles + counts + schedule.nextRun + today.expected. */
export interface EnrichedSiteStats extends SiteStatsResponse {
  recentArticles: RecentArticle[];
  reviewCount: number;
  generalImages: number;
  schedule: (ScheduleSnapshot & { nextRun: Date | null }) | null;
  today: { created: number; expected: number };
}

/** Default/empty stats for a site that the pipeline never reported on. */
export function emptyStats(siteDomain: string): SiteStatsResponse {
  return {
    siteDomain,
    schedule: null,
    lastAdded: { at: null, source: null, count: null },
    lastFailedAt: null,
    thisWeek: { created: 0, expected: 0 },
    today: { created: 0 },
    failedArticles: { last7d: 0, last30d: 0 },
    imageGenFailed: { last7d: 0, last30d: 0 },
  };
}

// Day ordering for consistent display
const DAY_ORDER: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

/**
 * Build a ScheduleSnapshot from a site-level brief.schedule (legacy model).
 *
 * Replicates the content-pipeline's `buildScheduleSnapshot` logic.
 * Keep in sync with services/content-pipeline/src/stats/schedule.ts.
 */
function scheduleFromSiteLevel(
  raw: Record<string, unknown>,
): ScheduleSnapshot | null {
  const preferredDays = Array.isArray(raw.preferred_days)
    ? (raw.preferred_days as string[])
    : [];

  let articlesPerDay: number;
  if (typeof raw.articles_per_day === "number" && raw.articles_per_day > 0) {
    articlesPerDay = raw.articles_per_day;
  } else {
    const perWeek =
      typeof raw.articles_per_week === "number" ? raw.articles_per_week : 0;
    if (perWeek <= 0) {
      articlesPerDay = 0;
    } else {
      const daysCount = preferredDays.length || 7;
      articlesPerDay = Math.max(1, Math.ceil(perWeek / daysCount));
    }
  }

  const weeklyTarget = articlesPerDay * preferredDays.length;
  return { articlesPerDay, preferredDays, weeklyTarget };
}

/** Normalise "monday" / "Monday" / "MONDAY" → "Monday" (matches DAY_ORDER keys). */
function capitalizeDay(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
}

/**
 * Aggregate per-topic schedules (topics_v2 model) into a single snapshot.
 *
 * Each topic has its own `articles_per_week` + `preferred_days`. We aggregate:
 *   - preferredDays: union of all topics' days, sorted by weekday order
 *   - weeklyTarget: sum of all topics' articles_per_week
 *   - articlesPerDay: ceil(weeklyTarget / number of unique preferred days)
 */
function scheduleFromTopics(
  topics: Array<Record<string, unknown>>,
): ScheduleSnapshot | null {
  const allDays = new Set<string>();
  let totalWeekly = 0;

  for (const topic of topics) {
    const sched = topic.schedule as Record<string, unknown> | undefined;
    if (!sched) continue;
    const perWeek =
      typeof sched.articles_per_week === "number" ? sched.articles_per_week : 0;
    totalWeekly += perWeek;
    const days = Array.isArray(sched.preferred_days)
      ? (sched.preferred_days as string[])
      : [];
    for (const d of days) allDays.add(capitalizeDay(d));
  }

  if (totalWeekly <= 0 || allDays.size === 0) return null;

  const preferredDays = [...allDays].sort(
    (a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99),
  );
  const articlesPerDay = Math.ceil(totalWeekly / preferredDays.length);
  return { articlesPerDay, preferredDays, weeklyTarget: totalWeekly };
}

/**
 * Build a ScheduleSnapshot from the full brief object (parsed site.yaml).
 *
 * Both topics_v2 and legacy sites use brief.schedule as the single
 * source of truth. Per-topic schedules are deprecated (round-robin).
 */
export function buildScheduleFromBrief(
  brief: Record<string, unknown> | undefined | null,
): ScheduleSnapshot | null {
  if (!brief) return null;
  // Both topics_v2 and legacy sites use brief.schedule as the single
  // source of truth. Per-topic schedules are deprecated (round-robin).
  const schedule = brief.schedule as Record<string, unknown> | undefined;
  return schedule ? scheduleFromSiteLevel(schedule) : null;
}

/**
 * Pre-load all site briefs from the `main` branch in bulk.
 *
 * The main tree is already cached (with Infinity TTL) after the
 * `readDashboardIndex()` call, so each `readSiteConfig(domain)` is just a
 * single blob read — no extra tree fetch. With concurrency 10 and ~50 sites,
 * this completes in ~1-2 seconds.
 *
 * Reading from main (instead of each site's `staging/<domain>`) avoids 50+
 * separate tree fetches that were causing the API to time out (>30s).
 */
export async function preloadBriefs(
  domains: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const briefs = new Map<string, Record<string, unknown>>();
  await mapWithConcurrency(domains, 10, async (domain) => {
    try {
      const config = await readSiteConfig(domain); // defaults to main
      const brief = config?.brief as Record<string, unknown> | undefined;
      if (brief) briefs.set(domain, brief);
    } catch {
      // Skip sites whose config can't be read from main
    }
  });
  return briefs;
}

/**
 * Enrich one site: add schedule + article aggregates.
 *
 * Schedule is computed first (instant, from pre-loaded brief, no IO). Article
 * aggregates (KV → Git) are wrapped in a 5s per-site timeout so one slow
 * site doesn't block the entire batch.
 */
export async function enrichSite(
  site: SiteStatsResponse,
  gate: SchedulerGate,
  now: Date,
  preloadedBrief?: Record<string, unknown> | null,
): Promise<EnrichedSiteStats> {
  // ---- Schedule (instant, no IO) ----
  let rawSchedule = site.schedule;
  if (!rawSchedule && preloadedBrief) {
    rawSchedule = buildScheduleFromBrief(preloadedBrief);
  }

  const schedule = rawSchedule
    ? {
        ...rawSchedule,
        nextRun: computeNextRun(gate, rawSchedule.preferredDays, now),
      }
    : null;

  const todayExpected = rawSchedule
    ? computeTodayExpected(
        rawSchedule.articlesPerDay,
        rawSchedule.preferredDays,
        now,
      )
    : 0;

  // ---- Article aggregates (IO, with per-site timeout) ----
  let recentArticles: RecentArticle[] = [];
  let reviewCount = 0;
  let generalImages = 0;
  try {
    const result = await Promise.race([
      articleAggregates(site.siteDomain, "main"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    if (result) {
      ({ recentArticles, reviewCount, generalImages } = result);
    }
  } catch {
    // keep defaults (empty articles, zero counts)
  }

  return {
    ...site,
    recentArticles,
    reviewCount,
    generalImages,
    schedule,
    today: { created: site.today?.created ?? 0, expected: todayExpected },
  };
}
