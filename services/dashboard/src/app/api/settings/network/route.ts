import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileContent, commitNetworkFiles } from "@/lib/github";

export async function GET(): Promise<NextResponse> {
  try {
    const content = await readFileContent("network.yaml");
    if (content === null) {
      return NextResponse.json(
        { error: "network.yaml not found" },
        { status: 404 },
      );
    }
    const parsed = parseYaml(content) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("[api/settings/network] read error:", error);
    return NextResponse.json(
      { error: "Failed to read network settings" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const yamlContent = stringifyYaml(body, { lineWidth: 0 });
    await commitNetworkFiles(
      [{ path: "network.yaml", content: yamlContent }],
      "config: update network settings",
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/settings/network] write error:", error);
    return NextResponse.json(
      { error: "Failed to update network settings" },
      { status: 500 },
    );
  }
}
