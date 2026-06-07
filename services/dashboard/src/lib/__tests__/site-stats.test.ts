import { describe, expect, it } from "vitest";

import { countArticleStats, mapRecentArticles } from "@/lib/site-stats";
import type { ArticleEntry } from "@/types/dashboard";

function entry(partial: Partial<ArticleEntry> & { slug: string }): ArticleEntry {
  return {
    title: partial.title ?? partial.slug,
    type: partial.type ?? "standard",
    status: partial.status ?? "draft",
    publishDate: partial.publishDate ?? "",
    ...partial,
  };
}

describe("mapRecentArticles", () => {
  it("sorts by publishDate descending", () => {
    const result = mapRecentArticles([
      entry({ slug: "a", publishDate: "2026-01-01" }),
      entry({ slug: "c", publishDate: "2026-03-01" }),
      entry({ slug: "b", publishDate: "2026-02-01" }),
    ]);
    expect(result.map((r) => r.slug)).toEqual(["c", "b", "a"]);
  });

  it("takes only the first N (default 5)", () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry({ slug: `s${i}`, publishDate: `2026-01-0${i + 1}` }),
    );
    const result = mapRecentArticles(entries);
    expect(result).toHaveLength(5);
    // Newest five (s7..s3)
    expect(result.map((r) => r.slug)).toEqual(["s7", "s6", "s5", "s4", "s3"]);
  });

  it("honors a custom N", () => {
    const entries = [
      entry({ slug: "a", publishDate: "2026-01-03" }),
      entry({ slug: "b", publishDate: "2026-01-02" }),
      entry({ slug: "c", publishDate: "2026-01-01" }),
    ];
    expect(mapRecentArticles(entries, 2).map((r) => r.slug)).toEqual(["a", "b"]);
  });

  it("maps quality_score → score, undefined → null", () => {
    const result = mapRecentArticles([
      entry({ slug: "scored", publishDate: "2026-01-02", score: 87 }),
      entry({ slug: "unscored", publishDate: "2026-01-01", score: undefined }),
    ]);
    expect(result[0]).toMatchObject({ slug: "scored", score: 87 });
    expect(result[1]).toMatchObject({ slug: "unscored", score: null });
  });

  it("passes through published/review/draft statuses", () => {
    const result = mapRecentArticles([
      entry({ slug: "p", publishDate: "2026-01-03", status: "published" }),
      entry({ slug: "r", publishDate: "2026-01-02", status: "review" }),
      entry({ slug: "d", publishDate: "2026-01-01", status: "draft" }),
    ]);
    expect(result.map((r) => r.status)).toEqual(["published", "review", "draft"]);
  });

  it("projects exactly the RecentArticle fields", () => {
    const [r] = mapRecentArticles([
      entry({
        slug: "x",
        title: "Title X",
        publishDate: "2026-01-01",
        status: "published",
        score: 50,
        featuredImage: "img.webp",
      }),
    ]);
    expect(r).toEqual({
      title: "Title X",
      score: 50,
      status: "published",
      slug: "x",
      publishDate: "2026-01-01",
    });
  });

  it("does not mutate the input array order", () => {
    const entries = [
      entry({ slug: "a", publishDate: "2026-01-01" }),
      entry({ slug: "b", publishDate: "2026-02-01" }),
    ];
    mapRecentArticles(entries);
    expect(entries.map((e) => e.slug)).toEqual(["a", "b"]);
  });
});

describe("countArticleStats", () => {
  it("counts only status === 'review' for reviewCount", () => {
    const result = countArticleStats([
      entry({ slug: "r1", status: "review", featuredImage: "custom.webp" }),
      entry({ slug: "r2", status: "review", featuredImage: "custom.webp" }),
      entry({ slug: "p", status: "published", featuredImage: "custom.webp" }),
      entry({ slug: "d", status: "draft", featuredImage: "custom.webp" }),
    ]);
    expect(result.reviewCount).toBe(2);
  });

  it("counts general images via the 'general-article' substring", () => {
    const result = countArticleStats([
      entry({ slug: "g1", featuredImage: "site-general-article-1.webp" }),
      entry({ slug: "g2", featuredImage: "site-general-article-2.webp" }),
      entry({ slug: "g3", featuredImage: "https://r2/foo/general-article.png" }),
      entry({ slug: "c1", featuredImage: "custom-hero.webp" }),
      entry({ slug: "c2", featuredImage: "another-custom.webp" }),
    ]);
    expect(result.generalImages).toBe(3);
  });

  it("treats a missing featuredImage as a general image (mirrors bulk-image)", () => {
    const result = countArticleStats([
      entry({ slug: "no-img", featuredImage: undefined }),
      entry({ slug: "custom", featuredImage: "custom-hero.webp" }),
    ]);
    expect(result.generalImages).toBe(1);
  });

  it("returns both 0 for an empty list", () => {
    expect(countArticleStats([])).toEqual({ reviewCount: 0, generalImages: 0 });
  });
});
