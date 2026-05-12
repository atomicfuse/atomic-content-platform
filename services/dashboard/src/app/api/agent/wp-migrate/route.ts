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
 * POST /api/agent/wp-migrate
 *
 * Proxies the request to content-pipeline's /wp-migrate endpoint
 * and streams SSE progress events back to the client.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as {
    siteDomain: string;
    wpApiUrl: string;
  };

  if (!body.siteDomain || !body.wpApiUrl) {
    return NextResponse.json(
      { status: "error", message: "siteDomain and wpApiUrl are required" },
      { status: 400 },
    );
  }

  const agentUrl = getAgentUrl();

  try {
    const response = await fetch(`${agentUrl}/wp-migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: body.siteDomain,
        wpApiUrl: body.wpApiUrl,
      }),
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      return NextResponse.json(
        {
          status: "error",
          message: text || `Upstream returned ${response.status}`,
        },
        { status: response.status },
      );
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: unknown) {
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
