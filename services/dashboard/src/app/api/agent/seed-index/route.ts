// Direct MongoDB write for dashboard_index entries.
// Accepts { entries: Array<Record<string, unknown>> } — each must have `domain`.
// Bypasses GitHub entirely (no rate-limit dependency).
import { NextResponse, type NextRequest } from "next/server";
import { upsertDashboardIndexEntry } from "@/lib/db/dashboard-index";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const entries = body?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing or empty entries array" },
        { status: 400 },
      );
    }

    const results: Array<{ domain: string; ok: boolean; error?: string }> = [];

    for (const entry of entries) {
      const domain = entry?.domain;
      if (typeof domain !== "string" || !domain) {
        results.push({ domain: "(missing)", ok: false, error: "No domain field" });
        continue;
      }
      try {
        await upsertDashboardIndexEntry(domain, entry);
        results.push({ domain, ok: true });
      } catch (err) {
        results.push({
          domain,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: true, succeeded, total: entries.length, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
