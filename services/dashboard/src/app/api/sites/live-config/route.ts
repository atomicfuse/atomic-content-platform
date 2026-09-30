import { NextResponse } from "next/server";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getKVEntry } from "@/lib/cloudflare";
import { getKvNamespaces } from "@/lib/constants";
import type { DashboardSiteEntry } from "@/types/dashboard";
import type { LiveConfigEntry } from "@/lib/site-columns";

/**
 * `/api/sites/live-config` — resolved per-site config values for the Sites
 * table's optional "live" columns (Template, tracking IDs, articles/day,
 * last sync). See task-I-brief.md §3.
 *
 * Reads `site-config:<domain>` (resolved config — tracking IDs inherited
 * from groups/org are included) and `sync-status:<domain>` from KV: prod
 * namespace for Live sites, staging namespace otherwise. A failed or
 * missing read for one site never fails the whole response — that site
 * just comes back all-null.
 */

const CONCURRENCY = 8;
const READ_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60_000;

let cache: { data: Record<string, LiveConfigEntry>; expiresAt: number } | null = null;

/** Minimal shape read out of the resolved `site-config:<domain>` JSON —
 *  only the fields this endpoint needs, all optional since KV content is
 *  untrusted at the type level. */
interface ParsedSiteConfig {
  theme?: { template?: "modern" | "grid" };
  tracking?: {
    ga4?: string | null;
    facebook_pixel?: string | null;
    gtm?: string | null;
    google_ads?: string | null;
  };
  brief?: {
    schedule?: {
      articles_per_day?: number;
      articles_per_week?: number;
      preferred_days?: string[];
    };
  };
}

interface ParsedSyncStatus {
  syncedAt?: string;
}

type ParsedSchedule = NonNullable<NonNullable<ParsedSiteConfig["brief"]>["schedule"]>;

function emptyEntry(): LiveConfigEntry {
  return {
    template: null,
    ga4: null,
    facebook_pixel: null,
    gtm: null,
    google_ads: null,
    articles_per_day: null,
    publish_days: null,
    last_synced_at: null,
  };
}

/**
 * Mirrors `resolveArticlesPerDay` in
 * services/content-pipeline/src/agents/scheduled-publisher/index.ts (~L148)
 * — the scheduler's own source of truth for "articles per day" (CLAUDE.md
 * landmine #6). Replicated here rather than imported: dashboard and
 * content-pipeline are separate services with no shared runtime dependency,
 * matching the pattern already used for this exact formula in
 * services/content-pipeline/src/stats/schedule.ts. Keep in sync if that
 * function ever changes.
 */
function resolveArticlesPerDay(schedule: ParsedSchedule | undefined): number | null {
  if (!schedule) return null;
  if (typeof schedule.articles_per_day === "number" && schedule.articles_per_day > 0) {
    return schedule.articles_per_day;
  }
  const perWeek = schedule.articles_per_week ?? 0;
  if (perWeek <= 0) return null;
  const daysCount = schedule.preferred_days?.length || 7;
  return Math.max(1, Math.ceil(perWeek / daysCount));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]!);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function readLiveConfigForSite(site: DashboardSiteEntry): Promise<LiveConfigEntry> {
  try {
    const namespaces = getKvNamespaces(site.domain);
    const namespaceId = site.status === "Live" ? namespaces.prod : namespaces.staging;

    const [configRaw, syncRaw] = await Promise.all([
      withTimeout(
        getKVEntry(namespaceId, `site-config:${site.domain}`, site.domain),
        READ_TIMEOUT_MS,
      ),
      withTimeout(
        getKVEntry(namespaceId, `sync-status:${site.domain}`, site.domain),
        READ_TIMEOUT_MS,
      ),
    ]);

    const entry = emptyEntry();

    if (configRaw) {
      const config = JSON.parse(configRaw) as ParsedSiteConfig;
      entry.template = config.theme?.template === "grid" ? "grid" : "modern";
      entry.ga4 = config.tracking?.ga4 ?? null;
      entry.facebook_pixel = config.tracking?.facebook_pixel ?? null;
      entry.gtm = config.tracking?.gtm ?? null;
      entry.google_ads = config.tracking?.google_ads ?? null;
      entry.articles_per_day = resolveArticlesPerDay(config.brief?.schedule);
      const days = config.brief?.schedule?.preferred_days;
      entry.publish_days = Array.isArray(days)
        ? days.filter((d): d is string => typeof d === "string")
        : null;
    }

    if (syncRaw) {
      const sync = JSON.parse(syncRaw) as ParsedSyncStatus;
      entry.last_synced_at = sync.syncedAt ?? null;
    }

    return entry;
  } catch (error) {
    console.warn(`[sites/live-config] failed to read live config for "${site.domain}":`, error);
    return emptyEntry();
  }
}

export async function GET(): Promise<NextResponse> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.data);
  }

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.warn("[sites/live-config] Cloudflare credentials not configured — returning {}");
    return NextResponse.json({});
  }

  let sites: DashboardSiteEntry[];
  try {
    sites = (await getDashboardIndex()).sites;
  } catch (error) {
    console.error("[sites/live-config] failed to read dashboard index:", error);
    return NextResponse.json({});
  }

  const entries = await mapWithConcurrency(sites, CONCURRENCY, async (site) => {
    return [site.domain, await readLiveConfigForSite(site)] as const;
  });

  const data: Record<string, LiveConfigEntry> = {};
  for (const [domain, entry] of entries) data[domain] = entry;

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json(data);
}
