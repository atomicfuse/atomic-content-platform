import { NextRequest, NextResponse } from "next/server";
import { getDashboardEntry } from "@/lib/db/dashboard-index";
import { gridPoolUrl } from "@/lib/grid-urls";

/** Proxies the Grid site's own /api/pool so the Stories tab shows exactly what the site serves. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain || !/^[a-z0-9][a-z0-9-]*$/i.test(domain)) {
    return NextResponse.json({ error: "Missing or invalid domain" }, { status: 400 });
  }
  const entry = await getDashboardEntry(domain);
  if (!entry) return NextResponse.json({ error: `Unknown site ${domain}` }, { status: 404 });
  try {
    const url = gridPoolUrl(entry as { domain: string; status?: string; custom_domain?: string | null; preview_url?: string | null }, process.env.GRID_WORKER_BASE_URL);
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return NextResponse.json({ error: `Grid site returned ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[api/grid/pool]", err);
    return NextResponse.json({ error: "Could not reach the Grid site" }, { status: 502 });
  }
}
