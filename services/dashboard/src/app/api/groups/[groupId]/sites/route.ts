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
          const config = await readSiteConfig(site.domain, branch);
          if (!config) return;

          const groups = config.groups as string[] | undefined;
          const group = config.group as string | undefined;
          const siteGroups = groups ?? (group ? [group] : []);

          if (siteGroups.includes(groupId)) {
            results.push({
              domain: site.domain,
              site_name: (config.site_name as string) ?? undefined,
            });
          }
        } catch {
          // Skip sites that fail to read
        }
      }),
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error(`[api/groups/${groupId}/sites] error:`, error);
    return NextResponse.json([], { status: 200 });
  }
}
