import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  readFileContent,
  commitNetworkFiles,
  deleteNetworkFile,
} from "@/lib/github";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const content = await readFileContent(`overrides/config/${id}.yaml`);
    if (content === null) {
      return NextResponse.json(
        { error: "Override not found" },
        { status: 404 },
      );
    }
    const parsed = parseYaml(content) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error(`[api/overrides/${id}] read error:`, error);
    return NextResponse.json(
      { error: "Failed to read override config" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const yamlContent = stringifyYaml(body, { lineWidth: 0 });
    await commitNetworkFiles(
      [{ path: `overrides/config/${id}.yaml`, content: yamlContent }],
      `config(overrides): update ${id}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/overrides/${id}] write error:`, error);
    return NextResponse.json(
      { error: "Failed to update override config" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    await deleteNetworkFile(
      `overrides/config/${id}.yaml`,
      `config(overrides): delete ${id}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/overrides/${id}] delete error:`, error);
    return NextResponse.json(
      { error: "Failed to delete override config" },
      { status: 500 },
    );
  }
}
