import type { DashboardSiteEntry } from "@/types/dashboard";

/**
 * Single source of truth for Sites-table sorting. `SitesTable` keeps one
 * `SiteSort | null` and calls `sortSites` from its `useMemo`, so every
 * sortable column shares the same click cycle and comparison rules.
 */

/** Sortable columns. Except "website", each key is also the column id in `SITE_COLUMNS`. */
export type SiteSortKey = "website" | "group" | "category" | "articles" | "lastArticles" | "created";
export type SortDirection = "asc" | "desc";

export interface SiteSort {
  key: SiteSortKey;
  dir: SortDirection;
}

/** Lazily-fetched data some sort keys read. */
export interface SiteSortContext {
  articleCounts: Record<string, number>;
  latestArticles: Record<string, string>;
  siteGroups: Record<string, string[]>;
  /** Group id → display name (falls back to the id). */
  groupNames: Record<string, string>;
}

/** Header click: asc → desc → off on the same column; a new column starts at asc. */
export function nextSort(current: SiteSort | null, key: SiteSortKey): SiteSort | null {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** "Last Articles" values may be hour-truncated ("2026-10-01T10"); complete them before parsing. */
function latestArticleTime(raw: string | undefined): number {
  if (!raw) return 0;
  return new Date(raw.length <= 13 ? `${raw}:00:00Z` : raw).getTime();
}

function dateTime(raw: string | undefined | null): number {
  return raw ? new Date(raw).getTime() : 0;
}

/** Text shown in a site's cell for a text-sorted column ("" = empty cell). */
function sortText(site: DashboardSiteEntry, key: "website" | "group" | "category", ctx: SiteSortContext): string {
  switch (key) {
    case "website":
      return site.custom_domain ?? site.domain;
    case "group":
      return (ctx.siteGroups[site.domain] ?? []).map((id) => ctx.groupNames[id] ?? id).join(", ");
    case "category":
      return (site.vertical ?? "").trim();
  }
}

/** Case-insensitive text compare; empty values sort last in both directions. */
function compareText(a: string, b: string, dir: SortDirection): number {
  if (!a || !b) return Number(!a) - Number(!b);
  const order = a.localeCompare(b, undefined, { sensitivity: "base" });
  return dir === "asc" ? order : -order;
}

function sortNumber(site: DashboardSiteEntry, key: "articles" | "lastArticles" | "created", ctx: SiteSortContext): number {
  switch (key) {
    case "articles":
      return ctx.articleCounts[site.domain] ?? 0;
    case "lastArticles":
      return latestArticleTime(ctx.latestArticles[site.domain]);
    case "created":
      return dateTime(site.created_at);
  }
}

/** Returns a sorted copy of `sites` (stable; input untouched). `null` keeps the input order. */
export function sortSites(
  sites: DashboardSiteEntry[],
  sort: SiteSort | null,
  ctx: SiteSortContext,
): DashboardSiteEntry[] {
  const sorted = [...sites];
  if (!sort) return sorted;
  const { key, dir } = sort;
  if (key === "website" || key === "group" || key === "category") {
    return sorted.sort((a, b) => compareText(sortText(a, key, ctx), sortText(b, key, ctx), dir));
  }
  return sorted.sort((a, b) => {
    const diff = sortNumber(a, key, ctx) - sortNumber(b, key, ctx);
    return dir === "asc" ? diff : -diff;
  });
}
