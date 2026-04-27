/**
 * Comprehensive test suite for category pages, pagination, ad placement,
 * theme/color resolution, featured selection, and load-more behaviour.
 *
 * Tests the pure-function layers that the /category/[topic] route,
 * homepage, and article pages depend on — exercising the same code
 * paths without needing an Astro runtime.
 */
import { describe, expect, it } from 'vitest';
import { sliceForPage } from '../articles-pagination';
import { selectFeatured } from '../featured';
import { injectInlineAds } from '../inline-ads';
import {
  siteLookupKey,
  siteConfigKey,
  articleIndexKey,
  articleKey,
  type ArticleIndexEntry,
} from '../kv-schema';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';
import { resolveLayout } from '../../../scripts/lib/resolve-layout';
import { parseFeatured } from '../../../scripts/lib/parse-featured';
import {
  deepMerge,
  rewriteAssetUrls,
  rewriteFrontmatterUrl,
} from '../../../scripts/lib/resolve';
import { LAYOUT_DEFAULTS } from '@atomic-platform/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory for ArticleIndexEntry test fixtures. */
function article(
  slug: string,
  overrides: Partial<ArticleIndexEntry> = {},
): ArticleIndexEntry {
  return {
    slug,
    title: overrides.title ?? `Title: ${slug}`,
    author: 'Test Author',
    publishDate: overrides.publishDate ?? '2026-04-15T12:00:00Z',
    tags: overrides.tags ?? [],
    type: overrides.type ?? 'standard',
    status: overrides.status ?? 'published',
    description: overrides.description,
    featuredImage: overrides.featuredImage,
    featured: overrides.featured,
  };
}

/**
 * Mimics the category page's tag-filtering logic (same as [topic].astro).
 * Case-insensitive slug match against article tags.
 */
function filterByCategory(
  articles: ArticleIndexEntry[],
  topicSlug: string,
): ArticleIndexEntry[] {
  return articles.filter((a) =>
    a.tags.some((t) => t.toLowerCase().replace(/\s+/g, '-') === topicSlug.toLowerCase()),
  );
}

/**
 * Mimics the category page's display-name resolution from brief.topics.
 */
