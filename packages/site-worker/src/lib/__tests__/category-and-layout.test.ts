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
  mergeScriptLayers,
  mergeAdPlacementLayers,
  resolveScriptVars,
  selectMatchingOverrides,
  stripModeKeys,
  stripOverrideMetaFields,
  rewriteAssetUrls,
  rewriteFrontmatterUrl,
  type OverrideConfig,
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
    expect(resolveLayout({ hero: { count: 5 as unknown as 3 | 4 } }).hero.count).toBe(LAYOUT_DEFAULTS.hero.count);
    expect(resolveLayout({ hero: { count: 0 as unknown as 3 | 4 } }).hero.count).toBe(LAYOUT_DEFAULTS.hero.count);
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

// ---------------------------------------------------------------------------
// 13. mergeScriptLayers — 3-layer merge cycle (group → override → site)
// ---------------------------------------------------------------------------

describe('mergeScriptLayers — multi-layer merge', () => {
  it('merges scripts from org + group + override via merge-by-id', () => {
    const org: Record<string, unknown> = {
      scripts: { head: [{ id: 'analytics', src: '/analytics.js' }], body_start: [], body_end: [] },
    };
    const group: Record<string, unknown> = {
      scripts: {
        head: [
          { id: 'analytics', src: '/analytics-v2.js' }, // replaces org
          { id: 'gpt', src: '/gpt.js', async: true },
        ],
        body_start: [],
        body_end: [{ id: 'interstitial', inline: 'console.log("inter")' }],
      },
    };
    const override: Record<string, unknown> = {
      scripts: {
        head: [], // empty — does NOT erase inherited
        body_start: [{ id: 'bgcolor', inline: "document.body.style.backgroundColor = 'red';" }],
        body_end: [{ id: 'mock-fill', src: '/mock.js' }],
      },
    };
    const site: Record<string, unknown> = {}; // no scripts

    const result = mergeScriptLayers([org, group, override, site]);
    // head: analytics replaced by group, gpt added by group, override's empty head skipped
    expect(result.head).toEqual([
      { id: 'analytics', src: '/analytics-v2.js' },
      { id: 'gpt', src: '/gpt.js', async: true },
    ]);
    // body_start: only override contributes bgcolor
    expect(result.body_start).toEqual([
      { id: 'bgcolor', inline: "document.body.style.backgroundColor = 'red';" },
    ]);
    // body_end: interstitial from group + mock-fill appended from override
    expect(result.body_end).toEqual([
      { id: 'interstitial', inline: 'console.log("inter")' },
      { id: 'mock-fill', src: '/mock.js' },
    ]);
  });

  it('site-layer scripts replace override when same id', () => {
    const org: Record<string, unknown> = { scripts: { head: [], body_start: [], body_end: [] } };
    const override: Record<string, unknown> = {
      scripts: { head: [{ id: 'tag', src: '/old.js' }], body_start: [], body_end: [] },
    };
    const site: Record<string, unknown> = {
      scripts: { head: [{ id: 'tag', src: '/new.js', async: true }], body_start: [], body_end: [] },
    };
    const result = mergeScriptLayers([org, override, site]);
    expect(result.head).toEqual([{ id: 'tag', src: '/new.js', async: true }]);
  });

  it('empty script arrays never erase inherited entries', () => {
    const group: Record<string, unknown> = {
      scripts: { head: [{ id: 'a', src: '/a.js' }], body_start: [{ id: 'b', inline: 'B' }], body_end: [] },
    };
    const override: Record<string, unknown> = {
      scripts: { head: [], body_start: [], body_end: [] },
    };
    const result = mergeScriptLayers([group, override]);
    expect(result.head).toEqual([{ id: 'a', src: '/a.js' }]);
    expect(result.body_start).toEqual([{ id: 'b', inline: 'B' }]);
  });

  it('replace mode on site layer discards all inherited scripts', () => {
    const group: Record<string, unknown> = {
      scripts: { head: [{ id: 'a', src: '/a.js' }, { id: 'b', src: '/b.js' }], body_start: [], body_end: [] },
    };
    const site: Record<string, unknown> = {
      merge_modes: { scripts: 'replace' },
      scripts: { head: [{ id: 'c', src: '/c.js' }], body_start: [], body_end: [] },
    };
    const result = mergeScriptLayers([group, site]);
    expect(result.head).toEqual([{ id: 'c', src: '/c.js' }]);
  });

  it('layers without scripts field are silently skipped', () => {
    const org: Record<string, unknown> = {
      scripts: { head: [{ id: 'x', src: '/x.js' }], body_start: [], body_end: [] },
    };
    const noScripts: Record<string, unknown> = { theme: { colors: {} } };
    const result = mergeScriptLayers([org, noScripts, noScripts]);
    expect(result.head).toEqual([{ id: 'x', src: '/x.js' }]);
  });
});

