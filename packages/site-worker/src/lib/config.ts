import type { APIContext } from 'astro';
import type { ResolvedConfig, ResolvedLayoutConfig } from '@atomic-platform/shared-types';

/**
 * Runtime layout defaults — mirrors LAYOUT_DEFAULTS from shared-types.
 * Defined inline because shared-types emits CJS which Rollup/Vite
 * can't tree-shake as named ESM exports at build time.
 */
const LAYOUT_DEFAULTS: ResolvedLayoutConfig = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  whats_new: { enabled: true, count: 4 },
  more_on: { enabled: true, page_size: 8 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 4 },
};

/**
 * Returns the resolved config for the current request.
 * Populated by middleware.ts from KV. See src/middleware.ts.
 *
 * Applies runtime defaults for layout fields that may be absent in
 * KV configs seeded before newer layout sections (whats_new, more_on)
 * were added. This is a defense-in-depth measure — seed-kv.ts
 * populates all fields, but stale KV entries must not crash pages.
 */
export function getConfig(astro: APIContext | { locals: App.Locals }): ResolvedConfig {
  const site = astro.locals.site;
  if (!site) {
    throw new Error(
      '[site-worker] Astro.locals.site is unset. Did the request bypass middleware.ts?',
    );
  }
  const config = site.config;
  // Backfill any missing layout sections with LAYOUT_DEFAULTS so pages
  // never crash with "Cannot read properties of undefined".
  if (config.layout) {
    config.layout.hero ??= LAYOUT_DEFAULTS.hero;
    config.layout.must_reads ??= LAYOUT_DEFAULTS.must_reads;
    config.layout.whats_new ??= LAYOUT_DEFAULTS.whats_new;
    config.layout.more_on ??= LAYOUT_DEFAULTS.more_on;
    config.layout.sidebar_topics ??= LAYOUT_DEFAULTS.sidebar_topics;
    config.layout.load_more ??= LAYOUT_DEFAULTS.load_more;
  } else {
    (config as unknown as Record<string, unknown>).layout = { ...LAYOUT_DEFAULTS };
  }
  if (config.scripts) {
    (config.scripts as unknown as Record<string, unknown>).before_footer ??= [];
  }
  return config;
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

export function isStagingEnv(astro: APIContext | { locals: App.Locals }): boolean {
  return astro.locals.site?.isStaging ?? false;
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
