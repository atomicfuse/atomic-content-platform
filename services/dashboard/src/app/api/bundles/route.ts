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
    const qs = new URLSearchParams({ active: "true", page_size: "100" });
    const search = searchParams.get("search");
    if (search) qs.set("search", search);
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return NextResponse.json({ items: [] }, { status: res.status });
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[bundles] GET error:", error);
    return NextResponse.json({ items: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[bundles] POST error:", error);
    return NextResponse.json({ error: "Failed to create bundle" }, { status: 500 });
  }
}
