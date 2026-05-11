import { NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";

/**
 * GET /api/verticals
 *
 * Post-2026-04-29 collapse: verticals no longer exist as a separate entity.
 * Tier-1 categories (parent_id: null) carry the same semantic. This route
 * proxies to GET /api/categories?parent_id=null so all existing consumers
 * (useVerticals, StepNicheTargeting, ContentAgentTab) keep working without
 * changing their fetch URL.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(
      `${AGGREGATOR_URL}/api/categories?parent_id=null&page_size=100`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[verticals] error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
