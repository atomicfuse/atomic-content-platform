// services/dashboard/src/app/api/site-costs/route.ts
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
 * GET /api/site-costs
 *
 * Thin proxy to content-pipeline `GET /site-costs` (all sites).
 *
 * Public route — the dashboard middleware excludes `/api/` from auth (landmine #35).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(`${getAgentUrl()}/site-costs`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          status: "error",
          message: `Content agent returned HTTP ${res.status} for /site-costs.`,
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
        message: `Content agent unavailable: ${message}.`,
      },
      { status: 502 },
    );
  }
}
