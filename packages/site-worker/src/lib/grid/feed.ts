import type { ExternalIndexEntry, GridHiddenStory, GridInactivePin, GridPoolItem, ResolvedGridConfig } from '@atomic-platform/shared-types';
import { AGGREGATOR_SOURCE_ID, type ArticleIndexEntry } from '../kv-schema';

/** One source site's article index, tagged with the pills it feeds. */
export interface SourceArticles {
  siteId: string;
  pills: string[];
  articles: readonly ArticleIndexEntry[];
}

/** One aggregator bundle's index entries, tagged with the pills it feeds. */
export interface ExternalSourceEntries {
  bundleId: string;
  pills: string[];
  entries: readonly ExternalIndexEntry[];
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

/** Story URL slug for an external entry: "<title-slug>-<itemId>". */
export function externalPoolSlug(e: Pick<ExternalIndexEntry, 'slug' | 'id'>): string {
  return `${e.slug}-${e.id}`;
}

/** True when any of the story's categories is blocked (case-insensitive). Entries without categories are never blocked. */
export function isCategoryBlocked(categories: readonly string[] | undefined, blocked: readonly string[]): boolean {
  if (!categories?.length || blocked.length === 0) return false;
  const set = new Set(blocked.map((b) => b.trim().toLowerCase()));
  return categories.some((c) => set.has(c.trim().toLowerCase()));
}

/** The 24-hex aggregator item id at the end of an external slug, or null. */
function aggregatorItemId(slug: string): string | null {
  return /([0-9a-f]{24})$/.exec(slug)?.[1] ?? null;
}

/** True when the site hid this story. Aggregator stories match by item id, so a later title (slug) change keeps them hidden. */
export function isStoryHidden(site: string, slug: string, hidden: readonly GridHiddenStory[]): boolean {
  if (hidden.length === 0) return false;
  if (site === AGGREGATOR_SOURCE_ID) {
    const id = aggregatorItemId(slug);
    return id !== null && hidden.some((h) => h.site === AGGREGATOR_SOURCE_ID && aggregatorItemId(h.slug) === id);
  }
  return hidden.some((h) => h.site === site && h.slug === slug);
}

/** True when the publisher domain is blocked, or is a subdomain of a blocked one. */
export function isDomainBlocked(domain: string | undefined, blocked: readonly string[]): boolean {
  if (!domain || blocked.length === 0) return false;
  const d = domain.toLowerCase();
  return blocked.some((b) => d === b || d.endsWith(`.${b}`));
}

/** Bundle entries → pool items: blocked categories, max age and per_bundle_limit applied; one item per story id. */
function externalItems(external: readonly ExternalSourceEntries[], grid: ResolvedGridConfig, minTime: number): GridPoolItem[] {
  const byId = new Map<string, GridPoolItem>();
  for (const src of external) {
    src.entries
      .filter((e) => !isCategoryBlocked(e.categories, grid.blocked_categories) && time(e.publishedAt) >= minTime
        && !isDomainBlocked(e.sourceName, grid.blocked_domains) && !isStoryHidden(AGGREGATOR_SOURCE_ID, e.id, grid.hidden_stories))
      .sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
      .slice(0, grid.per_bundle_limit)
      .forEach((e) => {
        const existing = byId.get(e.id);
        if (existing) {
          existing.pills = [...new Set([...existing.pills, ...src.pills])];
          return;
        }
        byId.set(e.id, {
          site: AGGREGATOR_SOURCE_ID, slug: externalPoolSlug(e), title: e.title, publishDate: e.publishedAt,
          featuredImage: e.imageUrl, ...(e.description ? { description: e.description } : {}),
          pills: [...src.pills], pinned: false, kind: 'external', sourceName: e.sourceName,
          ...(e.favicon ? { favicon: e.favicon } : {}),
        });
      });
  }
  return [...byId.values()];
}

/** Rolling window per source + pins (spec "Feed building"). Pure — no KV. */
export function buildPool(
  sources: readonly SourceArticles[], grid: ResolvedGridConfig, now: Date, external: readonly ExternalSourceEntries[] = [],
): BuiltPool {
  const minTime = grid.max_age_days === null ? -Infinity : now.getTime() - grid.max_age_days * DAY_MS;
  const natural: GridPoolItem[] = [];
  for (const src of sources) {
    src.articles
      .filter((a) => a.status === 'published' && time(a.publishDate) >= minTime // NaN dates fail both checks
        && !isStoryHidden(src.siteId, a.slug, grid.hidden_stories))
      .sort((x, y) => time(y.publishDate) - time(x.publishDate))
      .slice(0, grid.per_site_limit)
      .forEach((a) => natural.push(toItem(src, a, false)));
  }
  natural.push(...externalItems(external, grid, minTime));
  natural.sort((x, y) => time(y.publishDate) - time(x.publishDate) || x.site.localeCompare(y.site) || x.slug.localeCompare(y.slug));

  const bySite = new Map(sources.map((s) => [s.siteId, s]));
  const today = now.toISOString().slice(0, 10);
  const pinnedItems: GridPoolItem[] = [];
  const inactivePins: GridInactivePin[] = [];
  const pinnedKeys = new Set<string>();
  for (const pin of grid.pinned) {
    const key = `${pin.site}:${pin.slug}`;
    if (pinnedKeys.has(key)) continue;
    if (isStoryHidden(pin.site, pin.slug, grid.hidden_stories)) continue; // hiding wins over pinning
    if (pin.until && pin.until < today) { inactivePins.push({ ...pin, reason: 'expired' }); continue; }
    if (pin.site === AGGREGATOR_SOURCE_ID) {
      // Like network pins, an external pin may reach beyond per_bundle_limit / max age.
      const pinned = externalItems(external, { ...grid, per_bundle_limit: Number.MAX_SAFE_INTEGER }, -Infinity)
        .find((i) => i.slug === pin.slug);
      if (!pinned) { inactivePins.push({ ...pin, reason: 'not_source' }); continue; }
      pinnedKeys.add(key);
      pinnedItems.push({ ...pinned, pinned: true });
      continue;
    }
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
