import { NextRequest, NextResponse } from "next/server";
import { listAdsTxtProfiles, writeAdsTxtProfile } from "@/lib/shared-pages";

export async function GET(): Promise<NextResponse> {
  try {
    const profiles = await listAdsTxtProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    console.error("[ads-txt] list profiles:", error);
    return NextResponse.json({ error: "Failed to list profiles" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { name: string; content: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await writeAdsTxtProfile(body.name.trim(), body.content ?? "");
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[ads-txt] create profile:", error);
    return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
  }
}
