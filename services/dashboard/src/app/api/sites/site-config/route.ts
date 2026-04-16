import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex, readSiteConfig } from "@/lib/github";

/**
 * GET /api/sites/site-config?domain=<domain>
 *
 * Returns the raw site.yaml config from the site's staging branch (or main if
 * no staging branch). Used by tabs in the site detail page that need to
 * inspect inheritance-relevant fields like `groups`, `tracking`,
 * `groups`, etc.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json(
      { error: "domain query param is required" },
      { status: 400 },
    );
  }

  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const config = await readSiteConfig(domain, site.staging_branch ?? undefined);
    if (!config) {
      return NextResponse.json(
        { error: "site.yaml not found on staging branch" },
        { status: 404 },
      );
    }
    return NextResponse.json(config, {
      headers: { "Cache-Control": "private, max-age=15" },
    });
  } catch (err) {
    console.error("[sites/site-config] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read site config" },
      { status: 500 },
    );
  }
}
