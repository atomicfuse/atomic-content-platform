import { NextResponse } from "next/server";
import { invalidateSiteCaches } from "@/lib/github";

const SECRET = process.env.CACHE_INVALIDATE_SECRET;

export async function POST(req: Request): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!SECRET || authHeader !== `Bearer ${SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { domain?: string; branch?: string };
  if (!body.domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }

  invalidateSiteCaches(body.domain, body.branch ?? undefined);
  console.log(`[cache/invalidate] Cleared caches for ${body.domain}${body.branch ? ` (${body.branch})` : ""}`);

  return NextResponse.json({ ok: true });
}
