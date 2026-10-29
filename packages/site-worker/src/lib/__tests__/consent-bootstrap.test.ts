// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConsentBootstrap } from '../consent-scripts';
import { OPT_IN_COUNTRIES } from '../consent';

type Win = Window & { dataLayer?: unknown[]; gtag?: unknown };

function run(): unknown[][] {
  // eslint-disable-next-line no-new-func
  new Function(buildConsentBootstrap())();
  return ((window as Win).dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
}

function clearCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

const ALL = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
const all = (v: string): Record<string, string> => Object.fromEntries(ALL.map((k) => [k, v]));

beforeEach(() => {
  delete (window as Win).dataLayer;
  delete (window as Win).gtag;
  clearCookies();
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
});
afterEach(clearCookies);

describe('buildConsentBootstrap', () => {
  it('without a stored choice: denied in opt-in countries, granted elsewhere', () => {
    const calls = run();
    expect(calls[0]).toEqual(['consent', 'default', { ...all('denied'), region: [...OPT_IN_COUNTRIES] }]);
    expect(calls[1]).toEqual(['consent', 'default', all('granted')]);
    expect(calls).toHaveLength(2);
  });

  it('a stored choice wins everywhere, with no region default', () => {
    document.cookie = 'atl_consent=v1.1.0; Path=/';
    const calls = run();
    expect(calls).toEqual([[
      'consent', 'default',
      { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' },
    ]]);
  });

  it('a malformed cookie counts as no choice', () => {
    document.cookie = 'atl_consent=v9.1.1; Path=/';
    expect(run()).toHaveLength(2);
  });

  it('Global Privacy Control denies ad keys outside the opt-in region', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    const calls = run();
    expect(calls[1]).toEqual(['consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted',
    }]);
  });

  it('defines window.gtag so a GTM-only site still has the shim', () => {
    run();
    expect(typeof (window as Win).gtag).toBe('function');
  });

  it('contains no site- or visitor-specific data (safe in cached HTML)', () => {
    const s = buildConsentBootstrap();
    expect(s).not.toContain('{{');
    expect(buildConsentBootstrap()).toBe(s);
  });
});
