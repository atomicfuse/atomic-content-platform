/**
 * Ad-free sessions via `?trending`.
 *
 * A visitor who lands with a `trending` query parameter (any value, any
 * case) gets a session cookie and sees no ads on that site until the
 * browser session ends. Tracking pixels (`config.tracking`) are kept.
 *
 * The middleware swaps the request's config for `stripAds(config)`, so
 * every ad reader — AdSlot islands, inline ads, InterstitialLoader,
 * layout scripts, Grid feed — sees an ad-free config without its own
 * check. Nothing here is written to KV.
 *
 * Pure functions; testable without a runtime.
 */
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { parseCookie } from './preview-override';

const QUERY_PARAM = 'trending';
const COOKIE_NAME = 'atl_noads';

/** Session cookie (no Max-Age/Expires) — cleared when the browser session ends. */
export const NO_ADS_COOKIE_HEADER = `${COOKIE_NAME}=1; Path=/; Secure; HttpOnly; SameSite=Lax`;

/** True when the URL has a `trending` query parameter name, whatever its value or case. */
export function hasNoAdsParam(searchParams: URLSearchParams): boolean {
  for (const name of searchParams.keys()) {
    if (name.toLowerCase() === QUERY_PARAM) return true;
  }
  return false;
}

/** True when the request carries the ad-free session cookie. */
export function hasNoAdsCookie(cookieHeader: string | null): boolean {
  try {
    return parseCookie(cookieHeader, COOKIE_NAME) === '1';
  } catch {
    // Note: parseCookie's decodeURIComponent throws on a malformed value;
    // a broken cookie just means "not ad-free", never a 500.
    return false;
  }
}

/**
 * Returns a copy of `config` with every ad source removed: placements,
 * the interstitial and all four page-wide script positions (where ad
 * SDKs live). Tracking and every other field are left untouched.
 */
export function stripAds(config: ResolvedConfig): ResolvedConfig {
  return {
    ...config,
    ads_config: { ...config.ads_config, interstitial: false, ad_placements: [] },
    scripts: { head: [], body_start: [], body_end: [], before_footer: [] },
  };
}
