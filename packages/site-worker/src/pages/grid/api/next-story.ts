import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { ExternalStoryRecord, GridPoolItem, GridSummaryRecord } from '@atomic-platform/shared-types';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, kvReader, loadGridPool, NO_CACHE, type GridPoolData } from '../../../lib/grid/load';
import { nextStoryItem, storyKey } from '../../../lib/grid/next-story';
import { buildExternalStoryView, buildNetworkStoryView, renderNextStoryHtml, type StoryView } from '../../../lib/grid/story-view';
import { parseExternalSlug, resolveExternalRequest } from '../../../lib/grid/external';
import type { GridContext } from '../../../lib/grid/context';
import { AGGREGATOR_SOURCE_ID, articleKey, externalItemKey, gridSummaryKey, type ArticleRecord } from '../../../lib/kv-schema';
import type { AdPlacementLike } from '../../../lib/grid/render';

export const prerender = false;

const MAX_SEEN = 30;
const MAX_ATTEMPTS = 5;

async function viewFor(item: GridPoolItem, g: GridContext, data: GridPoolData, now: Date): Promise<StoryView | null> {
  const sites = new Map((data.directory?.sites ?? []).map((s) => [s.siteId, s]));
  const base = { grid: g.grid, canonicalHost: g.canonicalHost, sites, now, pills: item.pills };
  if (item.site === AGGREGATOR_SOURCE_ID) {
    const parsed = parseExternalSlug(item.slug);
    if (!parsed) return null;
    const record = await env.CONFIG_KV.get<ExternalStoryRecord>(externalItemKey(parsed.itemId), 'json');
    const resolved = resolveExternalRequest(item.slug, record, g.grid.blocked_categories, '', { blockedDomains: g.grid.blocked_domains, hidden: g.grid.hidden_stories });
    if (resolved.kind !== 'ok') return null;
    const summary = await env.CONFIG_KV.get<GridSummaryRecord>(gridSummaryKey(AGGREGATOR_SOURCE_ID, resolved.record.id), 'json');
    return buildExternalStoryView({ ...base, record: resolved.record, summary, ...(item.favicon ? { favicon: item.favicon } : {}) });
  }
  const source = data.resolved.sources.find((s) => s.siteId === item.site);
  if (!source) return null;
  const record = await env.CONFIG_KV.get<ArticleRecord>(articleKey(item.site, item.slug), 'json');
  if (!record || record.frontmatter.status !== 'published') return null;
  const summary = await env.CONFIG_KV.get<GridSummaryRecord>(gridSummaryKey(item.site, item.slug), 'json');
  return buildNetworkStoryView({ ...base, sourceSiteId: item.site, hostname: source.hostname, record, summary });
}

/**
 * Story pages' endless scroll: the story to append below `after` (same pill, then All), as HTML.
 * 204 when every story was shown. Query: after=<site/slug>, pill=<topic slug>, seen=<site/slug,...>, n=<position>.
 */
export const GET: APIRoute = async (ctx) => {
  const g = getGridContext(ctx);
  if (!g) return notFound();
  const q = ctx.url.searchParams;
  const after = q.get('after') ?? '';
  const slash = after.indexOf('/');
  if (slash <= 0) return notFound();
  const current = { site: after.slice(0, slash), slug: after.slice(slash + 1) };
  const pillParam = q.get('pill');
  const pill = pillParam && g.grid.topics.some((t) => t.slug === pillParam) ? pillParam : null;
  const seen = new Set((q.get('seen') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_SEEN));
  seen.add(after);
  const index = Math.min(Math.max(parseInt(q.get('n') ?? '2', 10) || 2, 2), 99);

  const now = new Date();
  const data = await loadGridPool(kvReader(env.CONFIG_KV), g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
  const placements = (g.config.ads_config?.ad_placements ?? []) as AdPlacementLike[];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const item = nextStoryItem(data.pool.items, current, pill, seen);
    if (!item) break;
    const view = await viewFor(item, g, data, now);
    if (!view) { seen.add(storyKey(item)); continue; } // unreadable story — skip it
    return new Response(renderNextStoryHtml(view, { placements, staging: g.staging, index }), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'public, s-maxage=60' } });
};
