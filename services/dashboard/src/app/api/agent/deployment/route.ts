import { NextResponse } from "next/server";

/**
 * GET /api/agent/deployment — DEPRECATED
 * Polled CF Pages deployment status during the legacy wizard staging
 * flow. Retired in the post-migration wizard rewrite — the Worker URL
 * is static so there's nothing to poll. Frontend now HEAD-polls the
 * worker preview URL directly until middleware returns non-404.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "error", message: "Deprecated — Worker preview URL is static; HEAD-poll it directly" },
    { status: 410 },
  );
}
