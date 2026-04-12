import { NextRequest, NextResponse } from "next/server";
import { readSharedPage, writeSharedPage, listSharedPages } from "@/lib/shared-pages";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  try {
    const content = await readSharedPage(name);
    const allPages = await listSharedPages();
    const pageInfo = allPages.find((p) => p.name === name);
    return NextResponse.json({
      name,
      content,
      overrides: pageInfo?.overrideSites ?? [],
    });
  } catch (error) {
    console.error(`[shared-pages] read ${name}:`, error);
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  try {
    const body = (await req.json()) as { content: string };
    if (!body.content && body.content !== "") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    await writeSharedPage(name, body.content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[shared-pages] write ${name}:`, error);
    return NextResponse.json({ error: "Failed to save page" }, { status: 500 });
  }
}
