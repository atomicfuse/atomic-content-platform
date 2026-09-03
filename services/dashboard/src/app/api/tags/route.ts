import { NextRequest, NextResponse } from "next/server";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") ?? "";
    const ids = searchParams.get("ids") ?? "";
    const sort = searchParams.get("sort") ?? "";
    const order = searchParams.get("order") ?? "";
    // Clamp to the documented aggregator max of 100.
    const pageSizeRaw = parseInt(searchParams.get("page_size") ?? "20", 10);
    const pageSize = String(Math.min(Number.isFinite(pageSizeRaw) ? pageSizeRaw : 20, 100));
    const page = searchParams.get("page");
    const qs = new URLSearchParams({ page_size: pageSize, include_usage: "true" });
    if (ids) qs.set("ids", ids);
    if (search) qs.set("search", search);
    if (sort) qs.set("sort", sort);
    if (order) qs.set("order", order);
    if (page) qs.set("page", page);
    const res = await fetch(`${AGGREGATOR_URL}/api/tags?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return NextResponse.json({ items: [] }, { status: res.status });
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[tags] GET error:", error);
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[tags] POST error:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}
