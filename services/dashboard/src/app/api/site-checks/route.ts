// services/dashboard/src/app/api/site-checks/route.ts
import { NextResponse } from "next/server";

import { fetchAllDomains } from "@/lib/domains-dashboard";
import { readDashboardIndex } from "@/lib/github";
import {
  mergeChecks,
  type AtlChecks,
  type IndexSite,
} from "@/lib/site-checks";

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
 * Fetch content-pipeline `/site-checks` and index by site folder name.
 * Failure-isolated: any error → empty map (sync/tracking fall back to unknown).
 */
async function fetchAtlByFolder(): Promise<Map<string, AtlChecks>> {
  const map = new Map<string, AtlChecks>();
  try {
    const res = await fetch(`${getAgentUrl()}/site-checks`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return map;
    const body = (await res.json()) as { sites?: AtlChecks[] };
    const sites = Array.isArray(body.sites) ? body.sites : [];
    for (const s of sites) {
      if (s && typeof s.siteDomain === "string") map.set(s.siteDomain, s);
    }
  } catch {
    // Content agent unavailable — leave map empty; sync/tracking → unknown.
  }
  return map;
}

/**
 * GET /api/site-checks
 *
 * Merges the external Domains Dashboard (uptime/ssl/domain, keyed by custom
 * domain) with content-pipeline `/site-checks` (sync/tracking, keyed by site
 * folder name). The dashboard index is the authoritative site list.
 *
 * Failure isolation: each upstream is wrapped so one failure doesn't blank
 * everything — a downed content agent yields sync/tracking = unknown while
 * external checks still return, and vice versa. Always responds 200 as long as
 * the dashboard index is readable.
 *
 * Public route — the dashboard middleware excludes `/api/` from auth (landmine
 * #35), which is acceptable here (the ops console serves external consumers).
 */
export async function GET(): Promise<NextResponse> {
  // Both upstreams are failure-isolated internally, so fetch in parallel.
  const [externalByDomain, atlByFolder] = await Promise.all([
    fetchAllDomains(), // already returns empty Map on any failure
    fetchAtlByFolder(),
  ]);

  let indexSites: IndexSite[];
  try {
    const index = await readDashboardIndex();
    indexSites = index.sites.map((s) => ({
      domain: s.domain,
      custom_domain: s.custom_domain,
    }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read dashboard index";
    return NextResponse.json(
      { status: "error", message: `Dashboard index unavailable: ${message}.` },
      { status: 502 },
    );
  }

  const sites = mergeChecks(indexSites, atlByFolder, externalByDomain);

  return NextResponse.json({ sites });
}
