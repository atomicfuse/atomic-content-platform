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
 * `/_ping` bypasses site resolution so health checks stay reachable
 * even when KV is unseeded.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // Health check bypass — useful while seeding KV.
  if (context.url.pathname === '/_ping') {
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
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
      { status: 404 },
    );
  }

  const config = await env.CONFIG_KV.get<ResolvedConfig>(siteConfigKey(lookup.siteId), 'json');
  if (!config) {
    return new Response(
      `Hostname "${hostname}" → siteId "${lookup.siteId}" has no config in KV.`,
      { status: 500 },
    );
  }

  context.locals.site = {
    siteId: lookup.siteId,
    hostname,
    config,
  };

  return next();
});

/** Strip the port and lowercase — KV keys are case-sensitive. */
function normaliseHostname(raw: string): string {
  return raw.toLowerCase().split(':')[0] ?? raw.toLowerCase();
}
