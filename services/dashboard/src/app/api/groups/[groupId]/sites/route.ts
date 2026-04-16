import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex, readSiteConfig } from "@/lib/github";

/**
 * GET /api/groups/:groupId/sites
 * Returns list of sites that belong to this group.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<NextResponse> {
  const { groupId } = await params;
  try {
    const index = await readDashboardIndex();
    const results: Array<{ domain: string; site_name?: string }> = [];

    // Check each site's config for group membership
    await Promise.all(
      index.sites.map(async (site) => {
        try {
          const branch = site.staging_branch ?? undefined;
          let config = await readSiteConfig(site.domain, branch);

          // Fallback: if staging branch returned nothing, try main
          if (!config && branch) {
            config = await readSiteConfig(site.domain, undefined);
          }
          if (!config) return;

          const groups = config.groups as string[] | undefined;
          const group = config.group as string | undefined;
          const monetization = config.monetization as string | undefined;
          const siteGroups = groups ?? (group ? [group] : []);

          // Backward compat: monetization field acts as an additional group
          if (monetization && !siteGroups.includes(monetization)) {
            siteGroups.push(monetization);
          }

          if (siteGroups.includes(groupId)) {
            results.push({
              domain: site.domain,
              site_name: (config.site_name as string) ?? undefined,
            });
          }
        } catch (err) {
          console.error(
            `[api/groups/${groupId}/sites] failed to read site ${site.domain}:`,
            err,
          );
        }
      }),
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error(`[api/groups/${groupId}/sites] error:`, error);
    return NextResponse.json([], { status: 200 });
  }
}
