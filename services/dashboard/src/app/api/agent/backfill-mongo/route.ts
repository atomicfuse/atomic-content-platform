// Proxy to content-pipeline POST /backfill-mongo or POST /migrate-schedules.
// ?action=migrate-schedules routes to the schedule migration endpoint.
// Accepts optional { domains: string[] } to backfill specific sites only.
import { NextResponse, type NextRequest } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const agentUrl = getAgentUrl();
    const action = request.nextUrl.searchParams.get("action");
    const endpoint = action === "migrate-schedules" ? "/migrate-schedules" : "/backfill-mongo";
    const targetUrl = `${agentUrl}${endpoint}`;

    // Forward the request body (may contain { domains: string[] })
    let forwardBody: string | undefined;
    try {
      const json = await request.json();
      if (json && typeof json === "object") {
        forwardBody = JSON.stringify(json);
      }
    } catch { /* empty body — backfill all */ }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(forwardBody ? { body: forwardBody } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json();
    return NextResponse.json(
      { ...body, _debug: { targetUrl, action, forwardBody: forwardBody ?? null, upstreamStatus: res.status, deployVersion: "v2-debug" } },
      { status: res.status },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), _debug: { deployVersion: "v2-debug" } },
      { status: 502 },
    );
  }
}
