import { describe, expect, it } from 'vitest';
import {
  countryFromRequest,
  consentCookieFromRequest,
  consentCountryParam,
  consentCountryCookieHeader,
  CONSENT_COUNTRY_CLEAR_COOKIE_HEADER,
} from '../consent-request';

function req(headers: Record<string, string> = {}, cf?: Record<string, unknown>): Request {
  const r = new Request('https://example.com/_server-islands/PixelLoader', { headers });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
}

describe('countryFromRequest', () => {
  it('reads the cf-ipcountry header (upper-cased)', () => {
    expect(countryFromRequest(req({ 'cf-ipcountry': 'us' }), { isStaging: false })).toBe('US');
  });
  it('prefers request.cf.country over the header', () => {
    expect(countryFromRequest(req({ 'cf-ipcountry': 'US' }, { country: 'DE' }), { isStaging: false })).toBe('DE');
  });
  it('uses the staging override cookie only on staging', () => {
    const r = req({ 'cf-ipcountry': 'US', cookie: 'atl_consent_country=FR' });
    expect(countryFromRequest(r, { isStaging: true })).toBe('FR');
    expect(countryFromRequest(r, { isStaging: false })).toBe('US');
  });
  it('returns null with no signal', () => {
    expect(countryFromRequest(req(), { isStaging: false })).toBeNull();
  });
});

describe('consentCookieFromRequest', () => {
  it('reads a stored choice', () => {
    expect(consentCookieFromRequest(req({ cookie: 'a=1; atl_consent=v1.0.1' }))).toEqual({ analytics: false, marketing: true });
  });
  it('treats malformed cookies as no choice without throwing', () => {
    expect(consentCookieFromRequest(req({ cookie: 'atl_consent=%E0%A4%A' }))).toBeNull();
    expect(consentCookieFromRequest(req({ cookie: 'atl_consent=v2.1.1' }))).toBeNull();
  });
});

describe('consentCountryParam', () => {
  it('parses, clears and rejects', () => {
    expect(consentCountryParam(new URLSearchParams('consent_country=de'))).toBe('DE');
    expect(consentCountryParam(new URLSearchParams('consent_country='))).toBe('clear');
    expect(consentCountryParam(new URLSearchParams('consent_country=germany'))).toBeNull();
    expect(consentCountryParam(new URLSearchParams('x=1'))).toBeNull();
  });
  it('builds the session cookie headers', () => {
    expect(consentCountryCookieHeader('DE')).toBe('atl_consent_country=DE; Path=/; HttpOnly; SameSite=Lax');
    expect(CONSENT_COUNTRY_CLEAR_COOKIE_HEADER).toBe('atl_consent_country=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  });
});
