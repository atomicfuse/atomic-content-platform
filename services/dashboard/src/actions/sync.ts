"use server";

import { listDomainsWithPagesInfo } from "@/lib/cloudflare";
import {
  getDashboardIndex as readDashboardIndex,
  updateDashboardIndexEntry,
  deleteDashboardIndexEntry,
} from "@/lib/db/dashboard-index";
import { getSiteConfig as readSiteConfig } from "@/lib/db/site-configs";
import { writeDashboardIndex } from "@/lib/github";
import { computeCorrectStatus } from "@/lib/site-status";
import { revalidatePath } from "next/cache";

interface SyncResult {
  totalDomains: number;
  newCount: number;
  domains: string[];
}

/** Fetch domains from Cloudflare (Zones + Pages) and sync to dashboard index. */
export async function syncDomainsFromCloudflare(): Promise<SyncResult> {
  // Get enriched domain info (zones cross-referenced with Pages projects)
  // Query both accounts for zones and merge
  const [assetsDomains, dev1Domains] = await Promise.all([
    listDomainsWithPagesInfo(),
    listDomainsWithPagesInfo("financenewsbase"),
  ]);
  const seen = new Set<string>();
  const cfDomains = [...assetsDomains, ...dev1Domains].filter((d) => {
    if (seen.has(d.domain)) return false;
    seen.add(d.domain);
    return true;
  });
  const index = await readDashboardIndex();
  const now = new Date().toISOString();

  // Re-check status of existing domains (e.g. files deleted, deployment changed)
  let updatedCount = 0;
  const removedDomains: string[] = [];
  const changedSites: Array<{ domain: string; status: string }> = [];
  for (const site of index.sites) {
    const cfInfo = cfDomains.find((d) => d.domain === site.domain);
    const siteConfig = await readSiteConfig(site.domain);

    const correctStatus = computeCorrectStatus(site, Boolean(cfInfo), Boolean(siteConfig));
    if (correctStatus === null) {
      // No CF zone, no config — orphaned entry, remove it
      removedDomains.push(site.domain);
      continue;
    }

    if (site.status !== correctStatus) {
      site.status = correctStatus;
      site.last_updated = now;
      changedSites.push({ domain: site.domain, status: correctStatus });
      updatedCount++;
    }
  }

  // Remove orphaned entries
  if (removedDomains.length > 0) {
    index.sites = index.sites.filter((s) => !removedDomains.includes(s.domain));
  }

  if (updatedCount > 0 || removedDomains.length > 0) {
    await writeDashboardIndex(
      index,
      `dashboard: sync ${updatedCount} updated, ${removedDomains.length} removed`
    );

    // Dual-write: mirror to MongoDB (soft-fail) — the dashboard reads the
    // index from Mongo under USE_MONGO_READS, so a git-only write leaves the
    // UI stale indefinitely.
    for (const changed of changedSites) {
      await updateDashboardIndexEntry(changed.domain, {
        status: changed.status,
        last_updated: now,
      });
    }
    for (const domain of removedDomains) {
      await deleteDashboardIndexEntry(domain);
    }
  }

  revalidatePath("/");

  return {
    totalDomains: cfDomains.length,
    newCount: 0,
    domains: [],
  };
}
