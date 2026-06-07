// services/dashboard/src/app/api/site-stats/[domain]/route.ts
import { NextResponse } from "next/server";

import { readSchedulerConfig } from "@/lib/scheduler";
import { enrichSite, type SiteStatsResponse } from "../route";

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
 * GET /api/site-stats/:domain
 *
 * Proxies content-pipeline `GET /site-stats/:domain` and enriches the single
 * site with recentArticles + schedule.nextRun. Public route (see /api/site-stats).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;
  const agentUrl = getAgentUrl();

  let site: SiteStatsResponse;
  try {
    const res = await fetch(
      `${agentUrl}/site-stats/${encodeURIComponent(domain)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return NextResponse.json(
        {
          status: "error",
          message: `Content agent returned HTTP ${res.status} for /site-stats/${domain}.`,
        },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    const body = (await res.json()) as { site?: SiteStatsResponse };
    if (!body.site) {
      return NextResponse.json(
        { status: "error", message: `No stats returned for ${domain}.` },
        { status: 502 },
      );
    }
    site = body.site;
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

  const gate = await readSchedulerConfig();
  const enriched = await enrichSite(site, gate, new Date());

  return NextResponse.json({ site: enriched });
}
