import { describe, expect, it } from 'vitest';
import { sliceForPage } from '../articles-pagination';

const fixtures = Array.from({ length: 50 }, (_, i) => ({ slug: `s${i}`, title: `T${i}` }));

describe('sliceForPage', () => {
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
