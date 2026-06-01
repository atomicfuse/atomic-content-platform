// services/dashboard/src/app/api/agent/job/[id]/route.ts
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
 * GET /api/agent/job/[id]
 *
 * Proxies to content-pipeline's /job/:id endpoint for job status polling.
 * Used when the generate route returns 202 (job still running after 90s).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const agentUrl = getAgentUrl();

  try {
    const resp = await fetch(`${agentUrl}/job/${id}`);
    const result = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(result, { status: resp.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { status: "error", message },
      { status: 502 },
    );
  }
}
