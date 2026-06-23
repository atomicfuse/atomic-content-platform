// services/dashboard/src/app/api/site-stats/route.ts
//
// Primary data source: MongoDB via content-pipeline /site-stats.
// Git reads (dashboard-index, scheduler config) are best-effort with strict
// timeouts so the route works even when GitHub is rate-limited or unavailable.
import { NextResponse } from "next/server";

import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { readSchedulerConfig } from "@/lib/scheduler";
import {
  buildScheduleFromBrief,
  computeNextRun,
  computeTodayExpected,
  emptyStats,
  preloadBriefs,
  type EnrichedSiteStats,
  type SchedulerGate,
  type SiteStatsResponse,
} from "@/lib/site-stats";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/** Default scheduler gate — matches the content-pipeline defaults. */
const DEFAULT_GATE: SchedulerGate = {
  enabled: true,
  run_at_hours: [14],
  timezone: "America/New_York",
};

/** Race a promise against a timeout. Returns fallback on timeout/error. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  } catch {
    return fallback;
  }
}

/**
 * GET /api/site-stats
 *
 * Proxies content-pipeline `GET /site-stats` (MongoDB), then best-effort
 * merges dashboard-index (Git) and computes schedule.nextRun.
 *
 * All Git reads have strict timeouts — if GitHub is rate-limited the route
 * still returns in <6s with MongoDB data alone.
 */
export async function GET(): Promise<NextResponse> {
  const agentUrl = getAgentUrl();

  // All three data sources fetched in parallel — worst case 5s (not 10s).
  const [pipelineResult, index, gate] = await Promise.all([
    // 1. Primary: MongoDB stats via content-pipeline (5s timeout)
    (async (): Promise<SiteStatsResponse[]> => {
      try {
        const res = await fetch(`${agentUrl}/site-stats`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const body = (await res.json()) as { sites?: SiteStatsResponse[] };
          return Array.isArray(body.sites) ? body.sites : [];
        }
      } catch {
        // Pipeline unreachable
      }
      return [];
    })(),
    // 2. Best-effort: dashboard-index (3s timeout)
    withTimeout(readDashboardIndex().catch(() => null), 3_000, null),
    // 3. Best-effort: scheduler gate (2s timeout)
    withTimeout(readSchedulerConfig().catch(() => DEFAULT_GATE), 2_000, DEFAULT_GATE),
  ]);

  const byDomain = new Map<string, SiteStatsResponse>(
    pipelineResult.map((s) => [s.siteDomain, s]),
  );
  if (index) {
    for (const entry of index.sites) {
      if (!byDomain.has(entry.domain)) {
        byDomain.set(entry.domain, emptyStats(entry.domain));
      }
    }
  }

  // 4. Bulk-load briefs for ALL sites (single tree fetch from main, ~1-2s).
  //    Briefs are the source of truth for schedule data — MongoDB may have stale
  //    snapshots from before the topics_v2 migration.
  const allDomains = [...byDomain.keys()];
  const briefs = await withTimeout(
    preloadBriefs(allDomains),
    4_000,
    new Map<string, Record<string, unknown>>(),
  );

  // 5. Pure enrichment: schedule.nextRun + today.expected
  //    Prefer brief-computed schedule; fall back to MongoDB snapshot.
  const now = new Date();
  const enriched: EnrichedSiteStats[] = [...byDomain.values()].map((site) => {
    const brief = briefs.get(site.siteDomain);
    const rawSchedule = (brief ? buildScheduleFromBrief(brief) : null) ?? site.schedule;
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
    return {
      ...site,
      recentArticles: [],
      reviewCount: 0,
      generalImages: 0,
      schedule,
      today: { created: site.today?.created ?? 0, expected: todayExpected },
    };
  });

  return NextResponse.json({ sites: enriched });
}
