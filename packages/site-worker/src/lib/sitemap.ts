import type { ArticleIndexEntry } from './kv-schema';
import { isVisibleArticle } from '../utils/article-status';
import { topicSlug } from './authors';

/** sitemaps.org protocol limit for URLs in one sitemap file. */
export const SITEMAP_MAX_URLS = 50_000;

/** One `<url>` entry. `lastmod` is a W3C date (YYYY-MM-DD). */
export interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

/** Everything needed to list one site's URLs (already read from config + KV by the route). */
export interface SitemapInput {
  /** Canonical hostname, no scheme. */
  host: string;
  template: 'modern' | 'grid';
  /** Shared pages that exist in KV for this site (about, privacy, ...). */
  sharedPages: string[];
  /** Modern only: `categories.enabled`. */
  categoriesEnabled: boolean;
  /** Modern only: `brief.topics` — each has a /category/<slug> page. */
  categoryTopics: string[];
  /** Grid only: normalized topic slugs — each has a /topic/<slug> page. */
  gridTopicSlugs: string[];
  /** Modern only: the site's article index (all statuses; filtered here). */
  articles: ArticleIndexEntry[];
}

/**
 * Lists a site's indexable URLs: homepage, shared pages, category/topic pages and,
 * for modern sites, visible articles (newest first).
 * Note: Grid `/story/...` pages are deliberately excluded — they summarize other
 * sites' and aggregator content (decision 2026-11-25).
 */
export function buildSitemapUrls(input: SitemapInput): SitemapUrl[] {
  const base = `https://${input.host}`;
  const urls: SitemapUrl[] = [{ loc: `${base}/` }];

  for (const page of input.sharedPages) urls.push({ loc: `${base}/${page}` });

  if (input.template === 'grid') {
    for (const slug of unique(input.gridTopicSlugs)) urls.push({ loc: `${base}/topic/${slug}` });
    return urls.slice(0, SITEMAP_MAX_URLS);
  }

  if (input.categoriesEnabled) {
    const slugs = input.categoryTopics.filter((t) => t.trim() !== '').map(topicSlug);
    for (const slug of unique(slugs)) urls.push({ loc: `${base}/category/${slug}` });
  }

  const articles = input.articles
    .filter((a) => isVisibleArticle(a.status))
    .sort((a, b) => timeOf(b.publishDate) - timeOf(a.publishDate));
  for (const a of articles) {
    const lastmod = toW3cDate(a.publishDate);
    urls.push(lastmod ? { loc: `${base}/${a.slug}`, lastmod } : { loc: `${base}/${a.slug}` });
  }

  return urls.slice(0, SITEMAP_MAX_URLS);
}

/** Renders a sitemaps.org `<urlset>` document. */
export function renderUrlset(urls: SitemapUrl[]): string {
  const rows = urls.map((u) =>
    `<url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    '',
  ].join('\n');
}

/** Renders the sitemap index robots.txt advertises; it points at the single /sitemap.xml. */
export function renderSitemapIndex(host: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<sitemap><loc>${escapeXml(`https://${host}/sitemap.xml`)}</loc></sitemap>`,
    '</sitemapindex>',
    '',
  ].join('\n');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Epoch ms, with unparseable dates sorted last. */
function timeOf(date: string): number {
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function toW3cDate(date: string): string | undefined {
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
