import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[bundles/preview] error:", error);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
