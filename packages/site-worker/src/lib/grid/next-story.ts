import type { GridPoolItem } from '@atomic-platform/shared-types';

/** "site/slug" — identifies a story across the next-story chain. */
export function storyKey(item: { site: string; slug: string }): string {
  return `${item.site}/${item.slug}`;
}

/** Items after `current` in `list` (the whole list when `current` isn't in it). */
function after(list: readonly GridPoolItem[], current: string): GridPoolItem[] {
  const i = list.findIndex((x) => storyKey(x) === current);
  return i < 0 ? [...list] : list.slice(i + 1);
}

/**
 * The story to append under `current` on a story page: the next one in the same pill (feed order),
 * then the next in All, then All from the top — skipping everything already shown. Null when none is left.
 */
export function nextStoryItem(
  items: readonly GridPoolItem[], current: { site: string; slug: string }, pill: string | null, seen: ReadonlySet<string>,
): GridPoolItem | null {
  const cur = storyKey(current);
  const inPill = pill ? items.filter((x) => x.pills.includes(pill)) : [];
  for (const candidate of [...after(inPill, cur), ...after(items, cur), ...items]) {
    const key = storyKey(candidate);
    if (key !== cur && !seen.has(key)) return candidate;
  }
  return null;
}
