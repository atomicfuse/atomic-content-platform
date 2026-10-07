import { describe, expect, it } from 'vitest';
import type { GridPoolItem } from '@atomic-platform/shared-types';
import { nextStoryItem, storyKey } from '../next-story';

const it0 = (slug: string, pills: string[], site = 'a'): GridPoolItem => ({ site, slug, title: slug, publishDate: 'x', pills, pinned: false });
// Pool order = feed order (pins first, then newest).
const pool = [it0('n1', ['t']), it0('n2', ['h']), it0('cur', ['t']), it0('n3', ['t']), it0('n4', ['h']), it0('n5', ['t'])];
const seen = (...slugs: string[]): Set<string> => new Set(slugs.map((s) => `a/${s}`));

describe('nextStoryItem', () => {
  it('takes the next story after the current one in the same pill', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'cur' }, 't', seen('cur'))?.slug).toBe('n3');
  });
  it('skips stories already shown', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'n3' }, 't', seen('cur', 'n3'))?.slug).toBe('n5');
  });
  it('falls back to All when the pill runs out', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'n5' }, 't', seen('cur', 'n3', 'n5'))?.slug).toBe('n1');
  });
  it('uses All order when the story has no pill', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'cur' }, null, seen('cur'))?.slug).toBe('n3');
    expect(nextStoryItem(pool, { site: 'a', slug: 'n3' }, null, seen('cur', 'n3'))?.slug).toBe('n4');
  });
  it('starts from the top when the current story is not in the pool (e.g. aged out)', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'gone' }, 't', seen('gone'))?.slug).toBe('n1');
  });
  it('returns null once everything was shown', () => {
    expect(nextStoryItem(pool, { site: 'a', slug: 'cur' }, 't', new Set(pool.map(storyKey)))).toBeNull();
  });
});
