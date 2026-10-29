/**
 * Cookie-consent decisions.
 *
 * The banner is our own (not an IAB TCF consent manager). Visitors in an
 * opt-in country (EU/EEA, UK, Switzerland — or an unknown country) are
 * untracked until they accept; everyone else is tracked by default and can
 * reject. Ads are never withheld; only "marketing" tracking (Meta pixel,
 * `tracking.custom`) is, and Google tags follow Consent Mode instead.
 *
 * Pure functions; testable without a runtime. Used at seed time
 * (`normalizeConsentConfig`) and per request in the PixelLoader island.
 */
import type { ResolvedConsentConfig } from '@atomic-platform/shared-types';

/** Countries where tracking needs an explicit Accept (GDPR / UK GDPR / Swiss FADP). */
export const OPT_IN_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'CH',
];

/** Off by default: a KV entry or config without `consent` must behave exactly as before. */
export const CONSENT_DEFAULTS: ResolvedConsentConfig = {
  enabled: false,
  show_to: 'everyone',
  countries: [],
  message: '',
  privacy_url: '/privacy',
};

export const DEFAULT_CONSENT_MESSAGE =
  'We use cookies to measure traffic and improve your experience. You can accept, reject, or choose in Settings.';

export const CONSENT_COOKIE = 'atl_consent';

export type ConsentRegion = 'opt_in' | 'notice';

export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}

export interface ConsentDecision {
  region: ConsentRegion;
  showBanner: boolean;
  analyticsAllowed: boolean;
  marketingAllowed: boolean;
  /** True when the visitor already chose (cookie present). */
  stored: boolean;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const OPT_IN = new Set(OPT_IN_COUNTRIES);
/** Cloudflare's "unknown" (XX) and Tor (T1) codes. */
const UNKNOWN_COUNTRIES = new Set(['XX', 'T1']);

/**
 * Fills every field of a raw `consent` block, replacing invalid values with
 * defaults. Never throws — a bad value is reported through `warn`.
 */
export function normalizeConsentConfig(
  raw: unknown,
  warn: (msg: string) => void = () => {},
): ResolvedConsentConfig {
  if (raw == null) return { ...CONSENT_DEFAULTS, countries: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warn('consent must be an object — using defaults');
    return { ...CONSENT_DEFAULTS, countries: [] };
  }
  const r = raw as Record<string, unknown>;
  const out: ResolvedConsentConfig = { ...CONSENT_DEFAULTS, countries: [] };

  if (r.enabled !== undefined) {
    if (typeof r.enabled === 'boolean') out.enabled = r.enabled;
    else warn(`consent.enabled must be true/false (got ${JSON.stringify(r.enabled)}) — using false`);
  }
  if (r.show_to !== undefined) {
    if (r.show_to === 'everyone' || r.show_to === 'countries') out.show_to = r.show_to;
    else warn(`consent.show_to must be "everyone" or "countries" (got ${JSON.stringify(r.show_to)}) — using "everyone"`);
  }
  if (Array.isArray(r.countries)) {
    const codes = r.countries
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => COUNTRY_CODE.test(c));
    out.countries = [...new Set(codes)];
  } else if (r.countries !== undefined) {
    warn('consent.countries must be a list of country codes — ignoring');
  }
  if (typeof r.message === 'string') out.message = r.message.trim();
  if (typeof r.privacy_url === 'string' && r.privacy_url.trim()) out.privacy_url = r.privacy_url.trim();
  return out;
}

/** Opt-in for listed countries and whenever the country is unknown (fail safe). */
export function regionFor(country: string | null | undefined): ConsentRegion {
  const c = (country ?? '').trim().toUpperCase();
  if (!COUNTRY_CODE.test(c) || UNKNOWN_COUNTRIES.has(c)) return 'opt_in';
  return OPT_IN.has(c) ? 'opt_in' : 'notice';
}

/** `v1.<analytics>.<marketing>` with each flag 0/1. Anything else = no stored choice. */
export function parseConsentCookie(value: string | null | undefined): ConsentChoice | null {
  const m = /^v1\.([01])\.([01])$/.exec(value ?? '');
  if (!m) return null;
  return { analytics: m[1] === '1', marketing: m[2] === '1' };
}

export function formatConsentCookie(choice: ConsentChoice): string {
  return `v1.${choice.analytics ? 1 : 0}.${choice.marketing ? 1 : 0}`;
}

/** What to render for one visitor. See the design doc's decision rules. */
export function decideConsent(input: {
  consent: ResolvedConsentConfig;
  country: string | null;
  cookie: ConsentChoice | null;
}): ConsentDecision {
  const { consent, country, cookie } = input;
  const region = regionFor(country);
  if (!consent.enabled) {
    return { region, showBanner: false, analyticsAllowed: true, marketingAllowed: true, stored: false };
  }
  if (cookie) {
    return {
      region,
      showBanner: false,
      analyticsAllowed: cookie.analytics,
      marketingAllowed: cookie.marketing,
      stored: true,
    };
  }
  const code = (country ?? '').trim().toUpperCase();
  const covered = consent.show_to === 'everyone' || consent.countries.includes(code);
  // Not covered by `show_to: countries` = the admin chose no banner here, so nothing is withheld.
  if (!covered) {
    return { region, showBanner: false, analyticsAllowed: true, marketingAllowed: true, stored: false };
  }
  const allowed = region === 'notice';
  return { region, showBanner: true, analyticsAllowed: allowed, marketingAllowed: allowed, stored: false };
}
