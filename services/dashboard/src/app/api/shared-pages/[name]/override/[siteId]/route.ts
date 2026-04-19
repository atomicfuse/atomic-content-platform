import { NextRequest, NextResponse } from "next/server";
import { deleteOverride, readOverride, updateOverride } from "@/lib/shared-pages";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string; siteId: string }> },
): Promise<NextResponse> {
  const { name, siteId } = await params;
  try {
    const content = await readOverride(name, siteId);
    if (content === null) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }
    return NextResponse.json({ name, siteId, content });
  } catch (error) {
    console.error(`[shared-pages] read override ${name}/${siteId}:`, error);
    return NextResponse.json({ error: "Failed to read override" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string; siteId: string }> },
): Promise<NextResponse> {
  const { name, siteId } = await params;
  try {
    const body = (await req.json()) as { content: string };
    if (body.content === undefined || body.content === null) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    await updateOverride(name, siteId, body.content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[shared-pages] update override ${name}/${siteId}:`, error);
    return NextResponse.json({ error: "Failed to update override" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string; siteId: string }> },
): Promise<NextResponse> {
  const { name, siteId } = await params;
  try {
    await deleteOverride(name, siteId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[shared-pages] delete override ${name}/${siteId}:`, error);
    return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
  }
}
