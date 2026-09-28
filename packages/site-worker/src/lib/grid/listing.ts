import type { GridContext } from './context';
import type { GridPoolData } from './load';
import { filterByTopic, pageSlice } from './feed';
import { renderTilesHtml, type AdPlacementLike, type GridPageType } from './render';
import { buildTiles } from './tiles';

/** One rendered page of a Grid feed. */
export interface ListingResult { html: string; hasMore: boolean; nextPage: number; total: number }

/** Shared by the listing pages (page 1, SSR) and /api/feed (page ≥ 2) so markup never diverges. */
export function renderListing(data: GridPoolData, g: GridContext, topic: string | null, page: number, now: Date, pageType: GridPageType): ListingResult {
  const items = filterByTopic(data.pool.items, topic);
  const { slice, startIndex, hasMore } = pageSlice(items, page, g.grid.page_size);
  const heights = g.config.ad_placeholder_heights as unknown as Record<string, number> | undefined;
  const html = renderTilesHtml(buildTiles(slice, startIndex, g.grid.feed_ad_every), {
    now, card: g.card, showIntro: g.grid.show_intro,
    sites: new Map((data.directory?.sites ?? []).map((s) => [s.siteId, s])),
    placements: (g.config.ads_config?.ad_placements ?? []) as AdPlacementLike[],
    pageType, staging: g.staging, reservedHeight: heights?.['grid-feed'] ?? 0,
  });
  return { html, hasMore, nextPage: Math.max(1, Math.floor(page)) + 1, total: items.length };
}
