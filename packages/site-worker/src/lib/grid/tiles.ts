import type { GridPoolItem } from '@atomic-platform/shared-types';

/** One grid cell. */
export type Tile = { kind: 'story'; item: GridPoolItem; index: number } | { kind: 'ad'; adIndex: number };

/**
 * Interleaves ads so every `every`-th tile is an ad: (every-1) stories, then 1 ad.
 * `startIndex` is the global index of slice[0], so page 2 continues page 1's count.
 */
export function buildTiles(slice: readonly GridPoolItem[], startIndex: number, every: number): Tile[] {
  const tiles: Tile[] = [];
  const run = every >= 2 ? every - 1 : 0;
  slice.forEach((item, i) => {
    const index = startIndex + i;
    tiles.push({ kind: 'story', item, index });
    if (run > 0 && (index + 1) % run === 0) tiles.push({ kind: 'ad', adIndex: (index + 1) / run });
  });
  return tiles;
}
