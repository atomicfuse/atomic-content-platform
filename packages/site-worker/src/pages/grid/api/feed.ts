import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, kvReader, loadGridPool, NO_CACHE } from '../../../lib/grid/load';
import { renderListing } from '../../../lib/grid/listing';

export const prerender = false;

/** Infinite-scroll batches (page ≥ 2). Unknown topic → 404. */
export const GET: APIRoute = async (ctx) => {
  const g = getGridContext(ctx);
  if (!g) return notFound();
  const topicParam = ctx.url.searchParams.get('topic');
  const topic = topicParam ? g.grid.topics.find((t) => t.slug === topicParam)?.slug ?? null : null;
  if (topicParam && !topic) return notFound();
  const page = Math.max(2, parseInt(ctx.url.searchParams.get('page') ?? '2', 10) || 2);
  const now = new Date();
  const data = await loadGridPool(kvReader(env.CONFIG_KV), g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
  const r = renderListing(data, g, topic, page, now, topic ? 'category' : 'homepage');
  return new Response(r.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-grid-has-more': String(r.hasMore),
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
