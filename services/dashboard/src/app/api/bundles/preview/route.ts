import { NextRequest, NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";

/**
 * GET /api/bundles/preview?category_ids=a,b&tag_ids=c,d
 * Returns { count } of matching content using GET /api/content (lightweight, cacheable).
 *
 * Post-2026-04-29: vertical_id filter was removed from the aggregator.
 * Tier-1 category IDs go into category_ids alongside child IDs.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const qs = new URLSearchParams({ page_size: "1", enriched: "true" });
    const categoryIds = searchParams.get("category_ids");
    const tagIds = searchParams.get("tag_ids");
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
