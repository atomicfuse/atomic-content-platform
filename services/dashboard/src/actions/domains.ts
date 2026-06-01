"use server";

import { listZones } from "@/lib/cloudflare";
import { readDashboardIndex } from "@/lib/github";

export interface DomainEntry {
  domain: string;
  zoneId: string;
  zoneStatus: string;
  connectedSite: string | null;
}

/** Fetch all Cloudflare zones and cross-reference with dashboard index to find connections. */
export async function fetchDomains(): Promise<DomainEntry[]> {
  const [assetsZones, dev1Zones, index] = await Promise.all([
    listZones(),
    listZones("financenewsbase"),
    readDashboardIndex(),
  ]);
  const seen = new Set<string>();
  const zones = [...assetsZones, ...dev1Zones].filter((z) => {
    if (seen.has(z.name)) return false;
    seen.add(z.name);
    return true;
  });

  // Build a map of custom_domain → site domain for quick lookup
  const customDomainToSite = new Map<string, string>();
  for (const site of index.sites) {
    if (site.custom_domain) {
      customDomainToSite.set(site.custom_domain, site.domain);
    }
  }

  return zones
    .map((zone) => ({
      domain: zone.name,
      zoneId: zone.id,
      zoneStatus: zone.status,
      connectedSite: customDomainToSite.get(zone.name) ?? null,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
