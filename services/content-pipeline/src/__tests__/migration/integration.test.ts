import { describe, it, expect } from "vitest";
import { parseCsvRow } from "../../agents/migration/csv-parser.js";
import { buildSiteYaml, domainToSiteId } from "../../agents/migration/site-scaffolder.js";
import { wpHtmlToMarkdown } from "../../agents/migration/html-to-md.js";
import { mapCategoriesToTags } from "../../agents/migration/article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "../../agents/migration/frontmatter-builder.js";
import type { WpArticle, WpCategory } from "../../agents/migration/types.js";
import matter from "gray-matter";
import { parse as yamlParse } from "yaml";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_CSV_ROW = {
  Name: "tvshowbox.com",
  "Website Category": "Entertainment",
  "Menu Items": "News, Reviews, Streaming",
  "IAB Top Categories (Vertical)": "Entertainment",
  "Sub Categories": "Television, Movies",
  "Color Palette":
    "primary: #f5d580, secondary: #2a1810, accent: #d4a04c, text: #2a1810, background: #f8e8d4",
  Logo: "https://tvshowbox.com/logo.png",
  Favicon: "https://tvshowbox.com/favicon.png",
  "Posts REST API (articles)":
    "https://tvshowbox.com/wp-json/wp/v2/posts?per_page=75",
  "GA Info": "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
};

const SAMPLE_WP_ARTICLE: WpArticle = {
  id: 24108,
  slug: "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
  date: "2026-05-11T11:36:54",
  title: { rendered: "Newsom Slams Trump Secretary Sean Duffy Over Reality TV" },
  content: {
    rendered:
      '<h2>The Clash</h2><p>Gavin Newsom has publicly taken aim at Sean Duffy.</p><p>[gallery ids="1,2"]</p>',
  },
  excerpt: {
    rendered:
      "<p>Gavin Newsom criticized Sean Duffy&#8217;s road trip media project.</p>",
  },
  author: 3,
  featured_media: 24107,
  categories: [5],
  tags: [],
  yoast_head_json: {
    title:
      "Newsom Slams Trump Secretary Sean Duffy Over Reality TV - TV Show Box",
    og_title:
      "Newsom Slams Trump Secretary Sean Duffy Over Reality TV - TV Show Box",
    og_description: "Gavin Newsom criticized Sean Duffy.",
    canonical:
      "https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/",
    twitter_card: "summary_large_image",
    author: "Taylor Winters",
  },
};

const WP_CATEGORIES: WpCategory[] = [
  { id: 5, name: "News", slug: "news", parent: 0 },
  { id: 12, name: "Reviews", slug: "reviews", parent: 0 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration: WP article → .md conversion pipeline", () => {
  it("converts WP article JSON → valid .md file", () => {
    // Step 1: Parse CSV row
    const site = parseCsvRow(SAMPLE_CSV_ROW);
    expect(site.name).toBe("tvshowbox.com");
    expect(site.menuItems).toEqual(["News", "Reviews", "Streaming"]);

    // Step 2: Build site.yaml — verify domain, tracking
    const siteYamlStr = buildSiteYaml(site);
    const siteYaml = yamlParse(siteYamlStr);

    // site.yaml carries the real hostname; the site ID is the folder/KV key.
    expect(siteYaml.domain).toBe("tvshowbox.com");
    expect(domainToSiteId(siteYaml.domain)).toBe("tvshowbox");
    expect(siteYaml.tracking).toBeDefined();
    expect(siteYaml.tracking.ga4).toBe("G-HL2D8CQ0Z9");
    expect(siteYaml.tracking.gtm).toBe("GT-5R65N74B");
    expect(siteYaml.layout.categories).toEqual([
      "News",
      "Reviews",
      "Streaming",
    ]);

    // Step 3: Convert HTML → Markdown — verify heading, no shortcodes
    const markdown = wpHtmlToMarkdown(SAMPLE_WP_ARTICLE.content.rendered);
    expect(markdown).toContain("## The Clash");
    expect(markdown).toContain("Gavin Newsom has publicly taken aim");
    expect(markdown).not.toContain("[gallery");
    expect(markdown).not.toMatch(/\[[\w_-]+/);

    // Step 4: Map categories — WP cat 5 "News" → menu "News"
    const tags = mapCategoriesToTags(
      SAMPLE_WP_ARTICLE.categories,
      WP_CATEGORIES,
      site.menuItems,
    );
    expect(tags).toEqual(["News"]);

    // Step 5: Build article .md — verify all frontmatter fields via gray-matter
    const excerpt = stripHtmlTags(SAMPLE_WP_ARTICLE.excerpt.rendered);
    const yoast = SAMPLE_WP_ARTICLE.yoast_head_json!;

    const articleMd = buildArticleMd({
      title: SAMPLE_WP_ARTICLE.title.rendered,
      description: excerpt,
      slug: SAMPLE_WP_ARTICLE.slug,
      publishDate: SAMPLE_WP_ARTICLE.date,
      author: yoast.author ?? "Unknown",
      tags,
      markdownBody: markdown,
      wpOriginalId: SAMPLE_WP_ARTICLE.id,
      sourceUrl: yoast.canonical ?? "",
      seo: {
        canonical: yoast.canonical,
        og_title: yoast.og_title,
        og_description: yoast.og_description,
        twitter_card: yoast.twitter_card,
      },
    });

    const parsed = matter(articleMd);

    // Frontmatter fields
    expect(parsed.data.title).toBe(
      "Newsom Slams Trump Secretary Sean Duffy Over Reality TV",
    );
    expect(parsed.data.slug).toBe(
      "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
    );
    expect(parsed.data.author).toBe("Taylor Winters");
    expect(parsed.data.tags).toEqual(["News"]);
    expect(parsed.data.publishDate).toBe("2026-05-11T11:36:54");
    expect(parsed.data.status).toBe("published");
    expect(parsed.data.type).toBe("standard");
    expect(parsed.data.imported_from).toBe("wordpress");
    expect(parsed.data.wp_original_id).toBe(24108);
    expect(parsed.data.source_url).toBe(
      "https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/",
    );
    expect(parsed.data.reading_time).toBeGreaterThanOrEqual(1);

    // SEO block
    expect(parsed.data.seo).toBeDefined();
    expect(parsed.data.seo.canonical).toBe(
      "https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/",
    );
    expect(parsed.data.seo.og_title).toContain("Newsom Slams");
    expect(parsed.data.seo.twitter_card).toBe("summary_large_image");

    // Body content
    expect(parsed.content).toContain("## The Clash");
    expect(parsed.content).not.toContain("[gallery");
  });

  it("preserves slug exactly for SEO", () => {
    const slugs = [
      "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
      "best-streaming-services-2026-ultimate-guide",
      "top-10-reality-tv-shows-you-need-to-watch",
    ];

    for (const slug of slugs) {
      const articleMd = buildArticleMd({
        title: "Test Title",
        description: "Test description.",
        slug,
        publishDate: "2026-05-11T00:00:00",
        author: "Test Author",
        tags: ["News"],
        markdownBody: "Body text.",
        wpOriginalId: 1,
        sourceUrl: `https://example.com/${slug}/`,
        seo: {},
      });

      const parsed = matter(articleMd);
      expect(parsed.data.slug).toBe(slug);
    }
  });
});
