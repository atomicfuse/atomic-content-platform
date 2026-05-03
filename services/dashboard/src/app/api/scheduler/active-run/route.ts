import { NextResponse } from "next/server";

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
 * GET /api/scheduler/active-run
 *
 * Returns the state of the currently active scheduler run (if any).
 * Proxies to content-pipeline which queries BullMQ directly.
 */
export async function GET(): Promise<NextResponse> {
  const agentUrl = getAgentUrl();
  try {
    const resp = await fetch(`${agentUrl}/scheduler/active-run`);
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
