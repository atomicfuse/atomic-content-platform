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

import { readArticles } from "@/lib/github";
import { readArticlesWithKVFallback } from "@/lib/kv-api";
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
      const gitArticles = await readArticles(domain, branch);
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
 * Enumeration goes through `readArticlesWithKVFallback` (cache → KV → Git) ONCE.
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
    entries = await readArticlesWithKVFallback(domain, branch, readArticles);
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
