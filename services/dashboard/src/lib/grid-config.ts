import type { GridCardFields, GridFields } from "@/types/grid";

/**
 * True when a site's config is a Grid site (network card feed), never a Modern
 * (magazine-layout) site. The switch is `theme.template === "grid"` — NEVER
 * `theme.base` (that field holds colour-preset ids like `classic`/`custom`).
 * Accepts a loosely-typed config object since callers read it from git/Mongo
 * without a shared SiteConfig type.
 */
export function isGridSiteConfig(config: Record<string, unknown> | null | undefined): boolean {
  const theme = config?.theme as Record<string, unknown> | undefined;
  return theme?.template === "grid";
}

/** Grid fields accepted by /api/sites/save `configUpdates`. */
export interface GridConfigUpdates {
  theme_template?: "modern" | "grid";
  theme_card?: GridCardFields;
  grid?: GridFields;
}

/** Applies Grid updates to a site.yaml object in place (same mutation style as the save route). */
export function applyGridConfigUpdates(existing: Record<string, unknown>, updates: GridConfigUpdates): void {
  if (updates.theme_template === undefined && updates.theme_card === undefined && updates.grid === undefined) return;
  const theme = (existing.theme ?? {}) as Record<string, unknown>;
  if (updates.theme_template === "grid") theme.template = "grid";
  if (updates.theme_template === "modern") delete theme.template;
  if (updates.theme_card !== undefined) theme.card = updates.theme_card;
  existing.theme = theme;
  if (updates.grid !== undefined) existing.grid = updates.grid;
}

/**
 * Category label for every Grid site. A Grid site never feeds other Grids, so its
 * category is display-only; its real categories are the verticals its topic pills use.
 */
export const MULTI_CATEGORY = "Multi-category";

/**
 * Verticals a Grid site's topic pills draw from, de-duplicated case-insensitively
 * in pill order. Empty for a Modern site or a Grid site with no vertical pills.
 */
export function gridCategoryChips(config: Record<string, unknown> | null | undefined): string[] {
  if (!isGridSiteConfig(config)) return [];
  const topics = (config?.grid as { topics?: unknown } | undefined)?.topics;
  if (!Array.isArray(topics)) return [];
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const topic of topics) {
    const verticals = (topic as { verticals?: unknown } | null)?.verticals;
    if (!Array.isArray(verticals)) continue;
    for (const v of verticals) {
      if (typeof v !== "string" || !v.trim()) continue;
      const key = v.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push(v.trim());
    }
  }
  return chips;
}
