import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId } from '../../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { isVisibleArticle } from '../../utils/article-status';
import { sliceForPage } from '../../lib/articles-pagination';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const siteId = getSiteId(ctx);
  const pageSize = config.layout.load_more.page_size;

  const all =
    (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
  const visible = all
    .filter((a) => isVisibleArticle(a.status))
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  const slice = sliceForPage(visible, page, pageSize);
  const html = renderFeedCardsHtml(slice);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
