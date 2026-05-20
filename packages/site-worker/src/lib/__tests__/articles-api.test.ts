import { describe, expect, it } from 'vitest';
import { sliceForPage, sliceMoreOn, hasMoreOnAfter } from '../articles-pagination';

const fixtures = Array.from({ length: 50 }, (_, i) => ({ slug: `s${i}`, title: `T${i}` }));

describe('sliceForPage (legacy — preserved for non-homepage callers)', () => {
  it('page 1 returns first initialCount items (page_size * 2)', () => {
    expect(sliceForPage(fixtures, 1, 10).map((x) => x.slug)).toEqual(
      Array.from({ length: 20 }, (_, i) => `s${i}`),
    );
  });
  it('page 2 returns items page_size after the initial batch', () => {
    expect(sliceForPage(fixtures, 2, 10).map((x) => x.slug)).toEqual(
      Array.from({ length: 10 }, (_, i) => `s${20 + i}`),
    );
  });
  it('page beyond end returns empty', () => {
    expect(sliceForPage(fixtures, 99, 10)).toEqual([]);
  });
  it('page < 1 clamps to 1', () => {
    expect(sliceForPage(fixtures, 0, 10).length).toBe(20);
  });
});

describe('sliceMoreOn (new — initial 8, then +4 per page)', () => {
  it('page 1 returns first `initialSize` items', () => {
    expect(sliceMoreOn(fixtures, 1, 8, 4).map((x) => x.slug)).toEqual(
      Array.from({ length: 8 }, (_, i) => `s${i}`),
    );
  });
  it('page 2 returns `loadMoreSize` items after the initial batch', () => {
    expect(sliceMoreOn(fixtures, 2, 8, 4).map((x) => x.slug)).toEqual(
      ['s8', 's9', 's10', 's11'],
    );
  });
  it('page 3 returns next chunk of `loadMoreSize`', () => {
    expect(sliceMoreOn(fixtures, 3, 8, 4).map((x) => x.slug)).toEqual(
      ['s12', 's13', 's14', 's15'],
    );
  });
  it('returns empty when start is past the end', () => {
    expect(sliceMoreOn(fixtures.slice(0, 8), 2, 8, 4)).toEqual([]);
  });
  it('page < 1 returns empty', () => {
    expect(sliceMoreOn(fixtures, 0, 8, 4)).toEqual([]);
    expect(sliceMoreOn(fixtures, -1, 8, 4)).toEqual([]);
  });
});

describe('hasMoreOnAfter', () => {
  it('page 1: true when pool > initialSize', () => {
    expect(hasMoreOnAfter(fixtures, 1, 8, 4)).toBe(true);
    expect(hasMoreOnAfter(fixtures.slice(0, 8), 1, 8, 4)).toBe(false);
    expect(hasMoreOnAfter(fixtures.slice(0, 7), 1, 8, 4)).toBe(false);
  });
  it('page N>=2: true when pool > initialSize + (N-1)*loadMoreSize', () => {
    // After page 2, 12 articles consumed. 50 > 12 → more exists.
    expect(hasMoreOnAfter(fixtures, 2, 8, 4)).toBe(true);
    // 50 > 8 + (10-1)*4 = 44 → still more.
    expect(hasMoreOnAfter(fixtures, 10, 8, 4)).toBe(true);
    // 50 > 8 + (11-1)*4 = 48 → still more (50 > 48).
    expect(hasMoreOnAfter(fixtures, 11, 8, 4)).toBe(true);
    // 50 > 8 + (12-1)*4 = 52 → false.
    expect(hasMoreOnAfter(fixtures, 12, 8, 4)).toBe(false);
  });
});
