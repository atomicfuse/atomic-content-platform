import type { APIRoute } from 'astro';

/**
 * Serve a permissive robots.txt for each site.
 *
 * Allows all crawlers (including facebookexternalhit for Meta domain
 * verification and link previews). Points to the per-site sitemap.
 */
export const GET: APIRoute = (context) => {
  const site = context.locals.site;
  const hostname = site?.hostname ?? context.url.hostname;

  const lines = [
    'User-agent: *',
    'Allow: /',
    '',
  ];

  if (hostname) {
    lines.push(`Sitemap: https://${hostname}/sitemap-index.xml`);
  }

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
};
