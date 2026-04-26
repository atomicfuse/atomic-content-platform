import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { siteLookupKey, siteConfigKey, type SiteLookup } from './lib/kv-schema';

/**
 * Multi-tenant site resolution.
 *
 * For every request:
 *   1. Normalise the hostname from `context.url.hostname`.
 *   2. Look up `site:<hostname>` in CONFIG_KV → { siteId }.
 *   3. Look up `site-config:<siteId>` in CONFIG_KV → ResolvedConfig.
 *   4. Attach `{ siteId, hostname, config }` to `Astro.locals.site`.
 *
 * Fails closed: if either lookup is missing, returns 404. Do NOT fall
 * back to a "default" site — that risks serving the wrong content on a
 * new hostname that hasn't been seeded yet.
 *
 * After the route handler returns, applies cache headers per route
 * class (see `applyCacheHeaders` below). The decision matrix:
 *   - /_ping                       no-store (health check)
 *   - /_server-islands/*           private, no-store (per-request render)
 *   - /<siteId>/assets/*           handled by ASSETS binding (long cache)
 *   - /                            edge: 60s, browser: 30s, SWR 600s
 *   - /<slug>                      edge: 300s, browser: 60s, SWR 600s
 *   - /sitemap.xml, /ads.txt       edge: 600s, browser: 60s
 *   - default                      no explicit cache (CF default)
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // Health check bypass — useful while seeding KV.
  if (context.url.pathname === '/_ping') {
    return new Response('ok', {
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'cache-control': 'no-store',
      },
    });
  }

  if (!env.CONFIG_KV) {
    return new Response(
      'CONFIG_KV binding not configured. Run `wrangler dev` or bind a namespace.',
      { status: 500 },
    );
  }

  const hostname = normaliseHostname(context.url.hostname);
  const lookup = await env.CONFIG_KV.get<SiteLookup>(siteLookupKey(hostname), 'json');

  if (!lookup) {
    return new Response(
      `No site registered for hostname "${hostname}". Seed the KV namespace first.`,
      {
        status: 404,
        headers: { 'cache-control': 'private, no-store' },
      },
    );
  }

  const config = await env.CONFIG_KV.get<ResolvedConfig>(siteConfigKey(lookup.siteId), 'json');
  if (!config) {
    return new Response(
      `Hostname "${hostname}" → siteId "${lookup.siteId}" has no config in KV.`,
      {
        status: 500,
        headers: { 'cache-control': 'private, no-store' },
      },
    );
  }

  context.locals.site = {
    siteId: lookup.siteId,
    hostname,
    config,
  };

  const response = await next();
  applyCacheHeaders(context.url.pathname, response);
  return response;
});

/**
 * Cache classification. The full strategy + reasoning lives in
 * `docs/runbooks/phase-7-cache-strategy.md`. Edits here MUST update that
 * runbook so the two stay in sync.
 *
 * Headers are only added if the route handler hasn't already set
 * Cache-Control — we never override an explicit decision a page made
 * for itself.
 */
function applyCacheHeaders(pathname: string, response: Response): void {
  if (response.headers.has('cache-control')) return;

  // Server Islands — Astro fetches these per request. Caching them would
  // freeze the data they render (ad placements, tracking pixels, etc.)
  // for the cache TTL, defeating the migration's "config change = next
  // request" promise.
  if (pathname.startsWith('/_server-islands/')) {
    response.headers.set('cache-control', 'private, no-store');
    return;
  }

  // ads.txt and sitemap.xml change rarely; can be edge-cached longer.
  if (pathname === '/ads.txt' || pathname === '/sitemap.xml' || pathname === '/sitemap-index.xml') {
    response.headers.set('cache-control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
    return;
  }

  // Homepage — aggregates fresh content. Shorter TTL because new
  // articles should appear quickly.
  if (pathname === '/') {
    response.headers.set('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600');
    return;
  }

  // Article + shared-page slugs (/foo, /about, /privacy, ...). Article
  // bodies rarely change after publish, so longer edge cache.
  // Pattern: a single segment of letters/digits/hyphens.
  if (/^\/[a-z0-9][a-z0-9-]*$/i.test(pathname)) {
    response.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return;
  }

  // Everything else (assets via ASSETS binding, error responses, etc.)
  // gets no explicit Cache-Control; CF defaults apply.
}

/** Strip the port and lowercase — KV keys are case-sensitive. */
function normaliseHostname(raw: string): string {
  return raw.toLowerCase().split(':')[0] ?? raw.toLowerCase();
}
