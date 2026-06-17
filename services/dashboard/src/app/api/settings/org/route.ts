import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileContent, commitNetworkFiles, invalidateSiteCaches } from "@/lib/github";
import { revalidatePath } from "next/cache";
import { upsertOrgConfig } from "@/lib/db/configs";

export async function GET(): Promise<NextResponse> {
  try {
    const content = await readFileContent("org.yaml");
    if (content === null) {
      return NextResponse.json(
        { error: "org.yaml not found" },
        { status: 404 },
      );
    }
    const parsed = parseYaml(content) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("[api/settings/org] read error:", error);
    return NextResponse.json(
      { error: "Failed to read org settings" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const yamlContent = stringifyYaml(body, { lineWidth: 0 });
    await commitNetworkFiles(
      [{ path: "org.yaml", content: yamlContent }],
      "config: update org settings",
    );

    // Dual-write: mirror org config to MongoDB (soft-fail)
    await upsertOrgConfig(body);

    invalidateSiteCaches("", "main");
    revalidatePath("/settings");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/settings/org] write error:", error);
    return NextResponse.json(
      { error: "Failed to update org settings" },
      { status: 500 },
    );
  }
}
