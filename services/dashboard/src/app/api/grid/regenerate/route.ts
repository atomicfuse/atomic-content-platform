import { NextRequest, NextResponse } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { isSafeId } from "@/lib/grid-summary-file";

/** Regenerate one AI summary now (overwrites hand edits — the UI confirms first). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { site?: unknown; slug?: unknown; pin?: unknown };
  if (!isSafeId(body.site) || !isSafeId(body.slug)) {
    return NextResponse.json({ ok: false, error: "site and slug are required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // pin: true = "Use AI summary" (generate + show regardless of the site's story mode).
      body: JSON.stringify({ site: body.site, slug: body.slug, pin: body.pin === true }),
      signal: AbortSignal.timeout(120_000),
    });
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: out.message ?? `regenerate failed (${res.status})` }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
