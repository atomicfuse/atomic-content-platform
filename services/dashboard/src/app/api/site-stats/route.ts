// services/dashboard/src/app/api/site-stats/route.ts
//
// Primary data source: MongoDB via content-pipeline /site-stats.
// Git reads (dashboard-index, scheduler config) are best-effort with strict
// timeouts so the route works even when GitHub is rate-limited or unavailable.
import { NextResponse } from "next/server";

import { readDashboardIndex } from "@/lib/github";
import { readSchedulerConfig } from "@/lib/scheduler";
import {
  computeNextRun,
  computeTodayExpected,
  emptyStats,
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

  // 1. Primary: MongoDB stats via content-pipeline
  let sites: SiteStatsResponse[] = [];
  try {
    const res = await fetch(`${agentUrl}/site-stats`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { sites?: SiteStatsResponse[] };
      sites = Array.isArray(body.sites) ? body.sites : [];
    }
  } catch {
    // Pipeline unreachable — proceed with empty; dashboard-index may fill gaps.
  }

  const byDomain = new Map<string, SiteStatsResponse>(
    sites.map((s) => [s.siteDomain, s]),
  );

  // 2. Best-effort: dashboard-index for site metadata + gap-fill (3s timeout).
  //    If Git is rate-limited this resolves instantly with null.
  const index = await withTimeout(
    readDashboardIndex().catch(() => null),
    3_000,
    null,
  );
  if (index) {
    for (const entry of index.sites) {
      if (!byDomain.has(entry.domain)) {
        byDomain.set(entry.domain, emptyStats(entry.domain));
      }
    }
  }

  // 3. Best-effort: scheduler gate for nextRun computation (2s timeout).
  const gate = await withTimeout(
    readSchedulerConfig().catch(() => DEFAULT_GATE),
    2_000,
    DEFAULT_GATE,
  );

  // 4. Pure enrichment: schedule.nextRun + today.expected (no IO)
  const now = new Date();
  const enriched: EnrichedSiteStats[] = [...byDomain.values()].map((site) => {
    const rawSchedule = site.schedule;
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
