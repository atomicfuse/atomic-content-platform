import { NextRequest, NextResponse } from "next/server";
import { createOverrides } from "@/lib/shared-pages";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  try {
    const body = (await req.json()) as { sites: string[]; content: string };
    if (!body.sites?.length) {
      return NextResponse.json({ error: "sites array is required" }, { status: 400 });
    }
    if (!body.content && body.content !== "") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    await createOverrides(name, body.sites, body.content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[shared-pages] create override ${name}:`, error);
    return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
  }
}
