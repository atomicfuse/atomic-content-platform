// services/dashboard/src/app/api/attention/[domain]/route.ts
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
 * GET /api/attention/:domain
 *
 * Thin proxy to content-pipeline `GET /attention/:domain` — the alerting
 * conditions for a single site. Public route (see /api/site-stats).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;
  const agentUrl = getAgentUrl();

  try {
    const res = await fetch(
      `${agentUrl}/attention/${encodeURIComponent(domain)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return NextResponse.json(
        {
          status: "error",
          message: `Content agent returned HTTP ${res.status} for /attention/${domain}.`,
        },
        { status: 502 },
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }
}
