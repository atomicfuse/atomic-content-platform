import { NextRequest, NextResponse } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { isSafeId } from "@/lib/grid-summary-file";

/** Pin ("Use AI summary") or unpin ("Back to default") an existing summary — the text is kept. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { site?: unknown; slug?: unknown; pinned?: unknown };
  if (!isSafeId(body.site) || !isSafeId(body.slug) || typeof body.pinned !== "boolean") {
    return NextResponse.json({ ok: false, error: "site, slug and pinned (boolean) are required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: body.site, slug: body.slug, pinned: body.pinned }),
      signal: AbortSignal.timeout(60_000),
    });
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: out.message ?? `pin failed (${res.status})` }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
