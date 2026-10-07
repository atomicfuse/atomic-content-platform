import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, GRID_CARD_DEFAULTS } from '@atomic-platform/shared-types';
import { normalizeGridConfig, normalizeGridCard, slugifyTopic } from '../normalize';

describe('normalizeGridConfig', () => {
  it('returns defaults for undefined', () => {
    expect(normalizeGridConfig(undefined)).toEqual(GRID_DEFAULTS);
  });
  it('derives unique slugs and drops label-less topics', () => {
    const out = normalizeGridConfig({ topics: [
      { label: 'Food & Drink', verticals: ['Food & Drink'] },
      { label: 'Food & Drink', verticals: [] },
      { label: '  ', verticals: ['X'] },
      { label: 'Health', slug: 'Wellness Now', verticals: [' Healthy Living ', ''] },
    ] });
    expect(out.topics).toEqual([
      { label: 'Food & Drink', slug: 'food-and-drink', verticals: ['Food & Drink'], bundles: [] },
      { label: 'Food & Drink', slug: 'food-and-drink-2', verticals: [], bundles: [] },
      { label: 'Health', slug: 'wellness-now', verticals: ['Healthy Living'], bundles: [] },
    ]);
  });
  it('clamps numbers and maps feed_ad_every 1 to 2', () => {
    const out = normalizeGridConfig({ per_site_limit: 500, page_size: 2, excerpt_paragraphs: 0, feed_ad_every: 1, max_age_days: -4 });
    expect(out.per_site_limit).toBe(100);
    expect(out.page_size).toBe(6);
    expect(out.excerpt_paragraphs).toBe(1);
    expect(out.feed_ad_every).toBe(2);
    expect(out.max_age_days).toBe(1);
  });
  it('keeps feed_ad_every 0 (no in-feed ads) and null max_age_days', () => {
    const out = normalizeGridConfig({ feed_ad_every: 0, max_age_days: null });
    expect(out.feed_ad_every).toBe(0);
    expect(out.max_age_days).toBeNull();
  });
  it('rejects unknown story_mode and malformed pins', () => {
    const out = normalizeGridConfig({
      story_mode: 'magic' as never,
      pinned: [{ site: 'a', slug: 'b', until: '2026-10-31' }, { site: 'a', slug: 'c', until: 'soon' }, { site: '', slug: 'x' } as never],
    });
    expect(out.story_mode).toBe('excerpt');
    expect(out.pinned).toEqual([{ site: 'a', slug: 'b', until: '2026-10-31' }, { site: 'a', slug: 'c', until: null }]);
  });
  it('is idempotent (safe to run at seed time and again at runtime)', () => {
    const once = normalizeGridConfig({ topics: [{ label: 'Travel', verticals: ['Travel'] }], per_site_limit: 7 });
    expect(normalizeGridConfig(once)).toEqual(once);
  });
});

describe('normalizeGridCard', () => {
  it('fills defaults and rejects unknown values', () => {
    expect(normalizeGridCard(undefined)).toEqual(GRID_CARD_DEFAULTS);
    expect(normalizeGridCard({ style: 'shadow', corners: 'huge' as never })).toEqual({ ...GRID_CARD_DEFAULTS, style: 'shadow' });
  });
});

describe('slugifyTopic', () => {
  it('handles accents, symbols and edges', () => {
    expect(slugifyTopic('  Café & Crème!  ')).toBe('cafe-and-creme');
  });
});

describe('aggregator fields', () => {
  it('defaults the aggregator fields', () => {
    const g = normalizeGridConfig({});
    expect(g.external_story_mode).toBe('what_it_covers');
    expect(g.blocked_categories).toEqual([]);
    expect(g.per_bundle_limit).toBe(20);
  });
  it('normalises topic bundles and clamps per_bundle_limit', () => {
    const g = normalizeGridConfig({
      topics: [{ label: 'Celebs', verticals: [], bundles: [' b1 ', '', 'b1', 'b2'] }],
      per_bundle_limit: 500, external_story_mode: 'ai_summary', blocked_categories: ['War and Conflicts', ' '],
    });
    expect(g.topics[0]!.bundles).toEqual(['b1', 'b2']);
    expect(g.per_bundle_limit).toBe(100);
    expect(g.external_story_mode).toBe('ai_summary');
    expect(g.blocked_categories).toEqual(['War and Conflicts']);
  });
  it('keeps a vertical-less, bundle-only pill', () => {
    expect(normalizeGridConfig({ topics: [{ label: 'X', verticals: [], bundles: ['b'] }] }).topics).toHaveLength(1);
  });
});
