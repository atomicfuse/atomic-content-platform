import { describe, expect, it } from 'vitest';
import {
  deepMerge,
  mergeScriptLayers,
  mergeAdPlacementLayers,
} from '../lib/resolve';

/**
 * End-to-end config resolution tests for the mock-ads group.
 *
 * These tests simulate the seed-kv merge pipeline:
 *   org.yaml → groups/mock-ads.yaml → site.yaml
 *
 * They verify that every ad position rendered by site-worker templates
 * is present in the resolved config when a site uses the mock-ads group.
 */

// Minimal org.yaml representation (matches real org.yaml structure)
const ORG_LAYER: Record<string, unknown> = {
  tracking: { ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [] },
  scripts: { head: [], body_start: [], body_end: [] },
  ads_config: {
    interstitial: false,
    layout: 'standard',
    ad_placements: [
      { id: 'homepage-sidebar', position: 'sidebar' },
      { id: 'article-sidebar', position: 'sidebar' },
    ],
  },
  ad_placeholder_heights: {
    'above-content': 90,
    'after-paragraph': 280,
    sidebar: 600,
    'sticky-bottom': 50,
  },
};

// Full mock-ads group representation (matches updated groups/mock-ads.yaml)
const MOCK_ADS_LAYER: Record<string, unknown> = {
  scripts: {
    head: [],
    body_start: [],
    body_end: [{ id: 'mock-ad-fill', src: '/mock-ad-fill.js' }],
  },
  ads_config: {
    interstitial: true,
    interstitial_config: {
      script_url: 'https://example.com/mock-interstitial.js',
      script_inline: '',
      trigger: { type: 'delay', delay_seconds: 5, scroll_percent: 50 },
      frequency: { type: 'once_per_session', max_per_session: 1 },
      page_types: ['all'],
      close_delay_seconds: 3,
    },
    layout: 'standard',
    ad_placements: [
      { id: 'top-banner', position: 'above-content' },
      { id: 'in-content-1', position: 'after-paragraph-2' },
      { id: 'in-content-2', position: 'after-paragraph-4' },
      { id: 'in-content-3', position: 'after-paragraph-6' },
      { id: 'sidebar-sticky', position: 'sidebar' },
      { id: 'homepage-top-banner', position: 'homepage-top' },
      { id: 'category-top-banner', position: 'category-top' },
      { id: 'taboola-below', position: 'below-content' },
      { id: 'sticky-bottom-bar', position: 'sticky-bottom' },
    ],
  },
};

// Minimal site layer (no ads_config — inherits everything from group)
const SITE_LAYER: Record<string, unknown> = {
  domain: 'testsite',
  groups: ['mock-ads'],
  active: true,
};

const ALL_LAYERS = [ORG_LAYER, MOCK_ADS_LAYER, SITE_LAYER];

describe('mock-ads group: end-to-end config resolution', () => {
  // Simulate the seed-kv merge pipeline
  const merged = ALL_LAYERS.reduce(
    (acc, layer) => deepMerge(acc, layer) as Record<string, unknown>,
    {} as Record<string, unknown>,
  );
  const mergedAds = merged.ads_config as {
    interstitial: boolean;
    interstitial_config: Record<string, unknown>;
    ad_placements: Array<{ id: string; position: string }>;
  };

  describe('placement coverage — every template position is present', () => {
    const TEMPLATE_POSITIONS = [
      'above-content',
      'below-content',
      'sidebar',
      'sticky-bottom',
      'homepage-top',
      'category-top',
    ] as const;

    for (const pos of TEMPLATE_POSITIONS) {
      it(`has at least one placement with position="${pos}"`, () => {
        const match = mergedAds.ad_placements.filter((p) => p.position === pos);
        expect(match.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe('inline ad (after-paragraph-N) placements', () => {
    it('has three after-paragraph-N placements at paragraphs 2, 4, 6', () => {
      const inline = mergedAds.ad_placements.filter((p) =>
        /^after-paragraph-\d+$/.test(p.position),
      );
      expect(inline).toHaveLength(3);
      const ns = inline.map((p) => Number(p.position.split('-').pop()));
      expect(ns).toEqual(expect.arrayContaining([2, 4, 6]));
    });
  });

  describe('interstitial is enabled with mock config', () => {
    it('interstitial flag is true', () => {
      expect(mergedAds.interstitial).toBe(true);
    });

    it('interstitial_config has a demo script_url', () => {
      const ic = mergedAds.interstitial_config;
      expect(ic.script_url).toContain('example.com');
    });

    it('interstitial trigger is delay-based', () => {
      const ic = mergedAds.interstitial_config;
      const trigger = ic.trigger as { type: string; delay_seconds: number };
      expect(trigger.type).toBe('delay');
      expect(trigger.delay_seconds).toBe(5);
    });

    it('interstitial frequency is once_per_session', () => {
      const ic = mergedAds.interstitial_config;
      const freq = ic.frequency as { type: string };
      expect(freq.type).toBe('once_per_session');
    });

    it('interstitial applies to all page types', () => {
      const ic = mergedAds.interstitial_config;
      expect(ic.page_types).toEqual(['all']);
    });
  });

  describe('mock-ad-fill script is injected via body_end', () => {
    it('mergeScriptLayers includes mock-ad-fill in body_end', () => {
      const scripts = mergeScriptLayers(ALL_LAYERS);
      const mockFill = scripts.body_end.find((s) => s.id === 'mock-ad-fill');
      expect(mockFill).toBeDefined();
      expect(mockFill!.src).toBe('/mock-ad-fill.js');
    });
  });

  describe('group placements replace org placements (deepMerge array semantics)', () => {
    it('merged ad_placements is the group array (not concatenated with org)', () => {
      // deepMerge replaces arrays, so org's 2 sidebar placements are gone
      // and only mock-ads group's 9 placements remain.
      expect(mergedAds.ad_placements).toHaveLength(9);
      expect(mergedAds.ad_placements.find((p) => p.id === 'homepage-sidebar')).toBeUndefined();
    });
  });

  describe('mergeAdPlacementLayers with mock-ads group', () => {
    it('add mode: site can add extra placements on top of group', () => {
      const siteWithExtra = {
        ...SITE_LAYER,
        ads_config: {
          ad_placements: [{ id: 'site-custom', position: 'above-content' }],
        },
      };
      const result = mergeAdPlacementLayers([ORG_LAYER, MOCK_ADS_LAYER, siteWithExtra]);
      // Group replaces org (non-site layers); site appends in 'add' mode.
      const groupPlacements = (MOCK_ADS_LAYER.ads_config as { ad_placements: unknown[] }).ad_placements;
      expect(result).toHaveLength(groupPlacements.length + 1);
      expect(result[result.length - 1]).toMatchObject({ id: 'site-custom' });
    });
  });

  describe('total placement count', () => {
    it('mock-ads group defines exactly 9 placements', () => {
      const placements = (MOCK_ADS_LAYER.ads_config as { ad_placements: unknown[] }).ad_placements;
      expect(placements).toHaveLength(9);
    });
  });
});
