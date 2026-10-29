import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { getConfig } from '../config';
import { CONSENT_DEFAULTS, normalizeConsentConfig } from '../consent';
import { deepMerge } from '../../../scripts/lib/resolve';

describe('consent runtime default', () => {
  it('a KV config seeded before consent existed gets the (disabled) defaults', () => {
    const config = { layout: {}, scripts: {} } as unknown as ResolvedConfig;
    expect(getConfig({ locals: { site: { config } } } as never).consent).toEqual(CONSENT_DEFAULTS);
  });

  it('keeps a seeded consent block', () => {
    const consent = { ...CONSENT_DEFAULTS, enabled: true };
    const config = { layout: {}, scripts: {}, consent } as unknown as ResolvedConfig;
    expect(getConfig({ locals: { site: { config } } } as never).consent).toBe(consent);
  });
});

describe('consent seed-time resolution', () => {
  it('merges org → group → site per key, with countries replaced by the last layer', () => {
    const layers = [
      { consent: { enabled: true, countries: ['DE'] } },
      { consent: { countries: ['FR'] } },
      { consent: { message: 'Hi' } },
    ];
    const merged = layers.reduce((acc, l) => deepMerge(acc, l) as Record<string, unknown>, {} as Record<string, unknown>);
    expect(normalizeConsentConfig(merged.consent)).toEqual({
      enabled: true,
      show_to: 'everyone',
      countries: ['FR'],
      message: 'Hi',
      privacy_url: '/privacy',
    });
  });

  it('a site can switch off what the org switched on', () => {
    const merged = [{ consent: { enabled: true } }, { consent: { enabled: false } }]
      .reduce((acc, l) => deepMerge(acc, l) as Record<string, unknown>, {} as Record<string, unknown>);
    expect(normalizeConsentConfig(merged.consent).enabled).toBe(false);
  });
});