// ---------------------------------------------------------------------------
// 14. resolveScriptVars — {{placeholder}} substitution
// ---------------------------------------------------------------------------

describe('resolveScriptVars — placeholder substitution', () => {
  it('replaces {{key}} tokens with scripts_vars values', () => {
    const scripts = {
      head: [{ id: 'init', inline: "init('{{site_id}}', '{{zone}}')" }],
      body_start: [],
      body_end: [],
      before_footer: [],
    };
    const vars = { site_id: 'my-site-001', zone: 'news' };
    const result = resolveScriptVars(scripts, vars);
    expect(result.head[0].inline).toBe("init('my-site-001', 'news')");
  });

  it('replaces multiple occurrences of the same token', () => {
    const scripts = {
      head: [{ id: 'dup', inline: '{{x}} and {{x}} again' }],
      body_start: [],
      body_end: [],
      before_footer: [],
    };
    const result = resolveScriptVars(scripts, { x: 'VALUE' });
    expect(result.head[0].inline).toBe('VALUE and VALUE again');
  });

  it('throws on unresolved tokens', () => {
    const scripts = {
      head: [{ id: 'bad', inline: "load('{{unknown_var}}')" }],
      body_start: [],
      body_end: [],
      before_footer: [],
    };
    expect(() => resolveScriptVars(scripts, {})).toThrowError(/unresolved/i);
  });

  it('leaves src-only scripts untouched', () => {
    const scripts = {
      head: [{ id: 'ext', src: '/external.js' }],
      body_start: [],
      body_end: [],
      before_footer: [],
    };
    const result = resolveScriptVars(scripts, {});
    expect(result.head[0]).toEqual({ id: 'ext', src: '/external.js' });
  });

  it('resolves vars across all three positions', () => {
    const scripts = {
      head: [{ id: 'h', inline: 'H={{v}}' }],
      body_start: [{ id: 'bs', inline: 'BS={{v}}' }],
      body_end: [{ id: 'be', inline: 'BE={{v}}' }],
      before_footer: [],
    };
    const result = resolveScriptVars(scripts, { v: '42' });
    expect(result.head[0].inline).toBe('H=42');
    expect(result.body_start[0].inline).toBe('BS=42');
    expect(result.body_end[0].inline).toBe('BE=42');
  });

  it('handles empty vars with no templates (no-op)', () => {
    const scripts = {
      head: [{ id: 'plain', inline: 'console.log("hello")' }],
      body_start: [],
      body_end: [],
      before_footer: [],
    };
    const result = resolveScriptVars(scripts, {});
    expect(result.head[0].inline).toBe('console.log("hello")');
  });
});

// ---------------------------------------------------------------------------
// 15. mergeAdPlacementLayers — replacement and add semantics
// ---------------------------------------------------------------------------

