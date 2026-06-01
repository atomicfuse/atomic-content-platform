import { NextRequest, NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const parentId = searchParams.get("parent_id") ?? "";
    // No parent_id → fetch ALL categories (tier-1s + every subcat across the
    // taxonomy). The aggregator's taxonomy is ~12 tier-1s × 10–15 subcats; 500
    // is comfortably above that ceiling.
    const qs = parentId
      ? `?parent_id=${parentId}&active=true&page_size=100`
      : "?active=true&page_size=500";
    const url = `${AGGREGATOR_URL}/api/categories${qs}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[categories] ${res.status} from ${url}`);
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    console.error("[categories] error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
