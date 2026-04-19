import { NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(`${AGGREGATOR_URL}/api/verticals?page_size=100&active=true`, {
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
    console.error("[verticals] error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
