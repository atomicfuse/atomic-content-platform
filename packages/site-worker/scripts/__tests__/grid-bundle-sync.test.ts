import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNetworkArticleFrontmatter, syncBundles, type AggregatorItem } from '../lib/grid-bundles';

const art = (id: string): AggregatorItem => ({
  id, url: `https://x/${id}`, title: `T ${id}`, description: 'd', summary: '**What It Covers:**\nw',
  thumbnail: { url: 'https://i' }, content_type: 'article', language: 'EN', source: { name: 'S' }, author: null,
  published_at: '2026-10-06T00:00:00Z',
});
const NOW = new Date('2026-10-07T00:00:00Z');

describe('syncBundles', () => {
  it('writes one item record per new story and the merged index', async () => {
    const out = await syncBundles(['b'], new Map([['b', 'Scoopella']]), new Set(), {
      fetchItems: async () => [art('a'), art('c')], readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries.map((e) => e.key).sort()).toEqual(['grid-ext-index:b', 'grid-ext-item:a', 'grid-ext-item:c']);
    expect(JSON.parse(out.entries.find((e) => e.key === 'grid-ext-index:b')!.value).name).toBe('Scoopella');
    expect(out.failed).toEqual([]);
  });
  it('leaves a bundle untouched when the aggregator fails', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: vi.fn().mockRejectedValue(new Error('502')), readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries).toEqual([]);
    expect(out.failed).toEqual(['b']);
  });
  it('writes nothing for a bundle whose fetch returned zero eligible items', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(['a']), {
      fetchItems: async () => [art('a')], readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries).toEqual([]);
  });
  it('writes a story shared by two bundles once', async () => {
    const out = await syncBundles(['b1', 'b2'], new Map(), new Set(), {
      fetchItems: async () => [art('a')], readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries.filter((e) => e.key === 'grid-ext-item:a')).toHaveLength(1);
  });
});

describe('readNetworkArticleFrontmatter', () => {
  it('reads article frontmatter for each domain and skips missing folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'net-'));
    mkdirSync(join(root, 'sites/site-a/articles'), { recursive: true });
    writeFileSync(join(root, 'sites/site-a/articles/x.md'), '---\nsource_item_id: abc\n---\nbody');
    writeFileSync(join(root, 'sites/site-a/articles/notes.txt'), 'ignored');
    const fms = await readNetworkArticleFrontmatter(root, ['site-a', 'missing']);
    expect(fms).toEqual([{ source_item_id: 'abc' }]);
  });
});

describe('syncBundles — later rewrites and bad items', () => {
  const existingIndex = (ids: string[]) => ({ bundleId: 'b', name: 'n', updatedAt: 'u', items: ids.map((id) => ({ id, slug: 's', title: 't', description: '', imageUrl: 'https://i', sourceName: 'S', publishedAt: '2026-10-01T00:00:00Z' })) });

  it('drops an indexed story once a network site has rewritten it (D6), even with no new items', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(['old']), {
      fetchItems: async () => [art('old')], readIndex: async () => existingIndex(['old', 'keep']), now: () => NOW,
    });
    const index = JSON.parse(out.entries.find((e) => e.key === 'grid-ext-index:b')!.value);
    expect(index.items.map((i: { id: string }) => i.id)).toEqual(['keep']);
  });

  it('skips one malformed item instead of the whole bundle', async () => {
    const bad = { ...art('bad'), title: null } as unknown as AggregatorItem;
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [bad, art('good')], readIndex: async () => null, now: () => NOW,
    });
    expect(out.failed).toEqual([]);
    expect(out.entries.map((e) => e.key).sort()).toEqual(['grid-ext-index:b', 'grid-ext-item:good']);
  });
});
