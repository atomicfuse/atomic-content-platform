import type { GridInactivePin, GridPoolItem, ResolvedGridConfig } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../kv-schema';

/** One source site's article index, tagged with the pills it feeds. */
export interface SourceArticles {
  siteId: string;
  pills: string[];
  articles: readonly ArticleIndexEntry[];
}

/** Merged, limited, pinned pool for a Grid site. */
export interface BuiltPool {
  items: GridPoolItem[];
  inactivePins: GridInactivePin[];
}

const DAY_MS = 86_400_000;
const time = (iso: string): number => Date.parse(iso);

function toItem(src: SourceArticles, a: ArticleIndexEntry, pinned: boolean): GridPoolItem {
  return {
    site: src.siteId, slug: a.slug, title: a.title, publishDate: a.publishDate,
    ...(a.featuredImage ? { featuredImage: a.featuredImage } : {}),
    ...(a.description ? { description: a.description } : {}),
    pills: src.pills, pinned,
  };
}

/** Rolling window per source + pins (spec "Feed building"). Pure — no KV. */
export function buildPool(sources: readonly SourceArticles[], grid: ResolvedGridConfig, now: Date): BuiltPool {
  const minTime = grid.max_age_days === null ? -Infinity : now.getTime() - grid.max_age_days * DAY_MS;
  const natural: GridPoolItem[] = [];
  for (const src of sources) {
    src.articles
      .filter((a) => a.status === 'published' && time(a.publishDate) >= minTime) // NaN dates fail both checks
      .sort((x, y) => time(y.publishDate) - time(x.publishDate))
      .slice(0, grid.per_site_limit)
      .forEach((a) => natural.push(toItem(src, a, false)));
  }
  natural.sort((x, y) => time(y.publishDate) - time(x.publishDate) || x.site.localeCompare(y.site) || x.slug.localeCompare(y.slug));

  const bySite = new Map(sources.map((s) => [s.siteId, s]));
  const today = now.toISOString().slice(0, 10);
  const pinnedItems: GridPoolItem[] = [];
  const inactivePins: GridInactivePin[] = [];
  const pinnedKeys = new Set<string>();
  for (const pin of grid.pinned) {
    const key = `${pin.site}:${pin.slug}`;
    if (pinnedKeys.has(key)) continue;
    if (pin.until && pin.until < today) { inactivePins.push({ ...pin, reason: 'expired' }); continue; }
    const src = bySite.get(pin.site);
    if (!src) { inactivePins.push({ ...pin, reason: 'not_source' }); continue; }
    const article = src.articles.find((a) => a.slug === pin.slug && a.status === 'published');
    if (!article) { inactivePins.push({ ...pin, reason: 'not_published' }); continue; }
    pinnedKeys.add(key);
    pinnedItems.push(toItem(src, article, true));
  }
  return { items: [...pinnedItems, ...natural.filter((i) => !pinnedKeys.has(`${i.site}:${i.slug}`))], inactivePins };
}

/** Pill feed; null = "All". */
export function filterByTopic(items: readonly GridPoolItem[], topicSlug: string | null): GridPoolItem[] {
  return topicSlug === null ? [...items] : items.filter((i) => i.pills.includes(topicSlug));
}

/** 1-based page slice. `startIndex` keeps the ad cadence continuous across pages. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): { slice: T[]; startIndex: number; hasMore: boolean } {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const startIndex = (p - 1) * pageSize;
  return { slice: items.slice(startIndex, startIndex + pageSize), startIndex, hasMore: startIndex + pageSize < items.length };
}
