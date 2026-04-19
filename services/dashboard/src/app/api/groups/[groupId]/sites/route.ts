import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import {
  readDashboardIndex,
  readSiteConfig,
  commitSiteFiles,
  triggerWorkflowViaPush,
} from "@/lib/github";

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

/**
 * POST /api/groups/:groupId/sites
 * Add or remove a site from this group.
 * Body: { domain: string, action: "add" | "remove" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<NextResponse> {
  const { groupId } = await params;
  let body: { domain: string; action: "add" | "remove" };
  try {
    body = (await req.json()) as { domain: string; action: "add" | "remove" };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { domain, action } = body;
  if (!domain || !["add", "remove"].includes(action)) {
    return NextResponse.json(
      { error: "domain and action (add|remove) are required" },
      { status: 400 },
    );
  }

  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const branch = site.staging_branch ?? undefined;
    let config = await readSiteConfig(domain, branch);
    if (!config && branch) {
      config = await readSiteConfig(domain, undefined);
    }
    if (!config) {
      return NextResponse.json(
        { error: "Could not read site config" },
        { status: 400 },
      );
    }

    // Normalize current groups
    const currentGroups: string[] =
      (config.groups as string[] | undefined) ??
      (config.group ? [config.group as string] : []);

    let updated: string[];
    if (action === "add") {
      updated = currentGroups.includes(groupId)
        ? currentGroups
        : [...currentGroups, groupId];
    } else {
      updated = currentGroups.filter((g) => g !== groupId);
    }

    config.groups = updated;
    // Clean up legacy field
    delete config.group;

    const targetBranch = site.staging_branch ?? "main";
    await commitSiteFiles(
      domain,
      [
        {
          path: `sites/${domain}/site.yaml`,
          content: stringifyYaml(config, { lineWidth: 0 }),
        },
      ],
      `config(site): ${action} group '${groupId}' ${action === "add" ? "to" : "from"} ${domain}`,
      targetBranch,
    );
    await triggerWorkflowViaPush(targetBranch, domain);

    return NextResponse.json({ status: "ok", groups: updated });
  } catch (error) {
    console.error(`[api/groups/${groupId}/sites] POST error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
