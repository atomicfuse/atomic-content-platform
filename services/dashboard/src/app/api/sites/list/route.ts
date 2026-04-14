import { NextResponse } from "next/server";
import { readDashboardIndex } from "@/lib/github";

export async function GET(): Promise<NextResponse> {
  try {
    const index = await readDashboardIndex();
    const sites = index.sites.map((s) => ({
      domain: s.domain,
      status: s.status,
      vertical: s.vertical,
      company: s.company,
      custom_domain: s.custom_domain,
    }));
    return NextResponse.json(sites, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("[sites/list] error:", error);
    return NextResponse.json({ error: "Failed to list sites" }, { status: 500 });
  }
}
