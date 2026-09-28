import type { GridPoolItem } from '@atomic-platform/shared-types';

/** Title/description search over the "All" pool (same matching rule as the modern /api/search). */
export function searchItems(items: readonly GridPoolItem[], query: string, limit: number): GridPoolItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return items
    .filter((i) => {
      const hay = `${i.title} ${i.description ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}
