import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { hasNoAdsParam, hasNoAdsCookie, stripAds, NO_ADS_COOKIE_HEADER } from '../no-ads';

function params(url: string): URLSearchParams {
  return new URL(url, 'https://example.com').searchParams;
}

describe('hasNoAdsParam', () => {
  it.each([
    '/?trending',
    '/some-article?trending',
    '/?utm_source=fb&trending&x=2',
    '/?trending=1',
    '/?trending=anything',
    '/?trending=',
    '/?Trending',
    '/?TRENDING',
  ])('turns ads off for %s', (url) => {
    expect(hasNoAdsParam(params(url))).toBe(true);
  });

  it.each([
    '/',
    '/trending',
    '/trending-movies-2026',
    '/?topic=trending',
    '/?trendingnow',
    '/?not_trending',
    '/#trending',
  ])('keeps ads for %s', (url) => {
    expect(hasNoAdsParam(params(url))).toBe(false);
  });

  it('ignores a hostname containing "trending"', () => {
    expect(hasNoAdsParam(new URL('https://trending-news.com/').searchParams)).toBe(false);
  });
});

describe('hasNoAdsCookie', () => {
  it('is false without a Cookie header', () => {
    expect(hasNoAdsCookie(null)).toBe(false);
  });

  it('is false with unrelated cookies', () => {
    expect(hasNoAdsCookie('foo=bar; _ga=GA1.1.123')).toBe(false);
  });

  it('is true when atl_noads=1 is the only cookie', () => {
    expect(hasNoAdsCookie('atl_noads=1')).toBe(true);
  });

  it('is true when atl_noads=1 is among other cookies', () => {
    expect(hasNoAdsCookie('foo=bar; atl_noads=1; _ga=GA1.1.123')).toBe(true);
  });

  it('is false for any other value', () => {
    expect(hasNoAdsCookie('atl_noads=0')).toBe(false);
    expect(hasNoAdsCookie('atl_noads=')).toBe(false);
  });

  it('is false (does not throw) on a malformed value', () => {
    expect(hasNoAdsCookie('atl_noads=%E0%A4%A')).toBe(false);
  });
});

describe('NO_ADS_COOKIE_HEADER', () => {
  it('is a host-wide, HttpOnly, Secure, Lax session cookie', () => {
    expect(NO_ADS_COOKIE_HEADER).toMatch(/^atl_noads=1;/);
    expect(NO_ADS_COOKIE_HEADER).toContain('Path=/');
    expect(NO_ADS_COOKIE_HEADER).toContain('HttpOnly');
    expect(NO_ADS_COOKIE_HEADER).toContain('Secure');
    expect(NO_ADS_COOKIE_HEADER).toContain('SameSite=Lax');
    expect(NO_ADS_COOKIE_HEADER).not.toMatch(/Max-Age|Expires/i);
  });
});

describe('stripAds', () => {
  const script = { id: 'header', src: 'https://client.us-east.adsnx.com/js/widget.js' };

  function makeConfig(): ResolvedConfig {
    return {
      domain: 'example.com',
      tracking: { ga4: 'G-TEST', gtm: null, google_ads: 'AW-1', facebook_pixel: '123', custom: [] },
      scripts: { head: [script], body_start: [script], body_end: [script], before_footer: [script] },
      ads_config: {
        interstitial: true,
        interstitial_config: { script_url: 'https://client.w.digikube.com/atl.widget.js' },
        layout: 'standard',
        ad_placements: [{ id: 'block1', position: 'above-content' }],
      },
    } as unknown as ResolvedConfig;
  }

  it('removes placements, interstitial and every script position', () => {
    const out = stripAds(makeConfig());
    expect(out.ads_config.ad_placements).toEqual([]);
    expect(out.ads_config.interstitial).toBe(false);
    expect(out.scripts).toEqual({ head: [], body_start: [], body_end: [], before_footer: [] });
  });

  it('keeps tracking and unrelated fields', () => {
    const input = makeConfig();
    const out = stripAds(input);
    expect(out.tracking).toEqual(input.tracking);
    expect(out.domain).toBe('example.com');
    expect(out.ads_config.layout).toBe('standard');
  });

  it('does not mutate the input', () => {
    const input = makeConfig();
    const before = JSON.parse(JSON.stringify(input)) as unknown;
    stripAds(input);
    expect(input).toEqual(before);
  });

  it('handles a config without ads_config or scripts', () => {
    const out = stripAds({ domain: 'example.com' } as unknown as ResolvedConfig);
    expect(out.ads_config.ad_placements).toEqual([]);
    expect(out.ads_config.interstitial).toBe(false);
    expect(out.scripts).toEqual({ head: [], body_start: [], body_end: [], before_footer: [] });
  });
});
