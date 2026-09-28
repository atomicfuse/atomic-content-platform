import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../../kv-schema';
import { buildPool, filterByTopic, pageSlice } from '../feed';

const NOW = new Date('2026-09-27T12:00:00Z');
const art = (slug: string, date: string, status: ArticleIndexEntry['status'] = 'published'): ArticleIndexEntry => ({
  slug, title: slug.toUpperCase(), author: 'E', publishDate: date, tags: [], type: 'standard', status,
});
const g = (over: Partial<ResolvedGridConfig> = {}): ResolvedGridConfig => ({ ...GRID_DEFAULTS, ...over });
const srcA = { siteId: 'a', pills: ['travel'], articles: [art('a1', '2026-09-26T00:00:00Z'), art('a2', '2026-09-20T00:00:00Z'), art('a3', '2026-09-10T00:00:00Z'), art('ar', '2026-09-27T00:00:00Z', 'review')] };
const srcB = { siteId: 'b', pills: ['health'], articles: [art('b1', '2026-09-25T00:00:00Z'), art('bad', 'not-a-date')] };

describe('buildPool', () => {
  it('published only, newest first across sources, per_site_limit per source', () => {
    const { items } = buildPool([srcA, srcB], g({ per_site_limit: 2 }), NOW);
    expect(items.map((i) => i.slug)).toEqual(['a1', 'b1', 'a2']);
  });
  it('drops unparseable dates and applies max_age_days', () => {
    const { items } = buildPool([srcA, srcB], g({ max_age_days: 10 }), NOW);
    expect(items.map((i) => i.slug)).toEqual(['a1', 'b1', 'a2']);
  });
  it('pins go first in config order, deduped from natural, even beyond limits', () => {
    const { items } = buildPool([srcA, srcB], g({ per_site_limit: 1, pinned: [
      { site: 'a', slug: 'a3', until: null }, { site: 'b', slug: 'b1' }, { site: 'a', slug: 'a3' },
    ] }), NOW);
    expect(items.map((i) => `${i.slug}:${i.pinned}`)).toEqual(['a3:true', 'b1:true', 'a1:false']);
  });
  it('reports inactive pins with reasons', () => {
    const { inactivePins, items } = buildPool([srcA], g({ pinned: [
      { site: 'a', slug: 'a1', until: '2026-09-26' },
      { site: 'a', slug: 'a1', until: '2026-09-27' },
      { site: 'zz', slug: 'x' },
      { site: 'a', slug: 'ar' },
    ] }), NOW);
    expect(inactivePins.map((p) => p.reason)).toEqual(['expired', 'not_source', 'not_published']);
    expect(items[0]).toMatchObject({ slug: 'a1', pinned: true });
  });
  it('carries source pills onto items', () => {
    expect(buildPool([srcB], g(), NOW).items[0]?.pills).toEqual(['health']);
  });
});

describe('filterByTopic / pageSlice', () => {
  it('filters by pill; null = All', () => {
    const { items } = buildPool([srcA, srcB], g(), NOW);
    expect(filterByTopic(items, 'health').map((i) => i.slug)).toEqual(['b1']);
    expect(filterByTopic(items, null)).toHaveLength(items.length);
  });
  it('paginates with hasMore and startIndex; page < 1 behaves as 1', () => {
    const list = [1, 2, 3, 4, 5];
    expect(pageSlice(list, 1, 2)).toEqual({ slice: [1, 2], startIndex: 0, hasMore: true });
    expect(pageSlice(list, 3, 2)).toEqual({ slice: [5], startIndex: 4, hasMore: false });
    expect(pageSlice(list, 0, 2).startIndex).toBe(0);
    expect(pageSlice(list, 9, 2)).toEqual({ slice: [], startIndex: 16, hasMore: false });
  });
});
