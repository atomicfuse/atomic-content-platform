import { NextRequest, NextResponse } from "next/server";
import { readAdsTxtAssignments, writeAdsTxtAssignments } from "@/lib/shared-pages";

export async function GET(): Promise<NextResponse> {
  try {
    const assignments = await readAdsTxtAssignments();
    return NextResponse.json(assignments);
  } catch (error) {
    console.error("[ads-txt] read assignments:", error);
    return NextResponse.json({ error: "Failed to read assignments" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, string>;
    await writeAdsTxtAssignments(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ads-txt] write assignments:", error);
    return NextResponse.json({ error: "Failed to save assignments" }, { status: 500 });
  }
}
