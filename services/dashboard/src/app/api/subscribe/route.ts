// services/dashboard/src/app/api/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendSubscriber } from "@/lib/google-sheets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Health check — verifies env vars are configured. */
export function GET(): NextResponse {
  const hasSheetId = !!process.env.GOOGLE_SHEET_ID;
  const hasServiceKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const ok = hasSheetId && hasServiceKey;

  return NextResponse.json(
    {
      status: ok ? "ok" : "misconfigured",
      google_sheet_id: hasSheetId ? "set" : "missing",
      google_service_account_key: hasServiceKey ? "set" : "missing",
    },
    { status: ok ? 200 : 503, headers: CORS_HEADERS },
  );
}

/** Collect a newsletter subscription. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string; domain?: string; source?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const email = body.email?.trim();
    const domain = body.domain?.trim();
    const source = body.source?.trim() || "unknown";

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { status: "error", message: "Valid email is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!domain) {
      return NextResponse.json(
        { status: "error", message: "domain is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    console.log(`[subscribe] attempt: domain=${domain} email=${email} source=${source}`);
    const result = await appendSubscriber(email, domain, source);
    console.log(`[subscribe] success: domain=${domain} created=${result.created}`);

    return NextResponse.json(
      { status: "ok" },
      { status: result.created ? 201 : 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save subscription";
    console.error("[subscribe] error:", message, error);
    return NextResponse.json(
      { status: "error", message: "Failed to save subscription" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
