import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

/**
 * GET /api/bundles/preview?vertical_id=X&category_ids=a,b&tag_ids=c,d
 * Returns { count } of matching content using GET /api/content (lightweight, cacheable).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const qs = new URLSearchParams({ page_size: "1", enriched: "true" });
    const verticalId = searchParams.get("vertical_id");
    const categoryIds = searchParams.get("category_ids");
    const tagIds = searchParams.get("tag_ids");
    if (verticalId) qs.set("vertical_id", verticalId);
    if (categoryIds) qs.set("category_ids", categoryIds);
    if (tagIds) qs.set("tag_ids", tagIds);

    const res = await fetch(`${AGGREGATOR_URL}/api/content?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json({ count: 0 }, { status: res.status });
    const data = (await res.json()) as { total_count?: number };
    return NextResponse.json({ count: data.total_count ?? 0 });
  } catch (error) {
    console.error("[bundles/preview] error:", error);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
