// services/dashboard/src/app/api/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendSubscriber } from "@/lib/google-sheets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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

    const result = await appendSubscriber(email, domain, source);

    return NextResponse.json(
      { status: "ok" },
      { status: result.created ? 201 : 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save subscription";
    console.error("[subscribe] error:", message);
    return NextResponse.json(
      { status: "error", message: "Failed to save subscription" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
