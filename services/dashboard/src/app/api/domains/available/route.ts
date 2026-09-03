import { NextResponse } from "next/server";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { listDomainsWithPagesInfo } from "@/lib/cloudflare";

export async function GET(): Promise<NextResponse> {
  try {
    const [index, assetsDomains, dev1Domains] = await Promise.all([
      readDashboardIndex(),
      listDomainsWithPagesInfo(),
      listDomainsWithPagesInfo("financenewsbase"),
    ]);

    const seen = new Set<string>();
    const cfDomains = [...assetsDomains, ...dev1Domains].filter((d) => {
      if (seen.has(d.domain)) return false;
      seen.add(d.domain);
      return true;
    });

    const existingDomains = new Set(index.sites.map((s) => s.domain));
    const existingCustomDomains = new Set(
      index.sites.map((s) => s.custom_domain).filter(Boolean),
    );

    const available = cfDomains
      .map((d) => d.domain)
      .filter((d) => !existingDomains.has(d) && !existingCustomDomains.has(d))
      .sort();

    return NextResponse.json({ domains: available });
  } catch {
    return NextResponse.json({ domains: [] }, { status: 500 });
  }
}
