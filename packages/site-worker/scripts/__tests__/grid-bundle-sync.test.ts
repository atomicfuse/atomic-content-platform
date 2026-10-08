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

describe('syncBundles — publisher favicons', () => {
  const indexOf = (out: { entries: Array<{ key: string; value: string }> }) =>
    JSON.parse(out.entries.find((e) => e.key === 'grid-ext-index:b')!.value) as { items: Array<{ id: string; favicon?: string }> };
  const withSource = (id: string, url: string): AggregatorItem => ({ ...art(id), url });

  it('adds the favicon path to index entries whose publisher has one', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [withSource('a', 'https://www.cnn.com/x'), withSource('c', 'https://nothing.com/y')],
      readIndex: async () => null, now: () => NOW,
      favicons: async (domains) => new Map(domains.filter((d) => d === 'cnn.com').map((d) => [d, `/fav/${d}.png`])),
    });
    const items = indexOf(out).items;
    expect(items.find((i) => i.id === 'a')!.favicon).toBe('/fav/cnn.com.png');
    expect(items.find((i) => i.id === 'c')).not.toHaveProperty('favicon');
  });

  it('rewrites an otherwise unchanged index when a favicon becomes available for old entries', async () => {
    const existing = { bundleId: 'b', name: 'n', updatedAt: 'u', items: [{ id: 'old', slug: 's', title: 't', description: '', imageUrl: 'https://i', sourceName: 'cnn.com', publishedAt: '2026-10-01T00:00:00Z' }] };
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [], readIndex: async () => existing, now: () => NOW,
      favicons: async () => new Map([['cnn.com', '/fav/cnn.com.png']]),
    });
    expect(indexOf(out).items[0]!.favicon).toBe('/fav/cnn.com.png');
  });

  it('still syncs the bundle when favicon lookup fails', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [art('a')], readIndex: async () => null, now: () => NOW,
      favicons: async () => { throw new Error('r2 down'); },
    });
    expect(out.failed).toEqual([]);
    expect(indexOf(out).items[0]).not.toHaveProperty('favicon');
  });
});

describe('syncBundles — images that do not load', () => {
  const withImage = (id: string, img: string): AggregatorItem => ({ ...art(id), thumbnail: { url: img } });
  const indexed = (ids: string[]) => ({ bundleId: 'b', name: 'n', updatedAt: 'u', items: ids.map((id) => ({ id, slug: 's', title: 't', description: '', imageUrl: `https://img/${id}`, sourceName: 'S', publishedAt: '2026-10-01T00:00:00Z' })) });

  it('skips a new story whose image fails to load, checking only stories not yet indexed', async () => {
    const imageLoads = vi.fn(async (url: string) => !url.includes('blocked'));
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [withImage('ok', 'https://img/ok'), withImage('bad', 'https://img/blocked'), withImage('old', 'https://img/old')],
      readIndex: async () => indexed(['old']), now: () => NOW, imageLoads,
    });
    const keys = out.entries.map((e) => e.key);
    expect(keys).toContain('grid-ext-item:ok');
    expect(keys).not.toContain('grid-ext-item:bad');
    const index = JSON.parse(out.entries.find((e) => e.key === 'grid-ext-index:b')!.value) as { items: Array<{ id: string }> };
    expect(index.items.map((i) => i.id).sort()).toEqual(['ok', 'old']);
    expect(imageLoads.mock.calls.map(([u]) => u).sort()).toEqual(['https://img/blocked', 'https://img/ok']);
  });

  it('recheckImages also removes already-indexed stories whose image no longer loads', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: async () => [], readIndex: async () => indexed(['keep', 'gone']), now: () => NOW,
      imageLoads: async (url) => !url.endsWith('/gone'), recheckImages: true,
    });
    const index = JSON.parse(out.entries.find((e) => e.key === 'grid-ext-index:b')!.value) as { items: Array<{ id: string }> };
    expect(index.items.map((i) => i.id)).toEqual(['keep']);
  });
});
