import { NextResponse } from "next/server";
import { readSimilarwebStatuses } from "@/lib/similarweb/store";
import type { SimilarwebStatus } from "@/lib/similarweb/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<{ statuses: Record<string, SimilarwebStatus> } | { error: string }>> {
  try {
    return NextResponse.json({ statuses: await readSimilarwebStatuses() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
