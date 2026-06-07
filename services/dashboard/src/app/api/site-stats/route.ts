// services/dashboard/src/app/api/site-stats/route.ts
import { NextResponse } from "next/server";

import { readDashboardIndex } from "@/lib/github";
import { readSchedulerConfig } from "@/lib/scheduler";
import {
  enrichSite,
  emptyStats,
  mapWithConcurrency,
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

/**
 * GET /api/site-stats
 *
 * Proxies content-pipeline `GET /site-stats`, merges in every site from
 * dashboard-index.yaml (so never-generated sites still appear with empty
 * stats), and enriches each site with recentArticles + schedule.nextRun.
 *
 * Public route — the dashboard middleware excludes `/api/` from auth, which is
 * acceptable here (the ops console serves external consumers too).
 */
export async function GET(): Promise<NextResponse> {
  const agentUrl = getAgentUrl();

  let sites: SiteStatsResponse[];
  try {
    const res = await fetch(`${agentUrl}/site-stats`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          status: "error",
          message: `Content agent returned HTTP ${res.status} for /site-stats.`,
        },
        { status: 502 },
      );
    }
    const body = (await res.json()) as { sites?: SiteStatsResponse[] };
    sites = Array.isArray(body.sites) ? body.sites : [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }

  // Merge in sites that the pipeline never reported on so they still appear.
  const byDomain = new Map<string, SiteStatsResponse>(
    sites.map((s) => [s.siteDomain, s]),
  );
  try {
    const index = await readDashboardIndex();
    for (const entry of index.sites) {
      if (!byDomain.has(entry.domain)) {
        byDomain.set(entry.domain, emptyStats(entry.domain));
      }
    }
  } catch {
    // If the index can't be read, fall back to just the proxied sites.
  }

  const gate = await readSchedulerConfig();
  const now = new Date();

  const enriched = await mapWithConcurrency(
    [...byDomain.values()],
    5,
    (site) => enrichSite(site, gate, now),
  );

  return NextResponse.json({ sites: enriched });
}
