import { describe, it, expect, vi, beforeEach } from "vitest";
import { runContentGeneration, ensureTopicTag } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

// Mock aggregator module
vi.mock("../agents/content-generation/aggregator.js", () => ({
  fetchWithFallback: vi.fn().mockResolvedValue([
    {
      url: "https://example.com/test-article",
      title: "Test Article",
      source: "https://rss.app/feeds/test.xml",
      image_url: "https://img.com/hero.jpg",
      published_date: "2026-03-30T10:00:00Z",
      vertical: "Tech",
      audience_type: "Adult 25-44",
      content_format: "Opinion",
      language: "EN",
      freshness: "This week",
      source_quality: "High",
    },
  ]),
  filterByRelevance: vi.fn().mockImplementation((articles: unknown[]) => articles),
  scrapeSourceContent: vi.fn().mockResolvedValue({
    textBody: "Article content here.",
    featuredImageUrl: null,
    inlineImages: [],
    youtubeEmbeds: [],
  }),
}));

vi.mock("../lib/site-brief.js", () => ({
  readSiteBrief: vi.fn().mockResolvedValue({
    domain: "coolnews.dev",
    siteName: "CoolNews",
    group: "premium-ads",
    brief: {
      audience: "Tech readers",
      tone: "Conversational",
      article_types: { standard: 100 },
      topics: ["AI"],
      seo_keywords_focus: ["tech"],
      content_guidelines: ["Be clear"],
      review_percentage: 0,
      schedule: { articles_per_week: 3, preferred_days: [], preferred_time: "10:00" },
      vertical: "Tech",
      audience_type: "Adult 25-44",
      language: "EN",
    },
  }),
}));

vi.mock("../lib/ai.js", () => ({
  generateContent: vi.fn().mockResolvedValue(
    JSON.stringify({
      title: "Generated Title",
      slug: "generated-title",
      description: "A description.",
      type: "standard",
      tags: ["AI", "tech"],
      body: "Generated article body.",
    }),
  ),
}));

vi.mock("../lib/writer.js", () => ({
  writeArticle: vi.fn().mockResolvedValue(undefined),
  writeAsset: vi.fn().mockResolvedValue(undefined),
  writeArticleBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/gemini.js", () => ({
  generateImageWithGemini: vi.fn().mockResolvedValue(null),
}));

vi.mock("../agents/content-quality/scorer.js", () => ({
  scoreArticle: vi.fn().mockResolvedValue({
    overallScore: 82,
    breakdown: {
      seo_quality: 85,
      tone_match: 90,
      content_length: 75,
      factual_accuracy: 80,
      keyword_relevance: 80,
    },
    note: "Good quality article with strong tone match.",
  }),
  resolveStatus: vi.fn().mockImplementation((score: number, threshold?: number) => {
    const t = threshold ?? 75;
    return score >= t ? "published" : "review";
  }),
}));

// Mock duplicate check — no existing articles
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

const config: AgentConfig = {
  github: { token: "token", repo: "owner/repo" },
  networkRepo: "owner/repo",
  localNetworkPath: "/tmp/network",
  geminiApiKey: undefined,
  contentAggregatorUrl: "https://content-aggregator-cloudgrid.apps.cloudgrid.io",
  port: 8080,
  notifications: {},
};

