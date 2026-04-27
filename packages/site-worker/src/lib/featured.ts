import type { ArticleIndexEntry } from './kv-schema';

export type FeaturedSlot = 'hero' | 'must-read';

/**
 * Pick `count` articles for a featured slot. Articles tagged with the slot
 * come first (input order = sorted-by-date order from the caller). Remaining
 * slots fall back to the latest non-featured articles, skipping any slugs
 * already exhausted via `exclude`.
 */
export function selectFeatured(
  articles: ArticleIndexEntry[],
  slot: FeaturedSlot,
  count: number,
  exclude: Set<string> = new Set(),
): ArticleIndexEntry[] {
  const out: ArticleIndexEntry[] = [];
  const used = new Set(exclude);

  for (const a of articles) {
    if (out.length >= count) break;
    if (used.has(a.slug)) continue;
    if (a.featured?.includes(slot)) {
      out.push(a);
      used.add(a.slug);
    }
  }

  for (const a of articles) {
    if (out.length >= count) break;
    if (used.has(a.slug)) continue;
    out.push(a);
    used.add(a.slug);
  }

  return out;
}
