import { NextRequest, NextResponse } from "next/server";
import { readAdsTxtProfile, writeAdsTxtProfile, deleteAdsTxtProfile } from "@/lib/shared-pages";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  try {
    const content = await readAdsTxtProfile(name);
    if (content === null) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ name, content });
  } catch (error) {
    console.error(`[ads-txt] read profile ${name}:`, error);
    return NextResponse.json({ error: "Failed to read profile" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  try {
    const body = (await req.json()) as { content: string };
    await writeAdsTxtProfile(name, body.content ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[ads-txt] update profile ${name}:`, error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  if (name === "default") {
    return NextResponse.json({ error: "Cannot delete the default profile" }, { status: 400 });
  }
  try {
    await deleteAdsTxtProfile(name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[ads-txt] delete profile ${name}:`, error);
    return NextResponse.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
