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
