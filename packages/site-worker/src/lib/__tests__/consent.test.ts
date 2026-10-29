import { describe, it, expect, vi } from 'vitest';
import {
  CONSENT_DEFAULTS,
  normalizeConsentConfig,
  regionFor,
  parseConsentCookie,
  formatConsentCookie,
  decideConsent,
} from '../consent';
import type { ResolvedConsentConfig } from '@atomic-platform/shared-types';

const on = (over: Partial<ResolvedConsentConfig> = {}): ResolvedConsentConfig => ({
  ...CONSENT_DEFAULTS,
  enabled: true,
  ...over,
});

describe('normalizeConsentConfig', () => {
  it('returns the defaults for a missing block', () => {
    expect(normalizeConsentConfig(undefined)).toEqual(CONSENT_DEFAULTS);
    expect(CONSENT_DEFAULTS).toEqual({
      enabled: false,
      show_to: 'everyone',
      countries: [],
      message: '',
      privacy_url: '/privacy',
    });
  });

  it('falls back to defaults for invalid values and warns', () => {
    const warn = vi.fn();
    const out = normalizeConsentConfig({ show_to: 'banana', enabled: 'yes' }, warn);
    expect(out.show_to).toBe('everyone');
    expect(out.enabled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('upper-cases, trims, dedupes and drops invalid country codes', () => {
    expect(normalizeConsentConfig({ countries: ['de', ' fr ', 'DE', 'zzz1'] }).countries).toEqual(['DE', 'FR']);
  });

  it('uses /privacy for an empty privacy_url and keeps a message', () => {
    const out = normalizeConsentConfig({ privacy_url: '', message: ' Hi ' });
    expect(out.privacy_url).toBe('/privacy');
    expect(out.message).toBe('Hi');
  });
});

describe('regionFor', () => {
  it.each(['DE', 'GB', 'CH', 'NO', 'IS', 'LI', 'de'])('%s is opt-in', (c) => {
    expect(regionFor(c)).toBe('opt_in');
  });
  it.each(['US', 'IL', 'BR'])('%s is notice', (c) => {
    expect(regionFor(c)).toBe('notice');
  });
  it.each([null, undefined, '', 'XX', 'T1'])('unknown %s is opt-in (fail safe)', (c) => {
    expect(regionFor(c)).toBe('opt_in');
  });
});

describe('consent cookie', () => {
  it('parses v1 values', () => {
    expect(parseConsentCookie('v1.1.0')).toEqual({ analytics: true, marketing: false });
    expect(parseConsentCookie('v1.0.1')).toEqual({ analytics: false, marketing: true });
  });
  it.each(['v2.1.1', 'v1.x.1', 'v1.1', '', null, undefined, 'v1.1.1.1'])('rejects %s', (v) => {
    expect(parseConsentCookie(v)).toBeNull();
  });
  it('round-trips', () => {
    const choice = { analytics: true, marketing: false };
    expect(formatConsentCookie(choice)).toBe('v1.1.0');
    expect(parseConsentCookie(formatConsentCookie(choice))).toEqual(choice);
  });
});

describe('decideConsent', () => {
  it('does nothing when disabled', () => {
    expect(decideConsent({ consent: CONSENT_DEFAULTS, country: 'DE', cookie: null })).toEqual({
      region: 'opt_in',
      showBanner: false,
      analyticsAllowed: true,
      marketingAllowed: true,
      stored: false,
    });
  });

  it('follows a stored choice without a banner', () => {
    const d = decideConsent({ consent: on(), country: 'US', cookie: { analytics: false, marketing: false } });
    expect(d).toMatchObject({ showBanner: false, analyticsAllowed: false, marketingAllowed: false, stored: true });
  });

  it('denies by default in an opt-in country and shows the banner', () => {
    expect(decideConsent({ consent: on(), country: 'DE', cookie: null })).toMatchObject({
      region: 'opt_in', showBanner: true, analyticsAllowed: false, marketingAllowed: false, stored: false,
    });
  });

  it('allows by default elsewhere and still shows the banner', () => {
    expect(decideConsent({ consent: on(), country: 'US', cookie: null })).toMatchObject({
      region: 'notice', showBanner: true, analyticsAllowed: true, marketingAllowed: true,
    });
  });

  it('show_to countries: an unlisted opt-in country gets no banner and everything allowed', () => {
    const consent = on({ show_to: 'countries', countries: ['FR'] });
    expect(decideConsent({ consent, country: 'DE', cookie: null })).toMatchObject({
      showBanner: false, analyticsAllowed: true, marketingAllowed: true,
    });
    expect(decideConsent({ consent, country: 'FR', cookie: null })).toMatchObject({
      showBanner: true, analyticsAllowed: false, marketingAllowed: false,
    });
  });
});
