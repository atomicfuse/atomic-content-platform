"use server";

import { listDomainsWithPagesInfo, getAPOStatus } from "@/lib/cloudflare";
import { readDashboardIndex, readSiteConfig, writeDashboardIndex, addSitesToIndex } from "@/lib/github";
import type { DashboardSiteEntry, SiteStatus } from "@/types/dashboard";
import type { CloudflareDomainInfo } from "@/lib/cloudflare";
import { revalidatePath } from "next/cache";

interface SyncResult {
  totalDomains: number;
  newCount: number;
  domains: string[];
}

/**
 * Detect site status by cross-referencing:
 * 1. Cloudflare Pages deployment status (is it deployed?)
 * 2. Network repo (does site.yaml exist?)
 * 3. Tracking config (does it have GA? → likely monetized)
 */
async function detectSiteStatus(
  cfInfo: CloudflareDomainInfo,
  siteConfig: Record<string, unknown> | null
): Promise<SiteStatus> {
  // No site.yaml and no Pages deployment → brand new domain
  if (!siteConfig && !cfInfo.hasDeployment) return "New";

  // Has a Pages deployment on production
  if (cfInfo.hasDeployment) {
    // Check if it has tracking/monetization → Live
    if (siteConfig) {
      const tracking = siteConfig.tracking as Record<string, unknown> | undefined;
      const hasGA = tracking?.ga4 && tracking.ga4 !== null;
      if (hasGA) return "Ready"; // Ready = deployed but no ads yet
    }
    return "Ready"; // Deployed to production = Ready
  }

  // Has site.yaml but no production deployment → Preview (staging only)
  if (siteConfig) return "Preview";

  return "New";
}

/** Fetch domains from Cloudflare (Zones + Pages) and sync to dashboard index. */
export async function syncDomainsFromCloudflare(): Promise<SyncResult> {
  // Get enriched domain info (zones cross-referenced with Pages projects)
  const cfDomains = await listDomainsWithPagesInfo();
  const index = await readDashboardIndex();
  const existingDomains = new Map(index.sites.map((s) => [s.domain, s]));

  const newDomainInfos = cfDomains.filter((d) => !existingDomains.has(d.domain));
  const now = new Date().toISOString();

  // Re-check status of existing domains (e.g. files deleted, deployment changed)
  let updatedCount = 0;
  for (const site of index.sites) {
    const cfInfo = cfDomains.find((d) => d.domain === site.domain);
    const siteConfig = await readSiteConfig(site.domain);

    let correctStatus: SiteStatus;
    if (site.staging_branch && site.status === "Staging") {
      // Preserve staging status for sites in initial staging (not yet live)
      correctStatus = "Staging";
    } else if (site.staging_branch && (site.status === "Ready" || site.status === "Live")) {
      // Live/Ready sites keep their status even with a staging branch
      correctStatus = site.status;
    } else if (cfInfo) {
      correctStatus = await detectSiteStatus(cfInfo, siteConfig);
    } else if (!siteConfig) {
      // Not in Cloudflare and no site.yaml → New
      correctStatus = "New";
    } else {
      // Has site.yaml but not in Cloudflare → Preview at best
      correctStatus = "Preview";
    }

    // Only downgrade status (e.g. Ready→New if files deleted), never override WordPress
    if (site.status !== "WordPress" && site.status !== correctStatus) {
      site.status = correctStatus;
      site.last_updated = now;
      updatedCount++;
    }
  }

  // For each new domain, detect status and pull config
  const newEntries: DashboardSiteEntry[] = await Promise.all(
    newDomainInfos.map(async (cfInfo) => {
      const siteConfig = await readSiteConfig(cfInfo.domain);
      const status = await detectSiteStatus(cfInfo, siteConfig);

      // Extract GA info from existing site.yaml if available
      const tracking = siteConfig?.tracking as Record<string, unknown> | undefined;
      const gaInfo = (tracking?.ga4 as string) ?? null;

      // Check APO status from Cloudflare
      let cfApo = false;
      try {
        cfApo = await getAPOStatus(cfInfo.zoneId);
      } catch {
        // APO check is best-effort
      }

      return {
        domain: cfInfo.domain,
        company: "ATL" as const,
        vertical: "Other" as const,
        status,
        site_id: generateSiteId(),
        exclusivity: null,
        ob_epid: null,
        ga_info: gaInfo,
        cf_apo: cfApo,
        fixed_ad: false,
        last_updated: now,
        created_at: now,
        pages_project: cfInfo.pagesProject,
        zone_id: cfInfo.zoneId,
        staging_branch: null,
        preview_url: null,
        saved_previews: null,
        custom_domain: null,
      };
    })
  );

  // Write updates: new entries + any status corrections
  if (newEntries.length > 0) {
    index.sites.push(...newEntries);
  }
  if (newEntries.length > 0 || updatedCount > 0) {
    await writeDashboardIndex(
      index,
      `dashboard: sync ${newEntries.length} new, ${updatedCount} updated`
    );
  }

  revalidatePath("/");

  return {
    totalDomains: cfDomains.length,
    newCount: newEntries.length,
    domains: newDomainInfos.map((d) => d.domain),
  };
}

/** Manually add a domain to the dashboard index (for subdomains, test domains, etc.). */
export async function addDomainManually(
  domain: string,
  company: DashboardSiteEntry["company"],
  vertical: DashboardSiteEntry["vertical"]
): Promise<void> {
  const index = await readDashboardIndex();
  const existing = index.sites.find((s) => s.domain === domain);
  if (existing) {
    throw new Error(`Domain ${domain} already exists in the dashboard`);
  }

  const now = new Date().toISOString();
  const entry: DashboardSiteEntry = {
    domain,
    company,
    vertical,
    status: "New",
    site_id: generateSiteId(),
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: now,
    created_at: now,
    pages_project: null,
    zone_id: null,
    staging_branch: null,
    preview_url: null,
    saved_previews: null,
    custom_domain: null,
  };

  await addSitesToIndex([entry]);
  revalidatePath("/");
  revalidatePath("/sites");
}

/** Generate a unique numeric site ID. */
function generateSiteId(): string {
  const timestamp = Date.now().toString().slice(-10);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${timestamp}${random}`;
}
