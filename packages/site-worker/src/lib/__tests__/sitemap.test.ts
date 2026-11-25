import { describe, expect, it } from 'vitest';
import type { ArticleIndexEntry } from '../kv-schema';
import {
  buildSitemapUrls,
  renderSitemapIndex,
  renderUrlset,
  SITEMAP_MAX_URLS,
  type SitemapInput,
} from '../sitemap';

function article(slug: string, publishDate: string, status: ArticleIndexEntry['status'] = 'published'): ArticleIndexEntry {
  return { slug, title: slug, author: 'A', publishDate, tags: [], type: 'standard', status };
}

function input(overrides: Partial<SitemapInput> = {}): SitemapInput {
  return {
    host: 'example.com',
    template: 'modern',
    sharedPages: ['about', 'privacy'],
    categoriesEnabled: true,
    categoryTopics: ['Home Decor', 'DIY'],
    gridTopicSlugs: [],
    articles: [],
    ...overrides,
  };
}

const locs = (i: SitemapInput): string[] => buildSitemapUrls(i).map((u) => u.loc);

describe('buildSitemapUrls — modern sites', () => {
  it('lists homepage, shared pages, categories, then visible articles newest first', () => {
    const urls = buildSitemapUrls(input({
      articles: [
        article('old-post', '2026-01-01T10:00:00.000Z'),
        article('draft-post', '2026-03-01T10:00:00.000Z', 'draft'),
        article('new-post', '2026-02-01T10:00:00.000Z'),
      ],
    }));
    expect(urls).toEqual([
      { loc: 'https://example.com/' },
      { loc: 'https://example.com/about' },
      { loc: 'https://example.com/privacy' },
      { loc: 'https://example.com/category/home-decor' },
      { loc: 'https://example.com/category/diy' },
      { loc: 'https://example.com/new-post', lastmod: '2026-02-01' },
      { loc: 'https://example.com/old-post', lastmod: '2026-01-01' },
    ]);
  });

  it('omits category pages when categories are disabled', () => {
    expect(locs(input({ categoriesEnabled: false })).some((l) => l.includes('/category/'))).toBe(false);
  });

  it('dedupes topics that map to the same category slug', () => {
    const cats = locs(input({ categoryTopics: ['DIY', 'diy', ' '] })).filter((l) => l.includes('/category/'));
    expect(cats).toEqual(['https://example.com/category/diy']);
  });

  it('lists an article with an unparseable date without lastmod', () => {
    const urls = buildSitemapUrls(input({ articles: [article('no-date', 'not a date')] }));
    expect(urls.at(-1)).toEqual({ loc: 'https://example.com/no-date' });
  });

  it('caps the list at the sitemap protocol limit, keeping the newest articles', () => {
    const many = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) =>
      article(`post-${i}`, new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString()),
    );
    const urls = buildSitemapUrls(input({ articles: many }));
    expect(urls).toHaveLength(SITEMAP_MAX_URLS);
    expect(urls.some((u) => u.loc.endsWith(`/post-${SITEMAP_MAX_URLS + 9}`))).toBe(true);
    expect(urls.some((u) => u.loc.endsWith('/post-0'))).toBe(false);
  });
});

describe('buildSitemapUrls — Grid sites', () => {
  it('lists homepage, shared pages and topic pages, never articles or stories', () => {
    const urls = locs(input({
      template: 'grid',
      gridTopicSlugs: ['trending-news', 'health'],
      articles: [article('own-post', '2026-02-01T10:00:00.000Z')],
    }));
    expect(urls).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/privacy',
      'https://example.com/topic/trending-news',
      'https://example.com/topic/health',
    ]);
  });
});

describe('renderUrlset', () => {
  it('renders a well-formed, escaped urlset', () => {
    const xml = renderUrlset([
      { loc: 'https://example.com/' },
      { loc: 'https://example.com/a&b<c>', lastmod: '2026-02-01' },
    ]);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '<url><loc>https://example.com/</loc></url>\n' +
      '<url><loc>https://example.com/a&amp;b&lt;c&gt;</loc><lastmod>2026-02-01</lastmod></url>\n' +
      '</urlset>\n',
    );
  });
});

describe('renderSitemapIndex', () => {
  it('points at the site sitemap', () => {
    expect(renderSitemapIndex('example.com')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '<sitemap><loc>https://example.com/sitemap.xml</loc></sitemap>\n' +
      '</sitemapindex>\n',
    );
  });
});
