import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { domain?: string };
    const domain = body.domain;
    if (!domain || typeof domain !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing required field: domain" },
        { status: 400 },
      );
    }

    const resp = await fetch(`${getAgentUrl()}/seed-kv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { ok: false, error: `seed-kv failed: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, message: `KV re-seed triggered for ${domain}` });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}
