import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { AuthorProfile } from '@atomic-platform/shared-types';
import { getConfig, getSiteId, isPreviewMode } from '../../lib/config';
import { articleIndexKey, authorKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { articlesByAuthor, authorPageSlice, isAssignedAuthor } from '../../lib/authors';
import { renderAuthorCardsHtml } from '../../themes/modern/components/_render-author-cards';

export const prerender = false;

/** Next page of an author's articles as author-card HTML (Load More on /author/<id>). */
export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get('id') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const notFound = new Response('', { status: 404 });
  if (!isAssignedAuthor(config.authors ?? [], id)) return notFound;
  const profile = await env.CONFIG_KV.get<AuthorProfile>(authorKey(id), 'json');
  if (!profile) return notFound;
  const index = (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(getSiteId(ctx)), 'json')) ?? [];
  const { items } = authorPageSlice(articlesByAuthor(index, profile, isPreviewMode(ctx), config.authors ?? []), page, config.categories.per_page);
  return new Response(renderAuthorCardsHtml(items), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
};
