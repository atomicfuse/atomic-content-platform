import { isIncomplete } from "./record";
import type { AuthorListItem } from "./types";

export type LibraryFilter = "all" | "exclusive" | "unassigned" | "incomplete";
export type LibrarySort = "updated" | "name" | "sites";

const matches: Record<LibraryFilter, (a: AuthorListItem) => boolean> = {
  all: () => true,
  exclusive: (a) => a.exclusive_sites.length > 0,
  unassigned: (a) => a.sites.length === 0,
  incomplete: (a) => isIncomplete(a),
};

export function filterAuthors(items: AuthorListItem[], q: string, filter: LibraryFilter, sort: LibrarySort): AuthorListItem[] {
  const needle = q.trim().toLowerCase();
  const hit = (a: AuthorListItem): boolean =>
    !needle || [a.name, a.tagline, ...a.beats, ...a.sites.map((s) => s.site)].some((t) => t.toLowerCase().includes(needle));
  const out = items.filter((a) => matches[filter](a) && hit(a));
  const byName = (a: AuthorListItem, b: AuthorListItem): number => a.name.localeCompare(b.name);
  return out.sort(
    sort === "name" ? byName
      : sort === "sites" ? (a, b) => b.sites.length - a.sites.length || byName(a, b)
        : (a, b) => b.updated_at.localeCompare(a.updated_at) || byName(a, b),
  );
}

export function filterCounts(items: AuthorListItem[]): Record<LibraryFilter, number> {
  return {
    all: items.length,
    exclusive: items.filter(matches.exclusive).length,
    unassigned: items.filter(matches.unassigned).length,
    incomplete: items.filter(matches.incomplete).length,
  };
}
