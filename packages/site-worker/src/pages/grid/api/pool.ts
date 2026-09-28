import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { GridSummaryRecord } from '@atomic-platform/shared-types';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, kvReader, loadGridPool, NO_CACHE, toPoolResponse } from '../../../lib/grid/load';
import { lookupSummaryStatuses } from '../../../lib/grid/summaries';

export const prerender = false;

/** JSON pool for the dashboard Stories tab and the content-pipeline (spec: /api/pool). */
export const GET: APIRoute = async (ctx) => {
  const g = getGridContext(ctx);
  if (!g) return notFound();
  const now = new Date();
  const data = await loadGridPool(kvReader(env.CONFIG_KV), g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
  const body = toPoolResponse(data, g.siteId, g.grid, now);
  if (ctx.url.searchParams.get('summaries') === '1') {
    body.items = await lookupSummaryStatuses(body.items, (key) => env.CONFIG_KV.get<GridSummaryRecord>(key, 'json'));
  }
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
};
