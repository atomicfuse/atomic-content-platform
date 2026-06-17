import { NextResponse } from "next/server";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig as readSiteConfig } from "@/lib/db/site-configs";

/**
 * GET /api/sites/groups
 * Returns a map of domain -> string[] of group IDs the site belongs to.
 * Reads each site's site.yaml (staging branch with main fallback).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const index = await readDashboardIndex();
    const sites = index.sites.filter(
      (s) => s.staging_branch !== null || s.pages_project !== null,
    );

    const results = await Promise.allSettled(
      sites.map(async (site) => {
        const branch = site.staging_branch ?? undefined;
        let config = await readSiteConfig(site.domain, branch);
        if (!config && branch) {
          config = await readSiteConfig(site.domain, undefined);
        }
        if (!config) return { domain: site.domain, groups: [] as string[] };

        const groups = config.groups as string[] | undefined;
        const group = config.group as string | undefined;
        const siteGroups = groups ?? (group ? [group] : []);
        return { domain: site.domain, groups: siteGroups };
      }),
    );

    const map: Record<string, string[]> = {};
    for (const r of results) {
      if (r.status === "fulfilled") {
        map[r.value.domain] = r.value.groups;
      }
    }

    return NextResponse.json(map, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("[sites/groups] error:", error);
    return NextResponse.json({ error: "Failed to read site groups" }, { status: 500 });
  }
}
