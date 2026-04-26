import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

/**
 * Per-site asset serving route.
 *
 * URL shape: `/<siteId>/assets/<path>`
 * R2 key:    `<siteId>/assets/<path>`
 *
 * The path is 1:1 between URL and R2 key — frontmatter / theme URLs
 * (e.g. `featuredImage: /coolnews-atl/assets/images/foo.png`) work
 * without any URL rewriting in the Worker.
 *
 * Asset uploads happen at sync-kv time (see scripts/seed-kv.ts +
 * .github/workflows/sync-kv.yml). This route is read-only.
 *
 * Cache headers: 24h browser cache + 24h edge cache + 24h SWR.
 * Editorial flow can swap an image with the same filename and see
 * the change globally within ~24h naturally, or instantly via a
 * targeted purge (see docs/runbooks/phase-7-cache-strategy.md).
 *
 * Bypasses middleware site resolution: the siteId is in the URL
 * itself, so we don't need to look up `site:<hostname>` to serve
 * an asset. See middleware.ts where the path pattern is gated.
 */
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const siteId = params.siteId;
  const path = params.path;
  if (!siteId || !path) {
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  // Defensive guard against `..`/absolute keys leaking through. The
  // Astro router already prevents path traversal, but pinning it here
  // makes the contract explicit.
  if (path.includes('..') || path.startsWith('/')) {
    return new Response('Bad request', {
      status: 400,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  if (!env.ASSET_BUCKET) {
    return new Response('ASSET_BUCKET binding not configured', {
      status: 500,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  const key = `${siteId}/assets/${path}`;
  const obj = await env.ASSET_BUCKET.get(key);
  if (!obj) {
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'private, no-store' },
    });
  }

  const headers = new Headers();
  // Copy R2 metadata (content-type, etag, etc.) onto the response.
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Long-ish cache. Editorial-friendly knobs:
  //   - max-age 24h: browsers re-validate after a day
  //   - s-maxage 24h: edge re-fetches from origin after a day
  //   - SWR 24h: serve stale while revalidating in the background
  headers.set('cache-control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400');
  return new Response(obj.body, { headers });
};
