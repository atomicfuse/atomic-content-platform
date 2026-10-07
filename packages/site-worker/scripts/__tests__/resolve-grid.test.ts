import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, GRID_DEFAULTS } from '@atomic-platform/shared-types';
import { applyGridResolution, mergeGridLayers } from '../lib/resolve-grid';

describe('mergeGridLayers', () => {
  it('scalars: later defined wins; arrays: last non-empty wins', () => {
    const merged = mergeGridLayers([
      { per_site_limit: 5, topics: [{ label: 'A', verticals: ['Travel'] }], exclude_sites: ['x'] },
      undefined,
      { per_site_limit: 8, topics: [], exclude_sites: ['y'] },
    ]);
    expect(merged.per_site_limit).toBe(8);
    expect(merged.topics).toEqual([{ label: 'A', verticals: ['Travel'] }]);
    expect(merged.exclude_sites).toEqual(['y']);
  });
  it('null max_age_days in a later layer removes an earlier limit', () => {
    expect(mergeGridLayers([{ max_age_days: 30 }, { max_age_days: null }]).max_age_days).toBeNull();
  });
});

describe('applyGridResolution', () => {
  it('strips grid + theme.card from non-Grid configs (byte-identical guard)', () => {
    const config: Record<string, unknown> = { theme: { base: 'classic', card: { style: 'flat' } }, grid: { per_site_limit: 3 } };
    applyGridResolution(config, [{ grid: { per_site_limit: 3 } }]);
    expect(config).toEqual({ theme: { base: 'classic' } });
  });
  it('leaves a non-Grid config with no grid fields untouched', () => {
    const config: Record<string, unknown> = { theme: { base: 'modern' }, layout: {} };
    const before = JSON.stringify(config);
    applyGridResolution(config, [{}]);
    expect(JSON.stringify(config)).toBe(before);
  });
  it('resolves grid + card for Grid configs from raw layers', () => {
    const config: Record<string, unknown> = { theme: { template: 'grid', card: { style: 'shadow' } } };
    applyGridResolution(config, [{ grid: { per_site_limit: 5 } }, { grid: { page_size: 12 } }]);
    expect(config.grid).toEqual({ ...GRID_DEFAULTS, per_site_limit: 5, page_size: 12 });
    expect((config.theme as Record<string, unknown>).card).toEqual({ ...GRID_CARD_DEFAULTS, style: 'shadow' });
  });
});

describe('blocked_sources merge', () => {
  it('last non-empty layer wins', () => {
    expect(mergeGridLayers([{ blocked_sources: ['A'] }, { blocked_sources: [] }]).blocked_sources).toEqual(['A']);
  });
});
