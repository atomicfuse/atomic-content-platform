import { NextResponse } from "next/server";
import { readDashboardIndex } from "@/lib/github";

export async function GET(): Promise<NextResponse> {
  try {
    const index = await readDashboardIndex();
    const newDomains = index.sites
      .filter((s) => s.status === "New")
      .map((s) => s.domain)
      .sort();
    return NextResponse.json({ domains: newDomains });
  } catch {
    return NextResponse.json({ domains: [] }, { status: 500 });
  }
}
