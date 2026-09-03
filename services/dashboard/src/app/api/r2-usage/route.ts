import { NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function GET(): Promise<NextResponse> {
  try {
    const resp = await fetch(`${getAgentUrl()}/r2-usage`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return NextResponse.json(
        { status: "error", error: `Upstream ${resp.status}` },
        { status: 502 },
      );
    }
    const data: Record<string, unknown> = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: String(err) },
      { status: 502 },
    );
  }
}

/**
 * POST /api/r2-usage — trigger a full R2 bucket scan to recalculate the
 * r2_usage tally in MongoDB. Proxies to content-pipeline POST /backfill-r2.
 * This is a one-time operation; future uploads are tracked incrementally.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const resp = await fetch(`${getAgentUrl()}/backfill-r2`, {
      method: "POST",
      signal: AbortSignal.timeout(120_000), // R2 scan can take a while
    });
    if (!resp.ok) {
      return NextResponse.json(
        { status: "error", error: `Upstream ${resp.status}` },
        { status: 502 },
      );
    }
    const data: Record<string, unknown> = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: String(err) },
      { status: 502 },
    );
  }
}
