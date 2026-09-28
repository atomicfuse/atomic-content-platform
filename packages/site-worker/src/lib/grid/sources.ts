import type {
  GridExclusionReason, GridSourceStatus, NetworkDirectory, NetworkDirectorySite, ResolvedGridConfig,
} from '@atomic-platform/shared-types';

/** Result of resolving which network sites feed a Grid site. */
export interface ResolvedSources {
  sources: NetworkDirectorySite[];
  statuses: GridSourceStatus[];
  pillsBySite: Map<string, string[]>;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

function exclusionReason(
  site: NetworkDirectorySite, selfId: string, pills: string[], include: Set<string>, exclude: Set<string>,
): GridExclusionReason | null {
  const id = norm(site.siteId);
  if (id === selfId) return 'self';
  if (site.isGrid) return 'grid_site';
  if (norm(site.status) !== 'live') return 'not_live';
  if (site.account === 'dev1') return 'dev1_account';
  if (exclude.has(id)) return 'excluded';
  if (pills.length === 0 && !include.has(id)) return 'no_matching_vertical';
  return null;
}

/** Applies the spec's source rules 1–5 to every directory site. */
export function resolveSources(dir: NetworkDirectory, grid: ResolvedGridConfig, selfSiteId: string): ResolvedSources {
  const include = new Set(grid.include_sites.map(norm));
  const exclude = new Set(grid.exclude_sites.map(norm));
  const selfId = norm(selfSiteId);
  const result: ResolvedSources = { sources: [], statuses: [], pillsBySite: new Map() };
  for (const site of dir.sites) {
    const vertical = norm(site.vertical);
    const pills = vertical
      ? grid.topics.filter((t) => t.verticals.some((v) => norm(v) === vertical)).map((t) => t.slug)
      : [];
    const reason = exclusionReason(site, selfId, pills, include, exclude);
    result.statuses.push(reason ? { siteId: site.siteId, included: false, reason, pills } : { siteId: site.siteId, included: true, pills });
    if (!reason) {
      result.sources.push(site);
      result.pillsBySite.set(site.siteId, pills);
    }
  }
  return result;
}