describe("runContentGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns batch result with created status", async () => {
    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    expect(result.siteDomain).toBe("coolnews.dev");
    expect(result.requested).toBe(3);
    expect(result.totalSourced).toBe(1);
    expect(result.duplicateCount).toBe(0);
    expect(result.availableNew).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("created");
    expect(result.results[0]!.slug).toBe("generated-title");
    expect(result.results[0]!.path).toContain("coolnews.dev/articles/generated-title.md");
  });

  it("returns skipped when all source URLs already exist", async () => {
    const { readdir, readFile } = await import("node:fs/promises");

    // First call: readdir for getAllExistingArticles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(readdir).mockResolvedValueOnce(["existing.md"] as any);
    // First readFile: site.yaml for getSiteBrief (empty → falls through to mock)
    vi.mocked(readFile).mockResolvedValueOnce("");
    // Second readFile: existing.md for getAllExistingArticles (gray-matter format)
    vi.mocked(readFile).mockResolvedValueOnce(
      `---\ntitle: Test Article\nsource_url: https://example.com/test-article\n---\nBody`,
    );

    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("skipped");
    expect(result.results[0]!.reason).toBe("all articles already processed");
    expect(result.duplicateCount).toBe(1);
    expect(result.availableNew).toBe(0);
  });

  it("respects count parameter to limit articles", async () => {
    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev", count: 1 },
      config,
    );

    expect(result.requested).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.status).toBe("created");
  });

  it("sets status based on quality score vs threshold", async () => {
    const { writeArticleBatch } = await import("../lib/writer.js");

    await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    const batchCall = vi.mocked(writeArticleBatch).mock.calls[0];
    const articles = batchCall?.[1] ?? [];
    const writtenContent = articles[0]?.content ?? "";
    // Mock scorer returns 82, default threshold is 75 → published
    expect(writtenContent).toContain("status: published");
  });

  it("includes quality score in frontmatter", async () => {
    const { writeArticleBatch } = await import("../lib/writer.js");

    await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    const batchCall = vi.mocked(writeArticleBatch).mock.calls[0];
    const articles = batchCall?.[1] ?? [];
    const writtenContent = articles[0]?.content ?? "";
    expect(writtenContent).toContain("quality_score: 82");
    expect(writtenContent).toContain("quality_note:");
  });

  it("includes quality score in result", async () => {
    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    expect(result.results[0]!.qualityScore).toBe(82);
    expect(result.results[0]!.articleStatus).toBe("published");
  });

  it("flags article for review when score is below threshold", async () => {
    const { resolveStatus: resolveStatusMock } = await import("../agents/content-quality/scorer.js");
    vi.mocked(resolveStatusMock).mockReturnValueOnce("review");

    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev" },
      config,
    );

    expect(result.results[0]!.articleStatus).toBe("review");
  });
});

describe("ensureTopicTag", () => {
  it("returns tags unchanged when a tag already matches a topic", () => {
    const result = ensureTopicTag(["AI", "machine learning"], ["AI", "gadgets"], "Some Title");
    expect(result).toEqual(["AI", "machine learning"]);
  });

  it("matches topics case-insensitively", () => {
    const result = ensureTopicTag(["ai", "deep learning"], ["AI", "gadgets"], "Some Title");
    expect(result).toEqual(["ai", "deep learning"]);
  });

  it("prepends matching topic when title contains a topic keyword", () => {
    const result = ensureTopicTag(["deep learning", "neural nets"], ["AI", "gadgets"], "New AI Model Released");
    expect(result).toEqual(["AI", "deep learning", "neural nets"]);
  });

  it("prepends matching topic found in existing tags", () => {
    const result = ensureTopicTag(["cool gadgets", "reviews"], ["AI", "gadgets"], "Best Devices of 2026");
    expect(result).toEqual(["gadgets", "cool gadgets", "reviews"]);
  });

  it("falls back to first topic when no match found", () => {
    const result = ensureTopicTag(["sports", "football"], ["AI", "gadgets"], "Big Game Tonight");
    expect(result).toEqual(["AI", "sports", "football"]);
  });

  it("handles empty generated tags by prepending first topic", () => {
    const result = ensureTopicTag([], ["AI", "gadgets"], "Some Title");
    expect(result).toEqual(["AI"]);
  });

  it("returns generated tags unchanged when topics array is empty", () => {
    const result = ensureTopicTag(["tech", "news"], [], "Some Title");
    expect(result).toEqual(["tech", "news"]);
  });
});
