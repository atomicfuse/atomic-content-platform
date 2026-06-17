import { NextRequest, NextResponse } from "next/server";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig as readSiteConfig } from "@/lib/db/site-configs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return NextResponse.json({ error: "domain required" }, { status: 400 });

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) return NextResponse.json({ error: "no staging branch" }, { status: 404 });

  const config = await readSiteConfig(domain, site.staging_branch);
  const brief = (config?.brief ?? {}) as Record<string, unknown>;
  const topics = Array.isArray(brief.topics) ? (brief.topics as string[]) : [];
  const bundle_ids = Array.isArray(brief.bundle_ids) ? (brief.bundle_ids as string[]) : [];

  // Determine which bundles are only used by this site by reading every other
  // site's brief.bundle_ids.
  const otherSitesBundleIds = new Set<string>();
  for (const otherSite of index.sites) {
    if (otherSite.domain === domain) continue;
    if (!otherSite.staging_branch) continue;
    try {
      const otherConfig = await readSiteConfig(otherSite.domain, otherSite.staging_branch);
      const otherBundleIds = (otherConfig?.brief as Record<string, unknown> | undefined)?.bundle_ids;
      if (Array.isArray(otherBundleIds)) {
        for (const id of otherBundleIds) {
          if (typeof id === "string") otherSitesBundleIds.add(id);
        }
      }
    } catch {
      // best-effort
    }
  }

  const orphan_bundle_ids = bundle_ids.filter((id) => !otherSitesBundleIds.has(id));

  return NextResponse.json({ topics, bundle_ids, orphan_bundle_ids });
}
