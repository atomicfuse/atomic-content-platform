import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/**
 * GET /api/queue?status=completed,failed,active&limit=50
 *
 * Proxies to content-pipeline's /jobs endpoint for queue monitoring.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const status = req.nextUrl.searchParams.get("status") ?? "completed,failed,active";
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  const agentUrl = getAgentUrl();

  try {
    const resp = await fetch(
      `${agentUrl}/jobs?status=${encodeURIComponent(status)}&limit=${limit}`,
    );
    const data = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(data, { status: resp.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content pipeline";
    return NextResponse.json(
      { jobs: [], error: message },
      { status: 502 },
    );
  }
}
