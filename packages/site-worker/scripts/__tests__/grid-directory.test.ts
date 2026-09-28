import { describe, expect, it } from 'vitest';
import { buildNetworkDirectory } from '../lib/grid-directory';

const NOW = new Date('2026-09-27T00:00:00Z');
describe('buildNetworkDirectory', () => {
  it('maps index + config; hostname from custom_domain, then config domain, then siteId', () => {
    const dir = buildNetworkDirectory([
      { domain: 'scienceworld', status: 'Live', vertical: 'Science', custom_domain: 'ScienceWorld.com' },
      { domain: 'plain', status: 'Live', vertical: 'Travel', custom_domain: null },
      { domain: 'bare', status: 'Staging', vertical: null },
    ], new Map([
      ['scienceworld', { site_name: 'Science World', theme: { favicon: '/scienceworld/assets/f.png' } }],
      ['plain', { site_name: 'Plain', domain: 'plain.io' }],
    ]), NOW);
    expect(dir.generatedAt).toBe('2026-09-27T00:00:00.000Z');
    expect(dir.sites).toEqual([
      { siteId: 'scienceworld', hostname: 'scienceworld.com', name: 'Science World', favicon: '/scienceworld/assets/f.png', vertical: 'Science', status: 'Live', isGrid: false, account: 'assets' },
      { siteId: 'plain', hostname: 'plain.io', name: 'Plain', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
      { siteId: 'bare', hostname: 'bare', name: 'bare', favicon: null, vertical: '', status: 'Staging', isGrid: false, account: 'assets' },
    ]);
  });
  it('drops deleted entries, flags Grid and Dev1 sites', () => {
    const dir = buildNetworkDirectory([
      { domain: 'gone', status: 'Live', deleted_at: '2026-01-01' },
      { domain: 'gone2', status: 'deleted' },
      { domain: 'muvizzcom', status: 'Live', vertical: 'Entertainment' },
      { domain: 'mygrid', status: 'Live' },
    ], new Map([['mygrid', { theme: { template: 'grid' } }]]), NOW);
    expect(dir.sites.map((s) => [s.siteId, s.account, s.isGrid])).toEqual([['muvizzcom', 'dev1', false], ['mygrid', 'assets', true]]);
  });
});
