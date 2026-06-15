import { NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function GET(): Promise<NextResponse> {
  try {
    const url = `${getAgentUrl()}/scheduler-summary`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to fetch scheduler summary: ${resp.status} ${text}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch scheduler summary: ${message}` },
      { status: 502 },
    );
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const url = `${getAgentUrl()}/backfill-weekly-summary`;
    const resp = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Backfill failed: ${resp.status} ${text}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Backfill failed: ${message}` },
      { status: 502 },
    );
  }
}
