import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:3001";

/**
 * Proxy to the content-generation agent.
 * POST { siteDomain, rssUrl }
 * Returns the agent result + pipeline metadata.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain: string;
    rssUrl: string;
  };

  if (!body.siteDomain || !body.rssUrl) {
    return NextResponse.json(
      { status: "error", message: "siteDomain and rssUrl are required" },
      { status: 400 }
    );
  }

  try {
    const agentResponse = await fetch(
      `${CONTENT_AGENT_URL}/content-generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: body.siteDomain,
          rssUrl: body.rssUrl,
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
