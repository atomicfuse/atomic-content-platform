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

export function isPreviewMode(astro: APIContext | { locals: App.Locals }): boolean {
  return astro.locals.site?.isPreview ?? false;
}

/**
 * Returns the best hostname for canonical URLs and og:url tags.
 *
 * Priority:
 *   1. config.domain — if it looks like a real domain (contains a dot).
 *   2. The actual request hostname from middleware (e.g. financenewsbase.com).
 *
 * This handles the common case where site.yaml has `domain: financenewsbase`
 * (the siteId/folder name) instead of the full `financenewsbase.com`.
 */
export function getCanonicalDomain(astro: APIContext | { locals: App.Locals }): string {
  const site = astro.locals.site;
  if (!site) {
    throw new Error('[site-worker] Astro.locals.site is unset.');
  }
  const configDomain = site.config.domain;
  if (configDomain && configDomain.includes('.')) {
    return configDomain;
  }
  return site.hostname;
}
