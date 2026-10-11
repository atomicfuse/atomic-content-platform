import { NextResponse, type NextRequest } from "next/server";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { upsertSimilarwebStatuses } from "@/lib/similarweb/store";
import { parseSimilarwebCsv } from "@/lib/similarweb/parse";
import { matchSimilarwebRows } from "@/lib/similarweb/match";

interface ImportResponse {
  updated: number;
  ignored: number;
  rejected: Array<{ line: number; reason: string }>;
  unknown: string[];
}

/** Checklist results → latest Similarweb status per matched site. One bulk write (well under the gateway limit). */
export async function POST(request: NextRequest): Promise<NextResponse<ImportResponse | { error: string }>> {
  let csv = "";
  try {
    const body = (await request.json()) as { csv?: unknown };
    csv = typeof body.csv === "string" ? body.csv : "";
  } catch { /* empty body → handled below */ }

  const parsed = parseSimilarwebCsv(csv);
  if (parsed.missingColumns.length > 0) {
    return NextResponse.json({ error: `This doesn't look like the checklist results — missing column: ${parsed.missingColumns.join(", ")}` }, { status: 400 });
  }
  try {
    const index = await getDashboardIndex();
    const { statuses, unknown } = matchSimilarwebRows(parsed.rows, index.sites, new Date().toISOString());
    if (statuses.length === 0) {
      const error = parsed.rows.length === 0 && parsed.rejected.length > 0
        ? `Every row was rejected (${parsed.rejected.length}) — check the preview for the reasons; nothing was imported`
        : "No rows matched a site — nothing was imported";
      return NextResponse.json({ error }, { status: 400 });
    }
    await upsertSimilarwebStatuses(statuses);
    return NextResponse.json({ updated: statuses.length, ignored: parsed.ignored, rejected: parsed.rejected, unknown });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
