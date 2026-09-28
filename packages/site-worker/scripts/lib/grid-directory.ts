import type { NetworkDirectory, NetworkDirectorySite } from '@atomic-platform/shared-types';

/** Legacy sites whose KV lives in the Dev1 account — never Grid sources. */
export const DEV1_SITE_IDS: ReadonlySet<string> = new Set(['financenewsbase', 'muvizzcom']);

/** The dashboard-index.yaml fields the directory needs. */
export interface IndexSiteEntry {
  domain: string;
  status?: string | null;
  vertical?: string | null;
  custom_domain?: string | null;
  deleted_at?: string | null;
}

/** The resolved site-config fields the directory needs. */
export interface SiteConfigSummary {
  site_name?: string;
  domain?: string;
  theme?: { favicon?: string | null; template?: string };
}

/** dashboard-index + resolved configs → network-directory value. Pure. */
export function buildNetworkDirectory(
  entries: readonly IndexSiteEntry[], configs: ReadonlyMap<string, SiteConfigSummary | null>, now: Date,
): NetworkDirectory {
  const sites: NetworkDirectorySite[] = [];
  for (const e of entries) {
    if (!e?.domain || e.deleted_at || (e.status ?? '').toLowerCase() === 'deleted') continue;
    const cfg = configs.get(e.domain) ?? null;
    const cfgDomain = cfg?.domain && cfg.domain.includes('.') ? cfg.domain : null;
    sites.push({
      siteId: e.domain,
      hostname: (e.custom_domain || cfgDomain || e.domain).toLowerCase(),
      name: cfg?.site_name || e.domain,
      favicon: cfg?.theme?.favicon || null,
      vertical: (e.vertical ?? '').trim(),
      status: e.status ?? '',
      isGrid: cfg?.theme?.template === 'grid',
      account: DEV1_SITE_IDS.has(e.domain) ? 'dev1' : 'assets',
    });
  }
  return { generatedAt: now.toISOString(), sites };
}
