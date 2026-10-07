import { NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects a stale CONTENT_AGGREGATOR_URL (CLAUDE.md #20).
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";

/** GET /api/aggregator/sources — aggregator source names for the Grid "Blocked sources" picker. */
export async function GET(): Promise<NextResponse> {
  try {
    const base = AGGREGATOR_URL.replace(/\/+$/, "").replace(/\/api$/, "");
    const res = await fetch(`${base}/api/sources?page_size=200`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return NextResponse.json({ sources: [] }, { status: res.status });
    const data = (await res.json()) as { items?: Array<{ name?: string }> };
    const names = (data.items ?? []).map((s) => s.name?.trim()).filter((n): n is string => !!n);
    return NextResponse.json({ sources: [...new Set(names)].sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    console.error("[aggregator/sources] error:", error);
    return NextResponse.json({ sources: [] }, { status: 500 });
  }
}
