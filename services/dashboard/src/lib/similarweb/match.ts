import type { ParsedRow, SimilarwebStatus } from "./types";

export function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

/**
 * Parsed checklist rows → one status per known site (last row for a site wins). A row matches a site by
 * its real domain (`custom_domain`), else by the dashboard site id. Rows matching nothing are returned in
 * `unknown` (by the text they gave) and never stored.
 */
export function matchSimilarwebRows(
  rows: ParsedRow[],
  sites: Array<{ domain: string; custom_domain?: string | null }>,
  checkedAt: string,
): { statuses: SimilarwebStatus[]; unknown: string[] } {
  const byHost = new Map<string, { domain: string; custom_domain?: string | null }>();
  const byId = new Map<string, { domain: string; custom_domain?: string | null }>();
  for (const s of sites) {
    if (s.custom_domain) byHost.set(normalizeHost(s.custom_domain), s);
    byId.set(s.domain.toLowerCase(), s);
  }
  const statuses = new Map<string, SimilarwebStatus>();
  const unknown: string[] = [];
  for (const r of rows) {
    const site = (r.domain ? byHost.get(normalizeHost(r.domain)) : undefined) ?? (r.site ? byId.get(r.site.toLowerCase()) : undefined);
    if (!site) {
      unknown.push(r.domain || r.site);
      continue;
    }
    statuses.delete(site.domain); // keep insertion order = last occurrence
    statuses.set(site.domain, {
      site: site.domain,
      // The domain that was actually checked (falls back to the site's current domain).
      domain: r.domain ? normalizeHost(r.domain) : site.custom_domain ? normalizeHost(site.custom_domain) : "",
      has_rank: r.hasRank,
      global_rank: r.hasRank ? r.globalRank : null,
      monthly_visits: r.hasRank ? r.monthlyVisits : null,
      checked_at: checkedAt,
      source: "manual",
    });
  }
  return { statuses: [...statuses.values()], unknown };
}
