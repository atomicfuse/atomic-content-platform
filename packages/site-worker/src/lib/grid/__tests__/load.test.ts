import { describe, expect, it, vi } from 'vitest';
import { GRID_DEFAULTS, type NetworkDirectory, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import { hashString, loadGridPool, NO_CACHE, toPoolResponse, type JsonCache, type KvReader } from '../load';

const NOW = new Date('2026-09-27T12:00:00Z');
const grid: ResolvedGridConfig = { ...GRID_DEFAULTS, topics: [{ label: 'Travel', slug: 'travel', verticals: ['Travel'] }] };
const directory: NetworkDirectory = { generatedAt: 'g1', sites: [
  { siteId: 'a', hostname: 'a.com', name: 'A', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
  { siteId: 'b', hostname: 'b.com', name: 'B', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
] };
const article = { slug: 'a1', title: 'A1', author: 'E', publishDate: '2026-09-26T00:00:00Z', tags: [], type: 'standard', status: 'published' };
function fakeKv(data: Record<string, unknown>, throwKeys: string[] = []): KvReader {
  return { get: async <T,>(key: string): Promise<T | null> => { if (throwKeys.includes(key)) throw new Error('kv down'); return (data[key] as T) ?? null; } };
}

describe('loadGridPool', () => {
  it('missing directory → empty result, no throw', async () => {
    const r = await loadGridPool(fakeKv({}), NO_CACHE, 'me', grid, NOW);
    expect(r.directory).toBeNull();
    expect(r.pool.items).toEqual([]);
  });
  it('missing or throwing source index → that source skipped and reported, others render', async () => {
    const r = await loadGridPool(fakeKv({ 'network-directory': directory, 'article-index:a': [article] }, ['article-index:b']), NO_CACHE, 'me', grid, NOW);
    expect(r.pool.items.map((i) => i.slug)).toEqual(['a1']);
    expect(r.missingIndexes).toEqual(['b']);
  });
  it('absent (non-throwing) source index → skipped and logged, others render', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // 'article-index:b' is simply not present in the fake KV data — kv.get resolves null,
      // it never throws. Distinct from the throwing case above.
      const r = await loadGridPool(fakeKv({ 'network-directory': directory, 'article-index:a': [article] }), NO_CACHE, 'me', grid, NOW);
      expect(r.pool.items.map((i) => i.slug)).toEqual(['a1']);
      expect(r.missingIndexes).toEqual(['b']);
      expect(errorSpy.mock.calls.some((call) => call.some((arg) => typeof arg === 'string' && arg.includes('b')))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
  it('uses the cache on the second call (keyed by site, directory version and config hash)', async () => {
    const store = new Map<string, unknown>();
    const cache: JsonCache = { get: async (k) => store.get(k) ?? null, put: vi.fn(async (k, v) => { store.set(k, v); }) };
    const kv = fakeKv({ 'network-directory': directory, 'article-index:a': [article], 'article-index:b': [] });
    const spy = vi.spyOn(kv, 'get');
    await loadGridPool(kv, cache, 'me', grid, NOW);
    const callsAfterFirst = spy.mock.calls.length;
    await loadGridPool(kv, cache, 'me', grid, NOW);
    expect(spy.mock.calls.length).toBe(callsAfterFirst + 1);
    expect([...store.keys()][0]).toBe(`pool:me:g1:${hashString(JSON.stringify(grid))}`);
  });
});

describe('toPoolResponse', () => {
  it('marks missing-index sources as excluded with reason missing_index', async () => {
    const data = await loadGridPool(fakeKv({ 'network-directory': directory, 'article-index:a': [article] }), NO_CACHE, 'me', grid, NOW);
    const res = toPoolResponse(data, 'me', grid, NOW);
    expect(res.sources.find((s) => s.siteId === 'b')).toMatchObject({ included: false, reason: 'missing_index' });
    expect(res).toMatchObject({ siteId: 'me', storyMode: 'excerpt', perSiteLimit: 10, directoryGeneratedAt: 'g1' });
  });
});
