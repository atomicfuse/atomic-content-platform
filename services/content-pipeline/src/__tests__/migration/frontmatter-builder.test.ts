import { describe, it, expect } from "vitest";
import {
  stripHtmlTags,
  estimateReadingTime,
  buildArticleMd,
} from "../../agents/migration/frontmatter-builder.js";
import matter from "gray-matter";

describe("stripHtmlTags", () => {
  it("removes HTML tags", () => {
    expect(stripHtmlTags("<p>Hello <strong>world</strong>.</p>")).toBe(
      "Hello world.",
    );
  });

  it("handles empty string", () => {
    expect(stripHtmlTags("")).toBe("");
  });
});

describe("estimateReadingTime", () => {
  it("returns ~3 min for 500 words", () => {
    const words = Array(500).fill("word").join(" ");
    expect(estimateReadingTime(words)).toBe(3);
  });

  it("returns minimum 1 min", () => {
    expect(estimateReadingTime("short")).toBe(1);
  });
});

describe("buildArticleMd", () => {
  const input = {
    title: "Test Article",
    description: "A test description.",
    slug: "test-article",
    publishDate: "2026-05-11",
    author: "John Doe",
    tags: ["News"],
    markdownBody: "## Heading\n\nBody text here.",
    featuredImage: "/assets/images/test-article.webp",
    wpOriginalId: 123,
    sourceUrl: "https://example.com/test-article/",
    seo: {
      canonical: "https://example.com/test-article/",
      og_title: "Test Article - Example",
      og_description: "A test description.",
      twitter_card: "summary_large_image" as const,
    },
  };

  it("produces parseable frontmatter", () => {
    const md = buildArticleMd(input);
    const parsed = matter(md);
    expect(parsed.data.title).toBe("Test Article");
    expect(parsed.data.slug).toBe("test-article");
    expect(parsed.data.imported_from).toBe("wordpress");
    expect(parsed.data.wp_original_id).toBe(123);
  });

  it("includes SEO fields", () => {
    const parsed = matter(buildArticleMd(input));
    expect(parsed.data.seo.canonical).toBe(
      "https://example.com/test-article/",
    );
    expect(parsed.data.seo.twitter_card).toBe("summary_large_image");
  });

  it("includes body after frontmatter", () => {
    const parsed = matter(buildArticleMd(input));
    expect(parsed.content).toContain("## Heading");
    expect(parsed.content).toContain("Body text here.");
  });

  it("omits featuredImage when not provided", () => {
    const noImage = { ...input, featuredImage: undefined };
    const parsed = matter(buildArticleMd(noImage));
    expect(parsed.data.featuredImage).toBeUndefined();
  });

  it("preserves slug exactly", () => {
    const slugs = [
      "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
      "best-thriller-movies-2026",
    ];
    for (const slug of slugs) {
      const parsed = matter(buildArticleMd({ ...input, slug }));
      expect(parsed.data.slug).toBe(slug);
    }
  });
});
