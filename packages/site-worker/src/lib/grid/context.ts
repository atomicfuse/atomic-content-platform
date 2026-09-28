import type { APIContext, AstroGlobal } from 'astro';
import type { ResolvedConfig, ResolvedGridCardConfig, ResolvedGridConfig } from '@atomic-platform/shared-types';
import { getCanonicalDomain, getConfig, getSiteId, isStagingEnv } from '../config';
import { normalizeGridCard, normalizeGridConfig } from './normalize';

/** Everything a Grid page needs, with runtime defaults applied. */
export interface GridContext {
  config: ResolvedConfig;
  grid: ResolvedGridConfig;
  card: ResolvedGridCardConfig;
  siteId: string;
  staging: boolean;
  canonicalHost: string;
}

/** True when this site renders the Grid template. */
export function isGridConfig(config: ResolvedConfig): boolean {
  return config.theme?.template === 'grid';
}

/**
 * Grid pages call this first; null means "not a Grid site" → 404.
 * normalizeGridConfig/normalizeGridCard act as the runtime `??=` defaults required by
 * CLAUDE.md "KV Schema Evolution" step 1.
 */
export function getGridContext(astro: APIContext | AstroGlobal): GridContext | null {
  const config = getConfig(astro);
  if (!isGridConfig(config)) return null;
  return {
    config,
    grid: normalizeGridConfig(config.grid),
    card: normalizeGridCard(config.theme.card),
    siteId: getSiteId(astro),
    staging: isStagingEnv(astro),
    canonicalHost: getCanonicalDomain(astro),
  };
}

/** Same 404 shape as the existing routes. */
export function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
