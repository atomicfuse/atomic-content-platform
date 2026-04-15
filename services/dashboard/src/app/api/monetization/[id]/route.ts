import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  readFileContent,
  commitNetworkFiles,
  deleteNetworkFile,
} from "@/lib/github";

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
