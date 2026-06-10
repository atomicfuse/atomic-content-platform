import { NextResponse } from "next/server";
import { readDashboardIndex, countArticlesForSites } from "@/lib/github";

export async function GET(): Promise<NextResponse> {
  try {
    const index = await readDashboardIndex();
    const sites = index.sites.filter(
      (s) => s.staging_branch !== null || s.pages_project !== null,
    );
    const counts = await countArticlesForSites(sites);
    return NextResponse.json(counts, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("[sites/article-counts] error:", error);
    return NextResponse.json({ error: "Failed to count articles" }, { status: 500 });
  }
}
