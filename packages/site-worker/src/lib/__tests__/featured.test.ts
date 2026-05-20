import { describe, expect, it } from 'vitest';
import { selectFeatured } from '../featured';
import type { ArticleIndexEntry } from '../kv-schema';

const A = (slug: string, featured?: ('hero' | 'must-read')[]): ArticleIndexEntry => ({
  slug, title: slug, author: 'X', publishDate: '2026-01-01', tags: [],
  type: 'standard', status: 'published', featured,
});

describe('selectFeatured', () => {
  const articles = [
    A('a', ['hero']),
    A('b'),
    A('c', ['hero']),
    A('d'),
    A('e', ['must-read']),
    A('f'),
    A('g'),
    A('h'),
    A('i'),
  ];

  it('uses tagged hero articles first, in input order', () => {
    expect(selectFeatured(articles, 'hero', 4).map((a) => a.slug)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('fills remaining slots from non-featured articles', () => {
    expect(selectFeatured(articles, 'hero', 4).length).toBe(4);
  });

  it('does not duplicate when fallback overlaps with tagged', () => {
    const slugs = selectFeatured(articles, 'hero', 4).map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('excludes already-used slugs (e.g. hero) from must-reads fallback', () => {
    const hero = selectFeatured(articles, 'hero', 4);
    const reads = selectFeatured(articles, 'must-read', 5, new Set(hero.map((a) => a.slug)));
    expect(reads.some((r) => hero.some((h) => h.slug === r.slug))).toBe(false);
  });

  it('returns fewer items if the pool is smaller than count', () => {
    expect(selectFeatured([A('a')], 'hero', 4).length).toBe(1);
  });
});

describe("selectFeatured — fallbackOrder", () => {
  const tagged = A('m1', ['must-read']);
  const pool = [
    tagged,
    A('p1'), A('p2'), A('p3'), A('p4'), A('p5'),
  ];

  it("defaults to newest-order fallback (current behavior)", () => {
    const out = selectFeatured(pool, 'must-read', 3).map((a) => a.slug);
    expect(out).toEqual(['m1', 'p1', 'p2']); // tagged first, then input order
  });

  it("with fallbackOrder='random', still puts tagged articles first", () => {
    const out = selectFeatured(pool, 'must-read', 3, new Set(), 'random');
    expect(out[0].slug).toBe('m1');
    expect(out).toHaveLength(3);
    // remaining 2 are some subset of p1..p5
    expect(out.slice(1).every((a) => a.slug.startsWith('p'))).toBe(true);
    expect(new Set(out.map((a) => a.slug)).size).toBe(3); // no duplicates
  });

  it("with fallbackOrder='random', respects exclude set", () => {
    const exclude = new Set(['p1', 'p2', 'p3']);
    const out = selectFeatured(pool, 'must-read', 5, exclude, 'random');
    expect(out.map((a) => a.slug)).not.toContain('p1');
    expect(out.map((a) => a.slug)).not.toContain('p2');
    expect(out.map((a) => a.slug)).not.toContain('p3');
  });

  it("with fallbackOrder='random' and small pool, returns fewer (no duplicates)", () => {
    const out = selectFeatured([A('only', ['must-read'])], 'must-read', 5, new Set(), 'random');
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('only');
  });

  it("with fallbackOrder='random' + seed, output is deterministic", () => {
    const a = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '2026-05-20');
    const b = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '2026-05-20');
    expect(a.map((x) => x.slug)).toEqual(b.map((x) => x.slug));
  });

  it("with fallbackOrder='random' + different seeds, output may differ", () => {
    // Same input, different seeds -> at least one pair of seeds yields a
    // different ordering. We assert on a small set of seeds rather than
    // a single pair, because by chance two specific seeds could collide.
    const seeds = ['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23'];
    const orderings = new Set(
      seeds.map((s) =>
        selectFeatured(pool, 'must-read', 4, new Set(), 'random', s)
          .map((x) => x.slug)
          .join(','),
      ),
    );
    expect(orderings.size).toBeGreaterThan(1);
  });

  it("with fallbackOrder='random' + empty seed, output is deterministic (not Math.random)", () => {
    const a = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '');
    const b = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '');
    expect(a.map((x) => x.slug)).toEqual(b.map((x) => x.slug));
  });

  it("ignores seed when fallbackOrder='newest'", () => {
    const a = selectFeatured(pool, 'must-read', 3, new Set(), 'newest', '2026-05-20');
    const b = selectFeatured(pool, 'must-read', 3); // no seed, no fallbackOrder
    expect(a.map((x) => x.slug)).toEqual(b.map((x) => x.slug));
  });
});
