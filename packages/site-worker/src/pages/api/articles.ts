import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId, isPreviewMode } from '../../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { isVisibleArticle } from '../../utils/article-status';
import { selectFeatured } from '../../lib/featured';
import { sliceMoreOn } from '../../lib/articles-pagination';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const siteId = getSiteId(ctx);
  const preview = isPreviewMode(ctx);

  const all =
    (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
  const visible = all
    .filter((a) => preview || isVisibleArticle(a.status))
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  // Mirror the homepage's disjoint allocation so Load More never re-shows
  // articles already on the page (hero, what's new, or must reads).
  const heroArticles = config.layout.hero.enabled
    ? selectFeatured(visible, 'hero', config.layout.hero.count)
    : [];
  const heroSlugs = new Set(heroArticles.map((a) => a.slug));

  const whatsNewArticles = config.layout.whats_new.enabled
    ? visible.filter((a) => !heroSlugs.has(a.slug)).slice(0, config.layout.whats_new.count)
    : [];
  const consumed = new Set<string>([
    ...heroSlugs,
    ...whatsNewArticles.map((a) => a.slug),
  ]);

  // Same daily-stable seed as the homepage so both endpoints pick the
  // same must-reads — guaranteeing the "more on" pool here matches what
  // the homepage actually rendered.
  const randomSeed = `${siteId}:${new Date().toISOString().slice(0, 10)}`;

  const mustReadArticles = config.layout.must_reads.enabled
    ? selectFeatured(visible, 'must-read', config.layout.must_reads.count, consumed, 'random', randomSeed)
    : [];
  for (const a of mustReadArticles) consumed.add(a.slug);

  const moreOnPool = visible.filter((a) => !consumed.has(a.slug));
  const slice = sliceMoreOn(
    moreOnPool,
    page,
    config.layout.more_on.page_size,
    config.layout.load_more.page_size,
  );

  const html = renderFeedCardsHtml(slice);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
