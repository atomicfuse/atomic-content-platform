import { describe, it, expect } from 'vitest';
import { parseBriefSections, externalSlug, toExternalRecord, mergeBundleIndex, collectBundleIds, rewrittenIdsFromFrontmatter, type AggregatorItem } from '../lib/grid-bundles';

const NOW = new Date('2026-10-07T12:00:00Z');
const item = (o: Partial<AggregatorItem> = {}): AggregatorItem => ({
  id: 'a1', url: 'https://www.instyle.com/x', title: 'Dakota Johnson’s $15 Phone Case',
  description: 'Fall in accessory form.', thumbnail: { url: 'https://img/x.jpg' },
  content_type: 'article', language: 'EN', source: { name: 'WS Insider - Lifestyle' }, author: 'Us Weekly',
  published_at: '2026-10-06T05:30:00.000Z', categories: [{ name: 'Pop Culture' }], tags: [{ name: 'dakota-johnson' }],
  summary: '**What It Covers:**\nDakota carried a burgundy case.\n\n**Why It Matters Now:**\nFall trend.\n\n**Content Opportunity:**\nMake a reel.\n\n**Key Angles:**\n- angle',
  ...o,
});

describe('parseBriefSections', () => {
  it('keeps only What It Covers and Why It Matters Now', () => {
    expect(parseBriefSections(item().summary)).toEqual({ whatItCovers: 'Dakota carried a burgundy case.', whyItMatters: 'Fall trend.' });
  });
  it('accepts text on the same line as the heading (the more common live format)', () => {
    expect(parseBriefSections('**What It Covers:** Jim Bakker has died.\nMore detail.\n\n**Why It Matters Now:** Legacy.\n\n**Key Angles:** x')).toEqual({
      whatItCovers: 'Jim Bakker has died.\nMore detail.', whyItMatters: 'Legacy.',
    });
  });
  it('accepts "What It Appears To Cover", CRLF and missing sections', () => {
    expect(parseBriefSections('**What It Appears To Cover:**\r\nA thing.\r\n').whatItCovers).toBe('A thing.');
    expect(parseBriefSections(null)).toEqual({ whatItCovers: '', whyItMatters: '' });
    expect(parseBriefSections('no headings here')).toEqual({ whatItCovers: '', whyItMatters: '' });
  });
});

describe('toExternalRecord', () => {
  it('maps an eligible article', () => {
    const r = toExternalRecord(item(), new Set(), NOW)!;
    expect(r).toMatchObject({ id: 'a1', slug: 'dakota-johnson-s-15-phone-case', sourceName: 'WS Insider - Lifestyle', imageUrl: 'https://img/x.jpg', whatItCovers: 'Dakota carried a burgundy case.', syncedAt: NOW.toISOString() });
  });
  it.each([
    ['non-article', { content_type: 'trend' }],
    ['no image', { thumbnail: null }],
    ['empty image url', { thumbnail: { url: '' } }],
    ['non-English', { language: 'FR' }],
    ['no What It Covers and no description', { summary: 'x', description: null }],
  ])('skips %s', (_l, o) => {
    expect(toExternalRecord(item(o as Partial<AggregatorItem>), new Set(), NOW)).toBeNull();
  });
  it.each([
    ['javascript: link', { url: 'javascript:alert(1)' }],
    ['relative link', { url: '/x' }],
    ['empty link', { url: '' }],
    ['non-http image', { thumbnail: { url: 'data:image/png;base64,xx' } }],
  ])('skips unsafe or unusable URLs: %s', (_l, o) => {
    expect(toExternalRecord(item(o as Partial<AggregatorItem>), new Set(), NOW)).toBeNull();
  });
  it('skips items a network site already rewrote (D6)', () => {
    expect(toExternalRecord(item(), new Set(['a1']), NOW)).toBeNull();
  });
  it('accepts lower-case "en"', () => {
    expect(toExternalRecord(item({ language: 'en' }), new Set(), NOW)).not.toBeNull();
  });
});

describe('externalSlug', () => {
  it('is kebab, capped at 80, never empty', () => {
    expect(externalSlug('A'.repeat(200)).length).toBeLessThanOrEqual(80);
    expect(externalSlug('!!!')).toBe('story');
  });
});

describe('mergeBundleIndex', () => {
  const rec = (id: string, at: string) => toExternalRecord(item({ id, published_at: at }), new Set(), NOW)!;
  it('merges newest first and never drops old entries (D7)', () => {
    const first = mergeBundleIndex(null, 'b', 'Scoopella', [rec('old', '2026-10-01T00:00:00Z')], NOW);
    const second = mergeBundleIndex(first, 'b', 'Scoopella', [rec('new', '2026-10-06T00:00:00Z')], NOW);
    expect(second.items.map((i) => i.id)).toEqual(['new', 'old']);
  });
  it('updates an existing entry in place (title change) and caps at 300', () => {
    const many = Array.from({ length: 305 }, (_, i) => rec(`i${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    const idx = mergeBundleIndex(null, 'b', 'n', many, NOW);
    expect(idx.items).toHaveLength(300);
    expect(idx.items[0]!.id).toBe('i304');
  });
});

describe('collectBundleIds / rewrittenIdsFromFrontmatter', () => {
  it('collects unique bundle ids from Grid configs', () => {
    expect(collectBundleIds([{ grid: { topics: [{ bundles: ['b1', 'b2'] }, { bundles: ['b1'] }] } }, null, {}])).toEqual(['b1', 'b2']);
  });
  it('reads source_item_id from article frontmatter', () => {
    expect([...rewrittenIdsFromFrontmatter([{ source_item_id: 'a1' }, { title: 'x' }, { source_item_id: 7 }])]).toEqual(['a1', '7']);
  });
});

describe('bundleIdsFromEnvironments', () => {
  it('collects bundles from prod and staging configs (staging-only Grid sites count)', async () => {
    const { bundleIdsFromEnvironments } = await import('../lib/grid-bundles');
    const readers = {
      prod: async (id: string) => (id === 'live-grid' ? { grid: { topics: [{ bundles: ['b1'] }] } } : null),
      staging: async (id: string) => (id === 'danatest' ? { grid: { topics: [{ bundles: ['b2', 'b1'] }] } } : null),
    };
    expect(await bundleIdsFromEnvironments(['live-grid', 'danatest', 'other'], readers)).toEqual(['b1', 'b2']);
  });
  it('a failing staging read does not drop prod bundles', async () => {
    const { bundleIdsFromEnvironments } = await import('../lib/grid-bundles');
    const readers = {
      prod: async () => ({ grid: { topics: [{ bundles: ['b1'] }] } }),
      staging: async () => { throw new Error('kv 500'); },
    };
    expect(await bundleIdsFromEnvironments(['x'], readers)).toEqual(['b1']);
  });
});
