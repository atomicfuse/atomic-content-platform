import type { GridCardFields, GridFields } from "@/types/grid";

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
