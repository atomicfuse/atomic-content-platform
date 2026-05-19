/**
 * POST /api/agent/image-callback
 *
 * Public proxy for n8n image generation callbacks.
 * n8n POSTs generated images here; this route forwards them to the internal
 * content-pipeline service at http://content-pipeline-app/image-callback.
 *
 * The dashboard middleware excludes /api/ from auth, so this is reachable
 * without authentication (n8n sends unauthenticated callbacks).
 */
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const agentUrl = getAgentUrl();

  try {
    // Forward the raw body and relevant headers to content-pipeline
    const body = await req.text();

    const headers: Record<string, string> = {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
    };

    // Forward callback secret if present
    const callbackSecret = req.headers.get("x-callback-secret");
    if (callbackSecret) {
      headers["x-callback-secret"] = callbackSecret;
    }

    const response = await fetch(`${agentUrl}/image-callback`, {
      method: "POST",
      headers,
      body,
    });

    const result = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    console.error("[image-callback] Proxy error:", message);
    return NextResponse.json(
      { status: "error", message: `Content agent unavailable: ${message}` },
      { status: 502 },
    );
  }
}
