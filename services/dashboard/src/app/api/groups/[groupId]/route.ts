import { NextRequest, NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  readFileContent,
  commitNetworkFiles,
  deleteNetworkFile,
} from "@/lib/github";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<NextResponse> {
  const { groupId } = await params;
  try {
    const content = await readFileContent(`groups/${groupId}.yaml`);
    if (content === null) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 },
      );
    }
    const parsed = parseYaml(content) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error(`[api/groups/${groupId}] read error:`, error);
    return NextResponse.json(
      { error: "Failed to read group config" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<NextResponse> {
  const { groupId } = await params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const yamlContent = stringifyYaml(body, { lineWidth: 0 });
    await commitNetworkFiles(
      [{ path: `groups/${groupId}.yaml`, content: yamlContent }],
      `config(groups): update ${groupId}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/groups/${groupId}] write error:`, error);
    return NextResponse.json(
      { error: "Failed to update group config" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
): Promise<NextResponse> {
  const { groupId } = await params;
  try {
    await deleteNetworkFile(
      `groups/${groupId}.yaml`,
      `config(groups): delete ${groupId}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/groups/${groupId}] delete error:`, error);
    return NextResponse.json(
      { error: "Failed to delete group config" },
      { status: 500 },
    );
  }
}
