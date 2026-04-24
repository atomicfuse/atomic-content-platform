import type { APIContext } from 'astro';
import type { ResolvedConfig } from '@atomic-platform/shared-types';

/**
 * Returns the resolved config for the current request.
 * Populated by middleware.ts from KV. See src/middleware.ts.
 */
export function getConfig(astro: APIContext | { locals: App.Locals }): ResolvedConfig {
  const site = astro.locals.site;
  if (!site) {
    throw new Error(
      '[site-worker] Astro.locals.site is unset. Did the request bypass middleware.ts?',
    );
  }
  return site.config;
}

export function getSiteId(astro: APIContext | { locals: App.Locals }): string {
  const site = astro.locals.site;
  if (!site) {
    throw new Error('[site-worker] Astro.locals.site is unset.');
  }
  return site.siteId;
}
