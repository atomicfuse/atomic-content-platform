import type { GridCardConfig, GridConfig } from '@atomic-platform/shared-types';
import { normalizeGridCard, normalizeGridConfig } from '../../src/lib/grid/normalize';

const ARRAY_KEYS = new Set(['topics', 'include_sites', 'exclude_sites', 'pinned', 'blocked_sources']);

/**
 * Merges raw `grid` layers (org → groups → overrides → site).
 * Scalars: last defined value wins (`null` counts for max_age_days).
 * Arrays: last NON-EMPTY wins — unlike deepMerge, an empty array never wipes an inherited list.
 */
export function mergeGridLayers(layers: ReadonlyArray<GridConfig | undefined>): GridConfig {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      if (ARRAY_KEYS.has(key)) {
        if (Array.isArray(value) && value.length > 0) out[key] = value;
        continue;
      }
      if (value === null && key !== 'max_age_days') continue;
      out[key] = value;
    }
  }
  return out as GridConfig;
}

/**
 * Seed-time Grid step, called once at the end of resolveSiteConfig.
 * Non-Grid sites: removes `grid` and `theme.card` so their KV config is byte-identical to today.
 * Grid sites: replaces the deepMerge'd `grid` with Grid merge semantics + normalisation.
 */
export function applyGridResolution(
  config: Record<string, unknown>,
  layers: ReadonlyArray<Record<string, unknown>>,
): void {
  const theme = (config.theme ?? {}) as Record<string, unknown>;
  if (theme.template !== 'grid') {
    delete config.grid;
    delete theme.card;
    return;
  }
  config.grid = normalizeGridConfig(mergeGridLayers(layers.map((l) => l.grid as GridConfig | undefined)));
  theme.card = normalizeGridCard(theme.card as GridCardConfig | undefined);
  config.theme = theme;
}
