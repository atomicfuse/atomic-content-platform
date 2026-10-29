/**
 * Request-side inputs for the consent decision: the visitor's country and
 * their stored choice. Read only in the PixelLoader server island (no-store),
 * never in cached page HTML.
 *
 * Staging hosts accept `?consent_country=XX` (session cookie) so the banner
 * can be checked for any country; production ignores it.
 *
 * Pure functions; testable without a runtime.
 */
import { CONSENT_COOKIE, parseConsentCookie, type ConsentChoice } from './consent';
import { parseCookie } from './preview-override';

export const CONSENT_COUNTRY_COOKIE = 'atl_consent_country';
const QUERY_PARAM = 'consent_country';
const COUNTRY_CODE = /^[A-Z]{2}$/;

function readCookie(request: Request, name: string): string | null {
  try {
    return parseCookie(request.headers.get('cookie'), name);
  } catch {
    return null; // malformed cookie header = no value, never a 500
  }
}

function asCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const c = value.trim().toUpperCase();
  return COUNTRY_CODE.test(c) ? c : null;
}

/** Staging override cookie (staging only) → `request.cf.country` → `cf-ipcountry` header → null. */
export function countryFromRequest(request: Request, opts: { isStaging: boolean }): string | null {
  if (opts.isStaging) {
    const forced = asCountry(readCookie(request, CONSENT_COUNTRY_COOKIE));
    if (forced) return forced;
  }
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  return asCountry(cf?.country) ?? asCountry(request.headers.get('cf-ipcountry'));
}

export function consentCookieFromRequest(request: Request): ConsentChoice | null {
  return parseConsentCookie(readCookie(request, CONSENT_COOKIE));
}

/** `XX` for `?consent_country=xx`, `clear` for an empty value, null when absent or invalid. */
export function consentCountryParam(searchParams: URLSearchParams): string | 'clear' | null {
  if (!searchParams.has(QUERY_PARAM)) return null;
  const raw = searchParams.get(QUERY_PARAM) ?? '';
  if (raw.trim() === '') return 'clear';
  return asCountry(raw);
}

/** Session cookie read by the island on staging. */
export function consentCountryCookieHeader(country: string): string {
  return `${CONSENT_COUNTRY_COOKIE}=${country}; Path=/; HttpOnly; SameSite=Lax`;
}

export const CONSENT_COUNTRY_CLEAR_COOKIE_HEADER = `${CONSENT_COUNTRY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
