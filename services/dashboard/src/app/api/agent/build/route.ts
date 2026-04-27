import { NextResponse } from "next/server";

/**
 * POST /api/agent/build — DEPRECATED
 * Legacy Cloudflare Pages build trigger. Retired in Phase 8 migration.
 * Use POST /api/sites/rebuild instead (triggers sync-kv workflow).
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { status: "error", message: "Deprecated — use /api/sites/rebuild" },
    { status: 410 },
  );
}
