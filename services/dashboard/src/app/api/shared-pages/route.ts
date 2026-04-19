import { NextResponse } from "next/server";
import { listSharedPages } from "@/lib/shared-pages";

export async function GET(): Promise<NextResponse> {
  try {
    const pages = await listSharedPages();
    return NextResponse.json(pages, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("[shared-pages] list error:", error);
    return NextResponse.json(
      { error: "Failed to list shared pages" },
      { status: 500 },
    );
  }
}
