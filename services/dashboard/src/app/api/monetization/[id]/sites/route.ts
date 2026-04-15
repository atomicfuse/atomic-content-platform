import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import {
  readDashboardIndex,
  readSiteConfig,
  readFileContent,
} from "@/lib/github";

/**
 * GET /api/monetization/:id/sites
 * Returns the list of sites whose effective monetization profile matches
 * the given id. A site's effective profile is `site.monetization` if set,
 * otherwise `org.default_monetization`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const [index, orgRaw] = await Promise.all([
      readDashboardIndex(),
      readFileContent("org.yaml"),
    ]);

    let orgDefault = "";
    if (orgRaw) {
      const orgParsed = (parseYaml(orgRaw) ?? {}) as { default_monetization?: string };
      orgDefault = orgParsed.default_monetization ?? "";
    }

    const results: Array<{
      domain: string;
      site_name?: string;
      group?: string;
      active?: boolean;
      explicit: boolean;
    }> = [];

    await Promise.all(
      index.sites.map(async (site) => {
        try {
          const branch = site.staging_branch ?? undefined;
          const config = await readSiteConfig(site.domain, branch);
          if (!config) return;

          const explicit = config["monetization"] as string | undefined;
          const effective = explicit || orgDefault;
          if (effective !== id) return;

          results.push({
            domain: site.domain,
            site_name: (config["site_name"] as string) ?? undefined,
            group: (config["group"] as string) ?? undefined,
            active: (config["active"] as boolean) ?? undefined,
            explicit: !!explicit,
          });
        } catch {
          // Skip sites that fail to read
        }
      }),
    );

    results.sort((a, b) => a.domain.localeCompare(b.domain));
    return NextResponse.json(results);
  } catch (error) {
    console.error(`[api/monetization/${id}/sites] error:`, error);
    return NextResponse.json([], { status: 200 });
  }
}
