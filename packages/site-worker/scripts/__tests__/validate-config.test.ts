import { describe, expect, it } from 'vitest';
import { validateResolvedConfig } from '../lib/validate-config';

describe('validateResolvedConfig', () => {
  const base = {
    ads_config: {
      interstitial: false,
      ad_placements: [{ id: 'sidebar', position: 'sidebar', code: '<div>ad</div>' }],
    },
    scripts: { head: [{ id: 'sdk', src: 'https://cdn.example.com/sdk.js' }] },
    tracking: { ga4: 'G-TEST', facebook_pixel: null },
  };

  it('returns no warnings for a valid config', () => {
    const warnings = validateResolvedConfig(base as Record<string, unknown>, 'testsite');
    expect(warnings).toHaveLength(0);
  });

  it('warns when interstitial is enabled but ad_placements is empty', () => {
    const config = {
      ...base,
      ads_config: { interstitial: true, interstitial_config: { script_inline: 'load()' }, ad_placements: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('ad_placements') && w.includes('empty'))).toBe(true);
  });

  it('warns when interstitial is enabled but no script_url or script_inline', () => {
    const config = {
      ...base,
      ads_config: {
        interstitial: true,
        interstitial_config: { script_url: '', script_inline: '' },
        ad_placements: [{ id: 'x' }],
      },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('interstitial') && w.includes('no script'))).toBe(true);
  });

  it('warns when all tracking fields are null', () => {
    const config = {
      ...base,
      tracking: { ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('tracking'))).toBe(true);
  });

  it('warns when head scripts are empty (no SDK loaded)', () => {
    const config = {
      ...base,
      scripts: { head: [], body_start: [], body_end: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('scripts.head') && w.includes('empty'))).toBe(true);
  });
});
