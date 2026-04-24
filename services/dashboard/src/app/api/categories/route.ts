import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const verticalId = searchParams.get("vertical_id") ?? "";
    const qs = verticalId
      ? `?vertical_id=${verticalId}&active=true&page_size=100`
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