describe('mergeAdPlacementLayers — ad placement merge', () => {
  it('non-site layers replace inherited (last group wins)', () => {
    const org: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'org-ad', position: 'sidebar' }] },
    };
    const group: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'group-ad', position: 'above-content' }] },
    };
    const site: Record<string, unknown> = {};
    const result = mergeAdPlacementLayers([org, group, site]);
    expect(result).toEqual([{ id: 'group-ad', position: 'above-content' }]);
  });

  it('site layer defaults to add mode (appends to inherited)', () => {
    const group: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'inherited', position: 'sidebar' }] },
    };
    const site: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'site-only', position: 'sticky-bottom' }] },
    };
    const result = mergeAdPlacementLayers([group, site]);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('inherited');
    expect(result[1].id).toBe('site-only');
  });

  it('site replace mode discards all inherited placements', () => {
    const group: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'a' }, { id: 'b' }] },
    };
    const site: Record<string, unknown> = {
      merge_modes: { ads_config: 'replace' },
      ads_config: { ad_placements: [{ id: 'c' }] },
    };
    const result = mergeAdPlacementLayers([group, site]);
    expect(result).toEqual([{ id: 'c' }]);
  });

  it('merge_placements mode merges by id', () => {
    const group: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'top', position: 'above-content', device: 'all' }] },
    };
    const site: Record<string, unknown> = {
      merge_modes: { ads_config: 'merge_placements' },
      ads_config: { ad_placements: [
        { id: 'top', position: 'above-content', device: 'desktop' }, // replaces
        { id: 'bottom', position: 'sticky-bottom' }, // new
      ] },
    };
    const result = mergeAdPlacementLayers([group, site]);
    expect(result.length).toBe(2);
    expect(result.find((p: any) => p.id === 'top')?.device).toBe('desktop');
    expect(result.find((p: any) => p.id === 'bottom')).toBeTruthy();
  });

  it('override layer replaces group placements', () => {
    const org: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'org-sidebar', position: 'sidebar' }] },
    };
    const group: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'group-top', position: 'above-content' }] },
    };
    const override: Record<string, unknown> = {
      ads_config: { ad_placements: [
        { id: 'override-top', position: 'above-content' },
        { id: 'override-sidebar', position: 'sidebar' },
      ] },
    };
    const site: Record<string, unknown> = {};
    const result = mergeAdPlacementLayers([org, group, override, site]);
    // override replaces group, site is empty (adds nothing)
    expect(result.map((p: any) => p.id)).toEqual(['override-top', 'override-sidebar']);
  });
});

// ---------------------------------------------------------------------------
// 16. selectMatchingOverrides — targeting logic
// ---------------------------------------------------------------------------

