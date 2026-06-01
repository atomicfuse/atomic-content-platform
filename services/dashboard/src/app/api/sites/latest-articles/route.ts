import { NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";

const HISTORY_PATH = "scheduler/history.json";

interface HistorySite {
  domain: string;
  status: string;
  articlesCreated: number;
}

interface HistoryEntry {
  timestamp: string;
  sites: HistorySite[];
}

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await readFileContent(HISTORY_PATH, "main");
    if (raw === null) {
      return NextResponse.json({}, {
        headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" },
      });
    }

    const entries = JSON.parse(raw) as HistoryEntry[];
    const latest: Record<string, string> = {};

    for (const entry of entries) {
      for (const site of entry.sites) {
        if (site.articlesCreated > 0 && !latest[site.domain]) {
          latest[site.domain] = entry.timestamp;
        }
      }
    }

    return NextResponse.json(latest, {
      headers: { "Cache-Control": "private, max-age=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[sites/latest-articles] error:", error);
    return NextResponse.json({}, { status: 200 });
  }
}
