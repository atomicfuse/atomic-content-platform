import { NextRequest, NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { isSafeId, parseSummaryFileText } from "@/lib/grid-summary-file";

/** Read one Grid AI-summary file from the network repo (main). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const site = req.nextUrl.searchParams.get("site");
  const slug = req.nextUrl.searchParams.get("slug");
  if (!isSafeId(site) || !isSafeId(slug)) {
    return NextResponse.json({ error: "Invalid site or slug" }, { status: 400 });
  }
  let raw: string | null;
  try {
    raw = await readFileContent(`grid-summaries/${site}/${slug}.md`, "main");
  } catch (err) {
    console.error(`[grid-summary] read failed for ${site}/${slug}:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not read summary" }, { status: 502 });
  }
  if (raw === null) return NextResponse.json({ exists: false });
  const parsed = parseSummaryFileText(raw);
  return parsed ? NextResponse.json({ exists: true, ...parsed }) : NextResponse.json({ exists: false });
}

/** Save a hand edit — the pipeline is the only writer of summary files (it hashes the current source). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { site?: unknown; slug?: unknown; markdown?: unknown };
  if (!isSafeId(body.site) || !isSafeId(body.slug) || typeof body.markdown !== "string") {
    return NextResponse.json({ ok: false, error: "site, slug and markdown are required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: body.site, slug: body.slug, markdown: body.markdown, editedBy: "dashboard" }),
      signal: AbortSignal.timeout(60_000),
    });
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: out.message ?? `save failed (${res.status})` }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
