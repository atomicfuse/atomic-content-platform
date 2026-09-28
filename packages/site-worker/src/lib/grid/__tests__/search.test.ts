import { describe, expect, it } from 'vitest';
import type { GridPoolItem } from '@atomic-platform/shared-types';
import { searchItems } from '../search';

const it0 = (title: string, description?: string): GridPoolItem => ({ site: 'a', slug: title, title, publishDate: 'x', pills: [], pinned: false, ...(description ? { description } : {}) });
describe('searchItems', () => {
  const pool = [it0('Best beaches in Portugal'), it0('Mountain hikes', 'Beaches nearby too'), it0('Tokyo food')];
  it('every term must match title or description, case-insensitive', () => {
    expect(searchItems(pool, 'BEACHES', 10).map((i) => i.title)).toEqual(['Best beaches in Portugal', 'Mountain hikes']);
    expect(searchItems(pool, 'beaches portugal', 10)).toHaveLength(1);
  });
  it('blank query → no results; limit applies', () => {
    expect(searchItems(pool, '   ', 10)).toEqual([]);
    expect(searchItems(pool, 'o', 1)).toHaveLength(1);
  });
});
