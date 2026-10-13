"use server";

import { revalidatePath } from "next/cache";
import { listZones } from "@/lib/cloudflare";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { readHiddenDomains, setDomainHidden } from "@/lib/hidden-domains";

export interface DomainEntry {
  domain: string;
  zoneId: string;
  zoneStatus: string;
  connectedSite: string | null;
  /** Hidden from the site platform (not offered when attaching a domain). */
  hidden: boolean;
}

const DOMAIN_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Fetch all Cloudflare zones and cross-reference with dashboard index to find connections. */
export async function fetchDomains(): Promise<DomainEntry[]> {
  const [assetsZones, dev1Zones, index, hidden] = await Promise.all([
    listZones(),
    listZones("financenewsbase"),
    readDashboardIndex(),
    readHiddenDomains(),
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
      hidden: hidden.has(zone.name),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Hide or unhide a Cloudflare domain from the site platform. */
export async function setDomainHiddenAction(
  domain: string,
  hidden: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = domain.trim().toLowerCase();
  if (!DOMAIN_NAME.test(name)) return { ok: false, error: `Invalid domain: ${domain}` };
  try {
    await setDomainHidden(name, hidden);
  } catch (err) {
    console.error(`[domains] failed to ${hidden ? "hide" : "unhide"} ${name}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not save" };
  }
  revalidatePath("/settings/domains");
  return { ok: true };
}
