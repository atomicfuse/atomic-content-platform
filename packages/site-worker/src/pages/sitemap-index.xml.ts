import type { APIRoute } from 'astro';
import { getCanonicalDomain } from '../lib/config';
import { renderSitemapIndex } from '../lib/sitemap';

export const prerender = false;

/** The sitemap robots.txt advertises; points at the single per-site /sitemap.xml. */
export const GET: APIRoute = (context) =>
  new Response(renderSitemapIndex(getCanonicalDomain(context)), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
