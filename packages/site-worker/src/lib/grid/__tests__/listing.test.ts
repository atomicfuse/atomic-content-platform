import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, GRID_DEFAULTS, type GridPoolItem } from '@atomic-platform/shared-types';
import type { GridContext } from '../context';
import type { GridPoolData } from '../load';
import { renderListing } from '../listing';

const items: GridPoolItem[] = Array.from({ length: 5 }, (_, i) => ({
  site: 'a', slug: `s${i}`, title: `T${i}`, publishDate: '2026-09-26T00:00:00Z', pills: i % 2 ? ['travel'] : [], pinned: false,
}));
const data: GridPoolData = {
  directory: { generatedAt: 'g', sites: [] },
  resolved: { sources: [], statuses: [], pillsBySite: new Map() },
  pool: { items, inactivePins: [] }, missingIndexes: [],
};
const g = {
  config: { ads_config: { ad_placements: [{ id: 'gf', position: 'grid-feed' }] }, ad_placeholder_heights: { 'grid-feed': 250 } },
  grid: { ...GRID_DEFAULTS, page_size: 2, feed_ad_every: 3 }, card: GRID_CARD_DEFAULTS, siteId: 'me', staging: false, canonicalHost: 'me.com',
} as unknown as GridContext;

describe('renderListing', () => {
  it('page 1: two stories + ad; hasMore', () => {
    const r = renderListing(data, g, null, 1, new Date('2026-09-27T00:00:00Z'), 'homepage');
    expect(r.html.match(/g-card"/g)).toHaveLength(2);
    expect(r.html).toContain('data-ad-id="gf-1"');
    expect(r).toMatchObject({ hasMore: true, nextPage: 2, total: 5 });
  });
  it('topic filter + last page', () => {
    const r = renderListing(data, g, 'travel', 1, new Date('2026-09-27T00:00:00Z'), 'category');
    expect(r.total).toBe(2);
    expect(r.hasMore).toBe(false);
  });
});