function resolveDisplayName(topicSlug: string, briefTopics: string[]): string {
  return (
    briefTopics.find(
      (t) => t.toLowerCase().replace(/\s+/g, '-') === topicSlug.toLowerCase(),
    ) ??
    topicSlug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Mimics the numbered pagination calculation from [topic].astro.
 */
function paginateCategory(
  total: number,
  perPage: number,
  page: number,
): { totalPages: number; start: number; end: number; hasNext: boolean; hasPrev: boolean } {
  const totalPages = Math.ceil(total / perPage);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * perPage;
  const end = Math.min(start + perPage, total);
  return {
    totalPages,
    start,
    end,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

// ---------------------------------------------------------------------------
// 1. Category page — tag filtering
// ---------------------------------------------------------------------------

describe('Category page — tag filtering', () => {
  const pool = [
    article('best-movies', { tags: ['Movies', 'Entertainment'] }),
    article('top-sci-fi', { tags: ['Movies', 'Sci-Fi'] }),
    article('cooking-basics', { tags: ['Cooking', 'Lifestyle'] }),
    article('travel-guide', { tags: ['Travel'] }),
    article('movie-review-2026', { tags: ['Movies'] }),
  ];

  it('filters articles matching the slug case-insensitively', () => {
    const result = filterByCategory(pool, 'movies');
    expect(result.map((a) => a.slug)).toEqual([
      'best-movies',
      'top-sci-fi',
      'movie-review-2026',
    ]);
  });

  it('returns empty when no articles match the category', () => {
    expect(filterByCategory(pool, 'politics')).toEqual([]);
  });

  it('matches multi-word tags via slug conversion', () => {
    const result = filterByCategory(pool, 'sci-fi');
    expect(result.map((a) => a.slug)).toEqual(['top-sci-fi']);
  });

  it('matches tags with spaces when slug uses hyphens', () => {
    const articles = [
      article('a1', { tags: ['Current Events'] }),
      article('a2', { tags: ['current events'] }),
    ];
    expect(filterByCategory(articles, 'current-events').length).toBe(2);
  });

  it('does not match partial tag names', () => {
    // "Cook" should not match "Cooking"
    expect(filterByCategory(pool, 'cook')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Category page — display name resolution
// ---------------------------------------------------------------------------

describe('Category page — display name resolution', () => {
  const topics = ['Current Events', 'In-Depth Analysis', 'Local Stories'];

  it('finds exact display name from brief.topics', () => {
    expect(resolveDisplayName('current-events', topics)).toBe('Current Events');
  });

  it('finds display name case-insensitively', () => {
    expect(resolveDisplayName('in-depth-analysis', topics)).toBe('In-Depth Analysis');
  });

  it('title-cases the slug when no matching topic found', () => {
    expect(resolveDisplayName('unknown-topic', topics)).toBe('Unknown Topic');
  });

  it('handles single-word slugs', () => {
    expect(resolveDisplayName('sports', ['Sports'])).toBe('Sports');
  });
});

// ---------------------------------------------------------------------------
// 3. Category page — numbered pagination
// ---------------------------------------------------------------------------

describe('Category page — numbered pagination', () => {
  it('computes total pages correctly', () => {
    expect(paginateCategory(25, 12, 1).totalPages).toBe(3);
  });

  it('page 1: start=0, end=12', () => {
    const p = paginateCategory(25, 12, 1);
    expect(p.start).toBe(0);
    expect(p.end).toBe(12);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(true);
  });

  it('last page: end clamps to total', () => {
    const p = paginateCategory(25, 12, 3);
    expect(p.start).toBe(24);
    expect(p.end).toBe(25);
    expect(p.hasNext).toBe(false);
    expect(p.hasPrev).toBe(true);
  });

  it('single page has no prev/next', () => {
    const p = paginateCategory(5, 12, 1);
    expect(p.totalPages).toBe(1);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(false);
  });

  it('out-of-range page clamps to last', () => {
    const p = paginateCategory(25, 12, 99);
    expect(p.start).toBe(24);
    expect(p.end).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// 4. Load More — sliceForPage
// ---------------------------------------------------------------------------

describe('Load More — sliceForPage', () => {
  const items = Array.from({ length: 60 }, (_, i) => `item-${i}`);

  it('page 1 returns double the page_size', () => {
    const slice = sliceForPage(items, 1, 10);
    expect(slice.length).toBe(20);
    expect(slice[0]).toBe('item-0');
    expect(slice[19]).toBe('item-19');
  });

  it('page 2 returns one page_size after the initial batch', () => {
    const slice = sliceForPage(items, 2, 10);
    expect(slice.length).toBe(10);
    expect(slice[0]).toBe('item-20');
    expect(slice[9]).toBe('item-29');
  });

  it('page 3 continues from where page 2 ended', () => {
    const slice = sliceForPage(items, 3, 10);
    expect(slice[0]).toBe('item-30');
    expect(slice[9]).toBe('item-39');
  });

  it('fractional page numbers are floored', () => {
    expect(sliceForPage(items, 1.9, 10).length).toBe(20); // floor(1.9)=1
  });

  it('negative page clamps to 1', () => {
    expect(sliceForPage(items, -5, 10).length).toBe(20);
  });

  it('empty input returns empty for any page', () => {
    expect(sliceForPage([], 1, 10)).toEqual([]);
  });

  it('page_size=1 yields 2 on page 1, 1 on page 2', () => {
    expect(sliceForPage(items, 1, 1).length).toBe(2);
    expect(sliceForPage(items, 2, 1).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Ad placement — sidebar and inline injection
// ---------------------------------------------------------------------------

describe('Ad placement — inline injection', () => {
  const threeParas = '<p>One</p><p>Two</p><p>Three</p>';

  it('injects after the correct paragraph number', () => {
    const result = injectInlineAds(threeParas, [
      { id: 'ad-1', position: 'after-paragraph-2' },
    ]);
    expect(result).toContain('</p><div data-ad-id="ad-1"');
    // The ad div should appear between paragraphs 2 and 3
    const parts = result.split('data-ad-id');
    expect(parts.length).toBe(2);
  });

  it('does not inject when no inline placements exist', () => {
    const result = injectInlineAds(threeParas, [
      { id: 'sidebar', position: 'sidebar' },
    ]);
    expect(result).toBe(threeParas);
  });

  it('injects multiple ads at different paragraph positions', () => {
    const fiveParas = '<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p>';
    const result = injectInlineAds(fiveParas, [
      { id: 'after-2', position: 'after-paragraph-2' },
      { id: 'after-4', position: 'after-paragraph-4' },
    ]);
    expect(result).toContain('data-ad-id="after-2"');
    expect(result).toContain('data-ad-id="after-4"');
    // after-2 should appear before after-4 in the output
    expect(result.indexOf('after-2')).toBeLessThan(result.indexOf('after-4'));
  });

  it('preserves desktop/mobile size attributes', () => {
    const result = injectInlineAds(threeParas, [
      {
        id: 'sized-ad',
        position: 'after-paragraph-1',
        sizes: { desktop: [[728, 90]], mobile: [[320, 50]] },
      },
    ]);
    expect(result).toContain('data-sizes-desktop="[[728,90]]"');
    expect(result).toContain('data-sizes-mobile="[[320,50]]"');
  });

  it('ignores positions beyond available paragraphs', () => {
    const result = injectInlineAds(threeParas, [
      { id: 'ad-99', position: 'after-paragraph-99' },
    ]);
    expect(result).toBe(threeParas); // nothing injected
  });

  it('generates anonymous id for placements without id', () => {
    const result = injectInlineAds(threeParas, [
      { position: 'after-paragraph-1' },
    ]);
    expect(result).toContain('data-ad-id="after-paragraph-1-anon"');
  });
});

// ---------------------------------------------------------------------------
// 6. Theme / color / layout resolution
// ---------------------------------------------------------------------------

describe('Theme — color deep merge', () => {
  it('site colors override org defaults', () => {
    const org = {
      theme: {
        colors: { primary: '#0066ff', accent: '#00ccff', text: '#1a1a2e' },
      },
    };
    const site = {
      theme: {
        colors: { primary: '#ff0000', accent: '#00ff00' },
      },
    };
    const merged = deepMerge(org, site) as typeof org;
    expect(merged.theme.colors.primary).toBe('#ff0000');
    expect(merged.theme.colors.accent).toBe('#00ff00');
    expect(merged.theme.colors.text).toBe('#1a1a2e'); // inherited
  });

  it('font families override individually', () => {
    const org = { theme: { fonts: { heading: 'Inter', body: 'Inter' } } };
    const site = { theme: { fonts: { heading: 'Playfair Display' } } };
    const merged = deepMerge(org, site) as typeof org;
    expect(merged.theme.fonts.heading).toBe('Playfair Display');
    expect(merged.theme.fonts.body).toBe('Inter'); // inherited
  });

  it('empty site theme preserves org defaults', () => {
    const org = { theme: { colors: { primary: '#111' } } };
    const merged = deepMerge(org, {}) as typeof org;
    expect(merged.theme.colors.primary).toBe('#111');
  });
});

// ---------------------------------------------------------------------------
// 7. Layout resolution — hero, must-reads, load-more, sidebar topics
// ---------------------------------------------------------------------------

describe('Layout resolution', () => {
  it('returns LAYOUT_DEFAULTS when input is undefined', () => {
    const result = resolveLayout(undefined);
    expect(result).toEqual(LAYOUT_DEFAULTS);
  });

  it('hero.count only accepts 3 or 4', () => {
    expect(resolveLayout({ hero: { count: 3 } }).hero.count).toBe(3);
    expect(resolveLayout({ hero: { count: 4 } }).hero.count).toBe(4);
    expect(resolveLayout({ hero: { count: 5 } }).hero.count).toBe(LAYOUT_DEFAULTS.hero.count);
    expect(resolveLayout({ hero: { count: 0 } }).hero.count).toBe(LAYOUT_DEFAULTS.hero.count);
  });

  it('must_reads.count clamps to >= 1', () => {
    expect(resolveLayout({ must_reads: { count: 0 } }).must_reads.count).toBe(1);
    expect(resolveLayout({ must_reads: { count: -5 } }).must_reads.count).toBe(1);
    expect(resolveLayout({ must_reads: { count: 8 } }).must_reads.count).toBe(8);
  });

  it('load_more.page_size clamps to >= 1', () => {
    expect(resolveLayout({ load_more: { page_size: 0 } }).load_more.page_size).toBe(1);
    expect(resolveLayout({ load_more: { page_size: -10 } }).load_more.page_size).toBe(1);
    expect(resolveLayout({ load_more: { page_size: 20 } }).load_more.page_size).toBe(20);
  });

  it('sidebar_topics.auto defaults to true', () => {
    expect(resolveLayout({}).sidebar_topics.auto).toBe(true);
  });

  it('sidebar_topics.explicit overrides default empty array', () => {
    const result = resolveLayout({ sidebar_topics: { explicit: ['Movies', 'Tech'] } });
    expect(result.sidebar_topics.explicit).toEqual(['Movies', 'Tech']);
  });
});

// ---------------------------------------------------------------------------
// 8. Featured selection for hero + must-reads
// ---------------------------------------------------------------------------

describe('Featured selection — category context', () => {
  const pool = [
    article('hero-a', { featured: ['hero'], tags: ['Movies'] }),
    article('hero-b', { featured: ['hero'], tags: ['Tech'] }),
    article('must-a', { featured: ['must-read'], tags: ['Movies'] }),
    article('plain-1', { tags: ['Movies'] }),
    article('plain-2', { tags: ['Tech'] }),
    article('plain-3', { tags: ['Cooking'] }),
  ];

  it('hero selection picks tagged articles first', () => {
    const heroes = selectFeatured(pool, 'hero', 3);
    expect(heroes[0].slug).toBe('hero-a');
    expect(heroes[1].slug).toBe('hero-b');
  });

  it('must-read selection excludes hero slugs', () => {
    const heroes = selectFeatured(pool, 'hero', 2);
    const exclude = new Set(heroes.map((a) => a.slug));
    const reads = selectFeatured(pool, 'must-read', 3, exclude);
    const readSlugs = reads.map((a) => a.slug);
    expect(readSlugs).not.toContain('hero-a');
    expect(readSlugs).not.toContain('hero-b');
  });

  it('returns fewer articles when pool is exhausted', () => {
    expect(selectFeatured(pool, 'hero', 100).length).toBe(pool.length);
  });
});

// ---------------------------------------------------------------------------
// 9. Feed card rendering (used by Load More API endpoint)
// ---------------------------------------------------------------------------

describe('Feed card HTML rendering', () => {
  it('renders article with featured image', () => {
    const html = renderFeedCardsHtml([
      article('test-article', {
        title: 'Hello World',
        featuredImage: '/img/test.jpg',
        description: 'A test description',
      }),
    ]);
    expect(html).toContain('class="feed-card"');
    expect(html).toContain('href="/test-article"');
    expect(html).toContain('src="/img/test.jpg"');
    expect(html).toContain('Hello World');
    expect(html).toContain('A test description');
  });

  it('renders without image when featuredImage is missing', () => {
    const html = renderFeedCardsHtml([article('no-img')]);
    expect(html).not.toContain('<img');
  });

  it('escapes HTML in titles to prevent XSS', () => {
    const html = renderFeedCardsHtml([
      article('xss', { title: '<script>alert("xss")</script>' }),
    ]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders multiple articles in order', () => {
    const articles = [
      article('first', { title: 'First' }),
      article('second', { title: 'Second' }),
    ];
    const html = renderFeedCardsHtml(articles);
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('second'));
  });

  it('returns empty string for empty array', () => {
    expect(renderFeedCardsHtml([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 10. Asset URL rewriting (theme logos, favicons)
// ---------------------------------------------------------------------------

describe('Asset URL rewriting', () => {
  it('rewrites /assets/ paths to site-prefixed R2 paths', () => {
    const html = '<img src="/assets/hero.jpg" />';
    const result = rewriteAssetUrls(html, 'coolnews-atl');
    expect(result).toContain('/coolnews-atl/assets/hero.jpg');
  });

  it('leaves absolute URLs untouched', () => {
    const html = '<img src="https://cdn.example.com/photo.jpg" />';
    const result = rewriteAssetUrls(html, 'coolnews-atl');
    expect(result).toBe(html);
  });

  it('rewriteFrontmatterUrl prefixes /assets/ paths', () => {
    expect(rewriteFrontmatterUrl('/assets/logo.png', 'mysite')).toBe('/mysite/assets/logo.png');
  });

  it('rewriteFrontmatterUrl passes through absolute URLs', () => {
    const url = 'https://example.com/logo.png';
    expect(rewriteFrontmatterUrl(url, 'mysite')).toBe(url);
  });

  it('rewriteFrontmatterUrl returns undefined for undefined input', () => {
    expect(rewriteFrontmatterUrl(undefined, 'mysite')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11. parseFeatured — YAML frontmatter coercion
// ---------------------------------------------------------------------------

describe('parseFeatured — frontmatter coercion', () => {
  it('returns undefined for null/undefined', () => {
    expect(parseFeatured(null)).toBeUndefined();
    expect(parseFeatured(undefined)).toBeUndefined();
  });

  it('parses single string value', () => {
    expect(parseFeatured('hero')).toEqual(['hero']);
  });

  it('parses array of valid values', () => {
    expect(parseFeatured(['hero', 'must-read'])).toEqual(['hero', 'must-read']);
  });

  it('strips invalid values silently', () => {
    expect(parseFeatured(['hero', 'bogus', 'must-read'])).toEqual(['hero', 'must-read']);
  });

  it('returns empty array when all values are invalid (not undefined)', () => {
    expect(parseFeatured(['invalid'])).toEqual([]);
  });

  it('returns undefined for empty array (treated as not-featured)', () => {
    expect(parseFeatured([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 12. KV key scheme — category-relevant keys
// ---------------------------------------------------------------------------

describe('KV keys — category routing dependencies', () => {
  it('article-index key is deterministic for a siteId', () => {
    expect(articleIndexKey('coolnews-atl')).toBe('article-index:coolnews-atl');
  });

  it('site-config key provides the config for category.enabled check', () => {
    expect(siteConfigKey('coolnews-atl')).toBe('site-config:coolnews-atl');
  });

  it('site lookup key resolves hostname to siteId', () => {
    expect(siteLookupKey('coolnews.dev')).toBe('site:coolnews.dev');
  });

  it('article key nests correctly for detail page links from category grid', () => {
    expect(articleKey('coolnews-atl', 'best-movies-2026')).toBe(
      'article:coolnews-atl:best-movies-2026',
    );
  });
});
