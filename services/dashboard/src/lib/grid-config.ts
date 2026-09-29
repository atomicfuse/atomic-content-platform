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
