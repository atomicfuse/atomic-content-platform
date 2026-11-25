import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCanonicalDomain, getConfig, getSiteId } from '../lib/config';
import { articleIndexKey, sharedPageKey, type ArticleIndexEntry } from '../lib/kv-schema';
import { isGridConfig } from '../lib/grid/context';
import { normalizeGridConfig } from '../lib/grid/normalize';
import { buildSitemapUrls, renderUrlset } from '../lib/sitemap';

export const prerender = false;

/** Same set the [slug] routes serve (modern + Grid). */
const SHARED_PAGES = ['about', 'contact', 'privacy', 'terms', 'dmca', 'amazon'] as const;

/**
 * Per-site sitemap. Lists only URLs that resolve: shared pages are included only
 * when seeded in KV. Edge-cached by middleware (s-maxage=600).
 */
export const GET: APIRoute = async (context) => {
  const config = getConfig(context);
  const siteId = getSiteId(context);
  const grid = isGridConfig(config);

  const [sharedPages, articles] = await Promise.all([
    existingSharedPages(siteId),
    grid
      ? Promise.resolve<ArticleIndexEntry[]>([])
      : env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json').then((a) => a ?? []),
  ]);

  const urls = buildSitemapUrls({
    host: getCanonicalDomain(context),
    template: grid ? 'grid' : 'modern',
    sharedPages,
    categoriesEnabled: config.categories?.enabled ?? false,
    categoryTopics: config.brief?.topics ?? [],
    gridTopicSlugs: grid ? normalizeGridConfig(config.grid).topics.map((t) => t.slug) : [],
    articles,
  });

  return new Response(renderUrlset(urls), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};

async function existingSharedPages(siteId: string): Promise<string[]> {
  const found = await Promise.all(
    SHARED_PAGES.map(async (name) => ((await env.CONFIG_KV.get(sharedPageKey(siteId, name))) ? name : null)),
  );
  return found.filter((name): name is (typeof SHARED_PAGES)[number] => name !== null);
}
