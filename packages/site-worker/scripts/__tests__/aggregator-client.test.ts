import { describe, it, expect, vi } from 'vitest';
import { aggregatorBase, fetchBundleItems, fetchBundleNames } from '../lib/aggregator-client';

describe('aggregatorBase', () => {
  it('prefers CONTENT_API_BASE_URL and strips /api', () => {
    expect(aggregatorBase({ CONTENT_API_BASE_URL: 'https://agg.example/api/', CONTENT_AGGREGATOR_URL: 'https://stale' })).toBe('https://agg.example');
  });
});

describe('fetchBundleItems', () => {
  it('pages until total_pages and requests active enriched bundle content', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: '1' }], total_pages: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: '2' }], total_pages: 2 })));
    const items = await fetchBundleItems('https://agg', 'b1', fetchFn as unknown as typeof fetch);
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(String(fetchFn.mock.calls[0]![0])).toContain('/api/content?bundle_id=b1&status=active&enriched=true&page_size=100&page=1');
  });
  it('throws on a non-2xx response (so the bundle is skipped, not emptied)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('x', { status: 502 }));
    await expect(fetchBundleItems('https://agg', 'b1', fetchFn as unknown as typeof fetch)).rejects.toThrow(/502/);
  });
});

describe('fetchBundleNames', () => {
  it('maps id → name and returns an empty map on failure', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 'b1', name: 'Scoopella' }] })));
    expect((await fetchBundleNames('https://agg', ok as unknown as typeof fetch)).get('b1')).toBe('Scoopella');
    const bad = vi.fn().mockResolvedValue(new Response('x', { status: 500 }));
    expect((await fetchBundleNames('https://agg', bad as unknown as typeof fetch)).size).toBe(0);
  });
});
