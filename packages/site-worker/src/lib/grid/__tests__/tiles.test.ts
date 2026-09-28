import { describe, expect, it } from 'vitest';
import type { GridPoolItem } from '@atomic-platform/shared-types';
import { buildTiles } from '../tiles';

const items = (n: number): GridPoolItem[] => Array.from({ length: n }, (_, i) => ({
  site: 's', slug: `a${i}`, title: 't', publishDate: '2026-01-01', pills: [], pinned: false,
}));
const shape = (tiles: ReturnType<typeof buildTiles>): string => tiles.map((t) => (t.kind === 'ad' ? 'A' : 'S')).join('');

describe('buildTiles', () => {
  it('every=3 → story, story, ad (dazzr cadence)', () => {
    expect(shape(buildTiles(items(4), 0, 3))).toBe('SSASSA');
    expect(shape(buildTiles(items(6), 0, 3))).toBe('SSASSASSA');
  });
  it('cadence continues across pages via startIndex', () => {
    expect(shape(buildTiles(items(3), 1, 3))).toBe('SASSA');
  });
  it('every=0 → no ads', () => {
    expect(shape(buildTiles(items(4), 0, 0))).toBe('SSSS');
  });
  it('ad indexes are global and increasing', () => {
    const tiles = buildTiles(items(4), 4, 3);
    expect(tiles.filter((t) => t.kind === 'ad').map((t) => (t.kind === 'ad' ? t.adIndex : -1))).toEqual([3, 4]);
  });
});
