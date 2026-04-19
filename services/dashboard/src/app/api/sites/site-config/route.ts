import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import { readDashboardIndex, readSiteConfig, readFileContent } from "@/lib/github";

/**
 * GET /api/sites/site-config?domain=<domain>
 *
 * Returns the site.yaml config from the site's staging branch plus the
 * inheritance chain (org config + group configs) so the frontend can show
 * inheritance badges.
 *
 * Response shape:
 * {
 *   config: <site config object>,
 *   inheritance: {
 *     org: <parsed org.yaml> | null,
 *     groups: Array<{ id: string; config: <parsed group yaml> }>
 *   }
 * }
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

    // Read inheritance chain: org + groups
    const siteGroups = (config.groups as string[] | undefined)
      ?? (config.group ? [config.group as string] : []);

    const [orgYaml, ...groupYamls] = await Promise.all([
      readFileContent("org.yaml"),
      ...siteGroups.map((id) => readFileContent(`groups/${id}.yaml`)),
    ]);

    const orgConfig = orgYaml ? (parseYaml(orgYaml) as Record<string, unknown>) : null;
    const groupConfigs = siteGroups.map((id, i) => ({
      id,
      config: groupYamls[i] ? (parseYaml(groupYamls[i]) as Record<string, unknown>) : null,
    }));

    return NextResponse.json(
      {
        config,
        inheritance: {
          org: orgConfig,
          groups: groupConfigs,
        },
      },
      { headers: { "Cache-Control": "private, max-age=15" } },
    );
  } catch (err) {
    console.error("[sites/site-config] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read site config" },
      { status: 500 },
    );
  }
}