describe('selectMatchingOverrides — targeting', () => {
  const overrides: OverrideConfig[] = [
    { override_id: 'a', priority: 10, targets: { sites: ['site-1'] } },
    { override_id: 'b', priority: 5, targets: { groups: ['entertainment'] } },
    { override_id: 'c', priority: 20, targets: { sites: ['site-2'] } },
    { override_id: 'd', priority: 15, targets: { groups: ['taboola'], sites: ['site-1'] } },
  ];

  it('matches by site id', () => {
    const result = selectMatchingOverrides(overrides, 'site-1', []);
    expect(result.map((o) => o.override_id)).toEqual(['b', 'a', 'd'].filter((id) =>
      ['a', 'd'].includes(id),
    ));
    // Only a (sites: [site-1]) and d (sites: [site-1]) match
    const ids = result.map((o) => o.override_id);
    expect(ids).toContain('a');
    expect(ids).toContain('d');
    expect(ids).not.toContain('c'); // targets site-2
  });

  it('matches by group membership', () => {
    const result = selectMatchingOverrides(overrides, 'unknown-site', ['entertainment']);
    expect(result.map((o) => o.override_id)).toEqual(['b']);
  });

  it('sorts by priority ascending (lowest first)', () => {
    const result = selectMatchingOverrides(overrides, 'site-1', ['taboola']);
    const priorities = result.map((o) => o.priority ?? 0);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
    }
  });

  it('returns empty when nothing matches', () => {
    expect(selectMatchingOverrides(overrides, 'no-match', ['no-group'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 17. stripModeKeys — _mode / _values removal
// ---------------------------------------------------------------------------

describe('stripModeKeys', () => {
  it('removes _mode from nested objects', () => {
    const input = { tracking: { _mode: 'merge', ga4: 'G-123' } };
    expect(stripModeKeys(input)).toEqual({ tracking: { ga4: 'G-123' } });
  });

  it('removes _values from arrays-in-objects', () => {
    const input = { ads_txt: { _mode: 'add', _values: ['a', 'b'] } };
    expect(stripModeKeys(input)).toEqual({ ads_txt: {} });
  });

  it('preserves scripts arrays including body_start entries', () => {
    const input = {
      scripts: {
        head: [],
        body_start: [{ id: 'bgcolor', inline: "document.body.style.backgroundColor = 'red';" }],
        body_end: [{ id: 'mock', src: '/mock.js' }],
      },
    };
    const result = stripModeKeys(input) as typeof input;
    expect(result.scripts.body_start).toEqual([
      { id: 'bgcolor', inline: "document.body.style.backgroundColor = 'red';" },
    ]);
    expect(result.scripts.body_end).toEqual([{ id: 'mock', src: '/mock.js' }]);
  });

  it('is recursive through nested objects', () => {
    const input = { a: { b: { _mode: 'replace', c: { _mode: 'merge', d: 1 } } } };
    expect(stripModeKeys(input)).toEqual({ a: { b: { c: { d: 1 } } } });
  });
});

// ---------------------------------------------------------------------------
// 18. Full 3-layer merge cycle — theme changes across group + override + site
// ---------------------------------------------------------------------------

describe('Full merge cycle — theme across 3 layers', () => {
  it('group overrides org colors, site overrides one group color', () => {
    const org = { theme: { colors: { primary: '#000', accent: '#111', text: '#222' } } };
    const group = { theme: { colors: { primary: '#E50914', accent: '#B81D24' } } };
    const site = { theme: { colors: { accent: '#CUSTOM' } } };
    const m1 = deepMerge(org, group) as typeof org;
    const m2 = deepMerge(m1, site) as typeof org;
    expect(m2.theme.colors.primary).toBe('#E50914'); // from group
    expect(m2.theme.colors.accent).toBe('#CUSTOM');  // site wins
    expect(m2.theme.colors.text).toBe('#222');        // inherited from org
  });

  it('override layer injects between group and site', () => {
    const org = { theme: { base: 'modern', colors: { primary: '#000' } } };
    const group = { theme: { colors: { primary: '#AAA' } } };
    const override = { theme: { colors: { primary: '#BBB', accent: '#CCC' } } };
    const site = { theme: { colors: { accent: '#DDD' } } };
    const merged = [org, group, override, site].reduce(
      (acc, layer) => deepMerge(acc, layer) as Record<string, unknown>,
      {} as Record<string, unknown>,
    );
    const colors = (merged as any).theme.colors;
    expect(colors.primary).toBe('#BBB'); // override wins over group
    expect(colors.accent).toBe('#DDD');  // site wins over override
  });

  it('null values in later layers do NOT erase inherited', () => {
    const org = { theme: { colors: { primary: '#000' } } };
    const site = { theme: { colors: { primary: null } } };
    const merged = deepMerge(org, site) as typeof org;
    expect(merged.theme.colors.primary).toBe('#000'); // null doesn't override
  });
});

// ---------------------------------------------------------------------------
// 19. Full merge cycle — scripts across all 4 layers
// ---------------------------------------------------------------------------

describe('Full merge cycle — scripts across org → group → override → site', () => {
  it('simulates the coolnews-atl layer chain', () => {
    const org: Record<string, unknown> = {
      scripts: { head: [], body_start: [], body_end: [] },
      scripts_vars: {},
    };
    const group: Record<string, unknown> = {
      scripts: {
        head: [
          { id: 'gpt', src: 'https://gpt.example.com/gpt.js', async: true },
          { id: 'alpha-init', inline: "window.init('{{alpha_id}}')" },
        ],
        body_start: [],
        body_end: [{ id: 'interstitial', inline: "if('{{inter_enabled}}'==='true') run()" }],
      },
      scripts_vars: { alpha_id: '', inter_enabled: 'false' },
    };
    const override: Record<string, unknown> = {
      scripts: {
        head: [],
        body_start: [{ id: 'bgcolor', inline: "document.body.style.backgroundColor='red'" }],
        body_end: [{ id: 'mock', src: '/mock.js' }],
      },
      scripts_vars: {},
    };
    const site: Record<string, unknown> = {
      scripts_vars: { alpha_id: 'cool-001', inter_enabled: 'false' },
    };

    // Step 1: merge scripts via mergeScriptLayers
    const layers = [org, group, override, site];
    const scripts = mergeScriptLayers(layers);

    expect(scripts.head.length).toBe(2); // gpt + alpha-init from group
    expect(scripts.body_start.length).toBe(1); // bgcolor from override
    expect(scripts.body_end.length).toBe(2); // interstitial + mock

    // Step 2: merge scripts_vars via deepMerge
    const mergedVars = layers.reduce(
      (acc, l) => deepMerge(acc, (l.scripts_vars ?? {}) as Record<string, string>) as Record<string, string>,
      {} as Record<string, string>,
    );
    expect(mergedVars).toEqual({ alpha_id: 'cool-001', inter_enabled: 'false' });

    // Step 3: resolve placeholders
    const resolved = resolveScriptVars(scripts, mergedVars as Record<string, string>);
    expect(resolved.head[1].inline).toBe("window.init('cool-001')");
    expect(resolved.body_end[0].inline).toBe("if('false'==='true') run()");
    expect(resolved.body_start[0].inline).toBe("document.body.style.backgroundColor='red'");
  });
});

// ---------------------------------------------------------------------------
// 20. Full merge cycle — ads across group → override → site
// ---------------------------------------------------------------------------

describe('Full merge cycle — ads across org → group → override → site', () => {
  it('override replaces group placements, site adds nothing', () => {
    const org: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'org-banner', position: 'above-content' }] },
    };
    const group: Record<string, unknown> = {
      ads_config: {
        ad_placements: [
          { id: 'group-top', position: 'above-content' },
          { id: 'group-sidebar', position: 'sidebar' },
        ],
      },
    };
    const override: Record<string, unknown> = {
      ads_config: {
        ad_placements: [
          { id: 'ov-top', position: 'above-content' },
          { id: 'ov-sidebar', position: 'sidebar' },
          { id: 'ov-sticky', position: 'sticky-bottom' },
        ],
      },
    };
    const site: Record<string, unknown> = {};

    const placements = mergeAdPlacementLayers([org, group, override, site]);
    expect(placements.map((p: any) => p.id)).toEqual(['ov-top', 'ov-sidebar', 'ov-sticky']);
  });

  it('site in add mode appends its placements to override result', () => {
    const org: Record<string, unknown> = {};
    const override: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'ov-1', position: 'sidebar' }] },
    };
    const site: Record<string, unknown> = {
      ads_config: { ad_placements: [{ id: 'site-extra', position: 'after-paragraph-4' }] },
    };
    const placements = mergeAdPlacementLayers([org, override, site]);
    expect(placements.length).toBe(2);
    expect(placements[0].id).toBe('ov-1');
    expect(placements[1].id).toBe('site-extra');
  });
});

// ---------------------------------------------------------------------------
// 21. stripOverrideMetaFields
// ---------------------------------------------------------------------------

describe('stripOverrideMetaFields', () => {
  it('removes override_id, name, priority, targets', () => {
    const input = {
      override_id: 'test',
      name: 'Test',
      priority: 100,
      targets: { sites: ['a'] },
      tracking: { ga4: 'G-123' },
      scripts: { head: [] },
    };
    const result = stripOverrideMetaFields(input);
    expect(result).not.toHaveProperty('override_id');
    expect(result).not.toHaveProperty('name');
    expect(result).not.toHaveProperty('priority');
    expect(result).not.toHaveProperty('targets');
    expect(result).toHaveProperty('tracking');
    expect(result).toHaveProperty('scripts');
  });
});
