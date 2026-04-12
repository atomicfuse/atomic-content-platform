import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";

// In local dev, cloudgrid.yaml may inject an internal DNS name (e.g.
// http://content-pipeline-app) that doesn't resolve on the host machine.
// Detect this and fall back to the localhost URL from .env.local.
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/**
 * Proxy to the content-generation agent.
 * POST { siteDomain, branch?, count? }
 * Returns the agent batch result.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain: string;
    branch?: string | null;
    count?: number | null;
  };

  if (!body.siteDomain) {
    return NextResponse.json(
      { status: "error", message: "siteDomain is required" },
      { status: 400 }
    );
  }

  const agentUrl = getAgentUrl();
  try {
    const agentResponse = await fetch(
      `${agentUrl}/content-generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: body.siteDomain,
          ...(body.branch ? { branch: body.branch } : {}),
          ...(body.count ? { count: body.count } : {}),
        }),
      }
    );

    const result = (await agentResponse.json()) as Record<string, unknown>;

    return NextResponse.json(result, { status: agentResponse.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running? (pnpm agent:content-generation)`,
      },
      { status: 502 }
    );
  }
}
