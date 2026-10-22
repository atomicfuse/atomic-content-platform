/**
 * Mock-ad preview sessions via `?mockads`.
 *
 * A visitor who lands with a `mockads` query parameter gets a session cookie and, on that site, sees every ad
 * position filled by `mock-ad-fill.js` instead of real ads — the same mocks as the `mock-ads` group, without
 * putting the site in that group (which would show mocks to every visitor). `?mockads=off` (or `=0`) ends it.
 *
 * The middleware swaps the request's config for `mockAds(config)`, so every ad reader — AdSlot islands, inline
 * ads, the Grid feed, layout scripts — sees placements without code and the mock script, with no check of its
 * own. Real ad scripts never load, so no real ad requests or impressions. Nothing here is written to KV.
 *
 * Pure functions; testable without a runtime.
 */
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { parseCookie } from './preview-override';

const QUERY_PARAM = 'mockads';
const COOKIE_NAME = 'atl_mockads';

/** Session cookie (no Max-Age/Expires) — cleared when the browser session ends. */
export const MOCK_ADS_COOKIE_HEADER = `${COOKIE_NAME}=1; Path=/; Secure; HttpOnly; SameSite=Lax`;
/** Clears the session cookie (`?mockads=off`). */
export const MOCK_ADS_CLEAR_COOKIE_HEADER = `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

/** `on` / `off` when the URL has a `mockads` parameter (any case; `off`, `0`, `false` = off), else null. */
export function mockAdsParam(searchParams: URLSearchParams): 'on' | 'off' | null {
  for (const [name, value] of searchParams) {
    if (name.toLowerCase() !== QUERY_PARAM) continue;
    return ['off', '0', 'false'].includes(value.trim().toLowerCase()) ? 'off' : 'on';
  }
  return null;
}

/** True when the request carries the mock-ad session cookie. */
export function hasMockAdsCookie(cookieHeader: string | null): boolean {
  try {
    return parseCookie(cookieHeader, COOKIE_NAME) === '1';
  } catch {
    return false; // a malformed cookie just means "no mock session", never a 500
  }
}

/**
 * Returns a copy of `config` for a mock-ad preview: every placement kept but without its code, no interstitial,
 * the page-wide script positions (where ad SDKs live) emptied, and `mock-ad-fill.js` added. Tracking and every
 * other field are left untouched.
 */
export function mockAds(config: ResolvedConfig): ResolvedConfig {
  const placements = (config.ads_config?.ad_placements ?? []).map(({ code: _code, ...rest }) => rest);
  return {
    ...config,
    ads_config: { ...config.ads_config, interstitial: false, ad_placements: placements },
    scripts: { head: [], body_start: [], body_end: [{ id: 'mock-ad-fill', src: '/mock-ad-fill.js' }], before_footer: [] },
  };
}
