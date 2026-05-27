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

interface RouteParams {
  params: Promise<{ domain: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { domain } = await params;
  const agentUrl = getAgentUrl();

  try {
    const response = await fetch(
      `${agentUrl}/wp-migrate/active-import/${encodeURIComponent(domain)}`,
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { error: `Content agent unavailable: ${message}` },
      { status: 502 },
    );
  }
}
