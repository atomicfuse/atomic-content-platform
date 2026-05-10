import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const parentId = searchParams.get("parent_id") ?? "";
    const qs = parentId
      ? `?parent_id=${parentId}&active=true&page_size=100`
      : "?active=true&page_size=100";
    const res = await fetch(`${AGGREGATOR_URL}/api/categories${qs}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[categories] error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
