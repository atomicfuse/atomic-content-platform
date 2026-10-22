import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { hasMockAdsCookie, mockAds, mockAdsParam, MOCK_ADS_CLEAR_COOKIE_HEADER, MOCK_ADS_COOKIE_HEADER } from '../mock-ads';

const params = (url: string): URLSearchParams => new URL(url, 'https://example.com').searchParams;

describe('mockAdsParam', () => {
  it.each(['/?mockads', '/story/a/b?mockads=1', '/?x=2&MockAds', '/?mockads=yes'])('turns mocks on for %s', (url) => {
    expect(mockAdsParam(params(url))).toBe('on');
  });
  it.each(['/?mockads=off', '/?mockads=0', '/?MOCKADS=False'])('turns mocks off for %s', (url) => {
    expect(mockAdsParam(params(url))).toBe('off');
  });
  it.each(['/', '/mockads', '/?topic=mockads', '/?mockadsx'])('ignores %s', (url) => {
    expect(mockAdsParam(params(url))).toBeNull();
  });
});

describe('hasMockAdsCookie', () => {
  it('reads the session cookie; a malformed one is not a session', () => {
    expect(hasMockAdsCookie('a=1; atl_mockads=1')).toBe(true);
    expect(hasMockAdsCookie('atl_noads=1')).toBe(false);
    expect(hasMockAdsCookie(null)).toBe(false);
    expect(hasMockAdsCookie('atl_mockads=%E0%A4%A')).toBe(false);
  });
  it('sets a session cookie and clears it with Max-Age=0', () => {
    expect(MOCK_ADS_COOKIE_HEADER).not.toMatch(/Max-Age|Expires/);
    expect(MOCK_ADS_CLEAR_COOKIE_HEADER).toContain('Max-Age=0');
  });
});

describe('mockAds', () => {
  const config = {
    tracking: { ga4: 'G-1' },
    ads_config: {
      interstitial: true,
      ad_placements: [
        { id: 'feed-card', position: 'grid-feed', device: 'all', code: '<div id="feed-card"></div><script>_sf_loadWidget("feed-card")</script>' },
        { id: 'rail-left', position: 'left-rail', device: 'desktop', code: '<script>x()</script>' },
      ],
    },
    scripts: { head: [{ id: 'header', src: 'https://ads.example/widget.js' }], body_start: [], body_end: [], before_footer: [] },
  } as unknown as ResolvedConfig;

  it('keeps every placement without its code, drops ad scripts and the interstitial, adds the mock script', () => {
    const out = mockAds(config);
    expect(out.ads_config.ad_placements.map((p) => p.id)).toEqual(['feed-card', 'rail-left']);
    expect(out.ads_config.ad_placements.every((p) => !('code' in p))).toBe(true);
    expect(out.ads_config.interstitial).toBe(false);
    expect(out.scripts.head).toEqual([]);
    expect(out.scripts.body_end).toEqual([{ id: 'mock-ad-fill', src: '/mock-ad-fill.js' }]);
    expect(out.tracking).toEqual({ ga4: 'G-1' });
  });
  it('does not touch the original config', () => {
    mockAds(config);
    expect(config.ads_config.ad_placements[0]).toHaveProperty('code');
  });
});
