import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const verticalId = searchParams.get("vertical_id") ?? "";
    const qs = new URLSearchParams({ page_size: "100", include_usage: "true" });
    if (verticalId) qs.set("vertical_id", verticalId);
    const res = await fetch(`${AGGREGATOR_URL}/api/tags?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[tags] GET error:", error);
    return NextResponse.json([], { status: 500 });
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
