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
    // Always return 200 — unavailable flag in body signals queue not ready
    if (!resp.ok || data.unavailable) {
      return NextResponse.json({ jobs: [], error: data.error ?? "Queue not available", unavailable: true });
    }
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content pipeline";
    return NextResponse.json(
      { jobs: [], error: message, unavailable: true },
    );
  }
}
