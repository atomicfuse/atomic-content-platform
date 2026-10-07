import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, type NetworkDirectorySite, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import { resolveSources } from '../sources';

const site = (over: Partial<NetworkDirectorySite>): NetworkDirectorySite => ({
  siteId: 'x', hostname: 'x.com', name: 'X', favicon: null, vertical: 'Travel',
  status: 'Live', isGrid: false, account: 'assets', ...over,
});
const grid = (over: Partial<ResolvedGridConfig> = {}): ResolvedGridConfig => ({
  ...GRID_DEFAULTS,
  topics: [
    { label: 'Travel', slug: 'travel', verticals: ['Travel'], bundles: [] },
    { label: 'Health', slug: 'health', verticals: ['Healthy Living', 'Medical Health'], bundles: [] },
  ],
  ...over,
});
const dir = (sites: NetworkDirectorySite[]) => ({ generatedAt: 't', sites });

describe('resolveSources', () => {
  it('includes sites whose vertical matches a pill (case/space-insensitive) and records pills', () => {
    const r = resolveSources(dir([site({ siteId: 'a', vertical: ' travel ' }), site({ siteId: 'b', vertical: 'Medical Health' })]), grid(), 'me');
    expect(r.sources.map((s) => s.siteId)).toEqual(['a', 'b']);
    expect(r.pillsBySite.get('a')).toEqual(['travel']);
    expect(r.pillsBySite.get('b')).toEqual(['health']);
  });
  it('a vertical listed in two pills feeds both', () => {
    const g = grid({ topics: [
      { label: 'Travel', slug: 'travel', verticals: ['Travel'], bundles: [] },
      { label: 'Trips', slug: 'trips', verticals: ['Travel'], bundles: [] },
    ] });
    expect(resolveSources(dir([site({ siteId: 'a' })]), g, 'me').pillsBySite.get('a')).toEqual(['travel', 'trips']);
  });
  it.each([
    [site({ siteId: 'me' }), 'self'],
    [site({ siteId: 'g', isGrid: true }), 'grid_site'],
    [site({ siteId: 's', status: 'Staging' }), 'not_live'],
    [site({ siteId: 'muvizzcom', account: 'dev1' }), 'dev1_account'],
    [site({ siteId: 'ex' }), 'excluded'],
    [site({ siteId: 'nv', vertical: 'Pets' }), 'no_matching_vertical'],
    [site({ siteId: 'empty', vertical: '' }), 'no_matching_vertical'],
  ])('excludes %o with reason %s', (s, reason) => {
    const r = resolveSources(dir([s]), grid({ exclude_sites: ['ex'] }), 'me');
    expect(r.sources).toEqual([]);
    expect(r.statuses[0]).toMatchObject({ siteId: s.siteId, included: false, reason });
  });
  it('include_sites adds a non-matching site to "All" only (no pills)', () => {
    const r = resolveSources(dir([site({ siteId: 'hiddenstorydaily', vertical: '' })]), grid({ include_sites: ['hiddenstorydaily'] }), 'me');
    expect(r.sources.map((s) => s.siteId)).toEqual(['hiddenstorydaily']);
    expect(r.pillsBySite.get('hiddenstorydaily')).toEqual([]);
  });
  it('a Grid site in include_sites is still excluded', () => {
    const r = resolveSources(dir([site({ siteId: 'g2', isGrid: true })]), grid({ include_sites: ['g2'] }), 'me');
    expect(r.statuses[0]?.reason).toBe('grid_site');
  });
  it('exclude wins over include', () => {
    const r = resolveSources(dir([site({ siteId: 'a' })]), grid({ include_sites: ['a'], exclude_sites: ['a'] }), 'me');
    expect(r.statuses[0]?.reason).toBe('excluded');
  });
});
