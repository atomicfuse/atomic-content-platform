import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { siteLookupKey, siteConfigKey, type SiteLookup } from './lib/kv-schema';
import { resolvePreview, generatePreviewScript } from './lib/preview-override';

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

  // Per-site asset routes (`/<siteId>/assets/<path>`) bypass the KV site
  // lookup — the asset endpoint reads siteId straight from the URL and
  // serves from R2. Site resolution would just be wasted work + an
  // unnecessary KV read on every image request.
  if (/^\/[a-z0-9][a-z0-9-]*\/assets\//i.test(context.url.pathname)) {
    const response = await next();
    // On staging (workers.dev / localhost), use short cache so logo /
    // favicon updates appear quickly after save + seed-kv. Production
    // custom domains keep the long 24h cache set by the asset route.
    const isStaging = hostname.endsWith('.workers.dev') || hostname === 'localhost';
    if (isStaging && response.status < 400) {
      response.headers.set('cache-control', 'public, max-age=10, s-maxage=30, stale-while-revalidate=60');
    }
    return response;
  }

  // Preview override: on workers.dev / localhost ONLY, `?_atl_site=<id>`
  // forces a specific siteId. Production custom domains never honour
  // this — the hostname → site mapping in KV is authoritative there.
  //
  // Preview context is propagated per-tab via an inline script that
  // rewrites internal links to carry `_atl_site`, not via cookies
  // (cookies are domain-wide and leak across tabs).
  const preview = resolvePreview({
    hostname,
    searchParams: context.url.searchParams,
  });

  let siteId: string;
  if (preview.siteIdOverride) {
    siteId = preview.siteIdOverride;
  } else {
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
    siteId = lookup.siteId;
  }

  const config = await env.CONFIG_KV.get<ResolvedConfig>(siteConfigKey(siteId), 'json');
  if (!config) {
    return new Response(
      `siteId "${siteId}" has no config in KV.`,
      {
        status: 500,
        headers: { 'cache-control': 'private, no-store' },
      },
    );
  }

  context.locals.site = { siteId, hostname, config };

  const response = await next();
  applyCacheHeaders(context.url.pathname, response);

  // Inject the preview link-rewriting script into HTML responses so
  // every internal `<a>` carries `_atl_site` — keeps context per-tab.
  let finalResponse = response;
  if (preview.siteIdOverride) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const script = generatePreviewScript(preview.siteIdOverride);
      const modifiedHtml = html.replace('</head>', `${script}\n</head>`);
      finalResponse = new Response(modifiedHtml, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    }
    finalResponse.headers.set('cache-control', 'private, no-store');
  }

  // Emit the legacy cookie deletion if resolvePreview asked for it
  // (cleans up stale `atl_preview_site` cookies from the old mechanism).
  if (preview.setCookie) {
    finalResponse.headers.append('set-cookie', preview.setCookie);
    if (!preview.siteIdOverride) {
      finalResponse.headers.set('cache-control', 'private, no-store');
    }
  }

  return finalResponse;
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

  // Never cache error responses. A cached 404 sticks for the full s-maxage
  // even after the underlying KV is fixed — exactly what we don't want
  // for newly-published articles or hostname-resolution edits.
  if (response.status >= 400) {
    response.headers.set('cache-control', 'private, no-store');
    return;
  }

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
