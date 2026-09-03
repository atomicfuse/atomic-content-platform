// services/dashboard/src/app/api/site-checks/[domain]/route.ts
import { NextResponse } from "next/server";

import { fetchDomainChecks } from "@/lib/domains-dashboard";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import {
  mergeSite,
  naExternal,
  type AtlChecks,
  type MergedSite,
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
 * Fetch content-pipeline `/site-checks/<folder>` for one site's sync/tracking.
 * Failure-isolated: any error → null (caller falls back to unknown).
 */
async function fetchAtlForFolder(folder: string): Promise<AtlChecks | null> {
  try {
    const res = await fetch(
      `${getAgentUrl()}/site-checks/${encodeURIComponent(folder)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { site?: AtlChecks } & Partial<AtlChecks>;
    // Endpoint returns the single site object; accept either a `site` wrapper
    // or the bare object.
    const site = body.site ?? (body as AtlChecks);
    if (site && typeof site.siteDomain === "string") return site;
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/site-checks/[domain]
 *
 * `domain` is the SITE FOLDER NAME (consistent with the rest of the dashboard).
 * Looks up the site's `custom_domain` from the dashboard index, fetches
 * sync/tracking from content-pipeline (by folder) and uptime/ssl/domain from
 * the Domains Dashboard (by custom domain, or n/a if staging-only). 404 if the
 * folder isn't in the index.
 *
 * Public route — middleware excludes `/api/` from auth (landmine #35).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;

  const index = await readDashboardIndex();
  const entry = index.sites.find((s) => s.domain === domain);
  if (!entry) {
    return NextResponse.json(
      { status: "error", message: `Site '${domain}' not found in index.` },
      { status: 404 },
    );
  }

  const [atl, external] = await Promise.all([
    fetchAtlForFolder(domain),
    entry.custom_domain
      ? fetchDomainChecks(entry.custom_domain)
      : Promise.resolve(naExternal()),
  ]);

  const merged: MergedSite = mergeSite(
    { domain: entry.domain, custom_domain: entry.custom_domain },
    atl ? new Map([[entry.domain, atl]]) : new Map(),
    entry.custom_domain ? new Map([[entry.custom_domain, external]]) : new Map(),
  );

  return NextResponse.json(merged);
}
