import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId, isPreviewMode } from '../../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { isVisibleArticle } from '../../utils/article-status';

export const prerender = false;

const MAX_RESULTS = 20;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  if (!query) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const siteId = getSiteId(ctx);
  const preview = isPreviewMode(ctx);
  const all =
    (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];

  const terms = query.split(/\s+/).filter(Boolean);

  const matches = all
    .filter((a) => preview || isVisibleArticle(a.status))
    .filter((a) => {
      const title = a.title.toLowerCase();
      const desc = (a.description ?? '').toLowerCase();
      return terms.every((t) => title.includes(t) || desc.includes(t));
    })
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime())
    .slice(0, MAX_RESULTS);

  const results = matches.map((a) => ({
    slug: a.slug,
    title: a.title,
    description: a.description ?? '',
    publishDate: a.publishDate,
    featuredImage: a.featuredImage ?? '',
  }));

  return new Response(JSON.stringify({ results }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
