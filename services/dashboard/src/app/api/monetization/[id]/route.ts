import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  readFileContent,
  readDashboardIndex,
  readSiteConfig,
  commitNetworkFiles,
  deleteNetworkFile,
  triggerWorkflowViaPush,
} from "@/lib/github";

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Rebuild all Live sites that reference the given monetization profile
 * (explicitly via `site.monetization` or implicitly via
 * `org.default_monetization`). Touches `sites/<domain>/.build-trigger` on
 * `main` to fire the Cloudflare Pages production deploy workflow.
 *
 * Failures per site are logged but do not abort the overall update — the YAML
 * has already been committed at this point, and the user-visible response
 * should not fail on a downstream rebuild hiccup.
 */
async function rebuildSitesUsingMonetization(id: string): Promise<void> {
  try {
    const [index, orgRaw] = await Promise.all([
      readDashboardIndex(),
      readFileContent("org.yaml"),
    ]);

    let orgDefault = "";
    if (orgRaw) {
      const orgParsed = (parseYaml(orgRaw) ?? {}) as {
        default_monetization?: string;
      };
      orgDefault = orgParsed.default_monetization ?? "";
    }

    await Promise.all(
      index.sites
        .filter((site) => site.status === "Live")
        .map(async (site) => {
          try {
            // Live sites: their authoritative site.yaml lives on main.
            const config = await readSiteConfig(site.domain, "main");
            if (!config) return;
            const explicit = config["monetization"] as string | undefined;
            const effective = explicit || orgDefault;
            if (effective !== id) return;
            await triggerWorkflowViaPush("main", site.domain);
          } catch (err) {
            console.error(
              `[monetization rebuild] ${site.domain} failed:`,
              err,
            );
          }
        }),
    );
  } catch (err) {
    console.error(
      `[monetization rebuild] failed to enumerate sites for ${id}:`,
      err,
    );
  }
}

/**
 * GET /api/monetization/:id
 * Returns the parsed monetization profile YAML for `monetization/<id>.yaml`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const content = await readFileContent(`monetization/${id}.yaml`);
    if (content === null) {
      return NextResponse.json(
        { error: "Monetization profile not found" },
        { status: 404 },
      );
    }
    const parsed = (parseYaml(content) ?? {}) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error(`[api/monetization/${id}] read error:`, error);
    return NextResponse.json(
      { error: "Failed to read monetization profile" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/monetization/:id
 * Creates or replaces `monetization/<id>.yaml` with the JSON body serialized
 * as YAML. Validates the id against kebab-case before writing.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!KEBAB_CASE_REGEX.test(id)) {
    return NextResponse.json(
      { error: "Invalid id (must be kebab-case)" },
      { status: 400 },
    );
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Always set the monetization_id field to match the filename for clarity.
    const payload = { monetization_id: id, ...body };
    const yamlContent = stringifyYaml(payload, { lineWidth: 0 });

    await commitNetworkFiles(
      [{ path: `monetization/${id}.yaml`, content: yamlContent }],
      `config(monetization): update ${id}`,
    );

    // Trigger production rebuild of every Live site using this profile so the
    // new tracking / ad placements / scripts go out without a manual touch.
    await rebuildSitesUsingMonetization(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/monetization/${id}] write error:`, error);
    return NextResponse.json(
      { error: "Failed to update monetization profile" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/monetization/:id
 * Removes the `monetization/<id>.yaml` file from the network repo.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    await deleteNetworkFile(
      `monetization/${id}.yaml`,
      `config(monetization): delete ${id}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/monetization/${id}] delete error:`, error);
    return NextResponse.json(
      { error: "Failed to delete monetization profile" },
      { status: 500 },
    );
  }
}
