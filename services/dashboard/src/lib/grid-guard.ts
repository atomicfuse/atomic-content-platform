import { NextResponse } from "next/server";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { isGridSiteConfig } from "@/lib/grid-config";

/**
 * Server-only counterpart to `isGridSiteConfig` (src/lib/grid-config.ts) for
 * routes that only have a domain, not an already-loaded site config. Kept out
 * of grid-config.ts because grid-config.ts is imported by client components
 * (e.g. ContentAgentTab) and pulling in the Mongo/GitHub read layer here would
 * drag server-only code into the client bundle.
 *
 * Reads the same way the site detail page does: prefer the staging branch,
 * fall back to main if the staging branch is gone.
 */
export async function isGridSiteDomain(domain: string): Promise<boolean> {
  const index = await getDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  const branch = site?.staging_branch ?? undefined;
  let config = await getSiteConfig(domain, branch);
  if (!config && branch) {
    config = await getSiteConfig(domain, undefined);
  }
  return isGridSiteConfig(config);
}

/**
 * Article-generation guard: Grid sites aggregate stories from other network
 * sites and never generate their own articles (see task H-A). Routes that
 * start or commit article generation call this first and return its result
 * (non-null) directly when the site is a Grid site.
 */
export async function gridGenerationGuard(domain: string): Promise<NextResponse | null> {
  if (await isGridSiteDomain(domain)) {
    return NextResponse.json(
      { error: "Grid sites don't generate their own articles" },
      { status: 409 },
    );
  }
  return null;
}
