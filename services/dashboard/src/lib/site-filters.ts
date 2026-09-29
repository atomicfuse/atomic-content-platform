import type { DashboardSiteEntry, Company, SiteStatus, Vertical } from "@/types/dashboard";

/** Sentinel filter value meaning "site has none of this dimension" — no
 *  company set, or belongs to no group. Distinct from "" (no filter / all). */
export const NO_COMPANY = "__none__";
export const NO_GROUP = "__none__";

export type CompanyFilterValue = Company | typeof NO_COMPANY;
/** "" = all groups, NO_GROUP = ungrouped sites only, else a group id. */
export type GroupFilterValue = "" | typeof NO_GROUP | string;

export interface SiteListFilters {
  search: string;
  company: CompanyFilterValue;
  vertical: Vertical | "";
  status: SiteStatus | "";
  group: GroupFilterValue;
}

function normalizeCategory(value: string): string {
  return value.trim().toLowerCase();
}

/** Case-insensitive, trimmed category match. An empty filter matches every
 *  site (no filter applied). Kept as its own function so the tolerance rule
 *  is independently testable. */
export function categoryMatches(siteVertical: string, filterVertical: string): boolean {
  if (!filterVertical) return true;
  return normalizeCategory(siteVertical ?? "") === normalizeCategory(filterVertical);
}

/**
 * Single source of truth for the sites-list filter predicates. `SitesTable`
 * calls this from its `useMemo` instead of re-implementing the checks
 * inline, so the logic stays testable in isolation from React.
 */
export function filterSites(
  sites: DashboardSiteEntry[],
  filters: SiteListFilters,
  siteGroups: Record<string, string[]>,
): DashboardSiteEntry[] {
  const search = filters.search.trim().toLowerCase();

  return sites.filter((site) => {
    if (search) {
      const domainMatch = site.domain.toLowerCase().includes(search);
      const customDomainMatch = (site.custom_domain ?? "").toLowerCase().includes(search);
      if (!domainMatch && !customDomainMatch) return false;
    }

    if (filters.company) {
      if (filters.company === NO_COMPANY) {
        if (site.company) return false;
      } else if (site.company !== filters.company) {
        return false;
      }
    }

    if (!categoryMatches(site.vertical, filters.vertical)) return false;

    if (filters.status && site.status !== filters.status) return false;

    if (filters.group) {
      const groups = siteGroups[site.domain] ?? [];
      if (filters.group === NO_GROUP) {
        if (groups.length > 0) return false;
      } else if (!groups.includes(filters.group)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Category values present in `siteVerticals` (raw `site.vertical` values,
 * duplicates allowed) that aren't already covered by `knownNames` (the
 * `/api/verticals` reference list), case-insensitively. Used to widen the
 * Category filter dropdown so every site stays selectable even if its
 * vertical predates or bypassed the reference list.
 */
export function extraCategoryOptions(
  siteVerticals: string[],
  knownNames: string[],
): string[] {
  const known = new Set(knownNames.map(normalizeCategory));
  const seen = new Set<string>();
  const extras: string[] = [];
  for (const raw of siteVerticals) {
    const value = raw?.trim();
    if (!value) continue;
    const key = normalizeCategory(value);
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push(value);
  }
  return extras;
}
