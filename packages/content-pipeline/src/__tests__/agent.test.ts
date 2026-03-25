import { describe, it, expect, vi, beforeEach } from "vitest";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

// Mock all external dependencies
vi.mock("../agents/content-generation/rss.js", () => ({
  fetchRss: vi.fn().mockResolvedValue("<rss/>"),
  parseRssFeed: vi.fn().mockReturnValue({
    title: "Test Article",
    link: "https://example.com/test",
    pubDate: "Wed, 25 Mar 2026 10:00:00 GMT",
    htmlContent: "<p>Content</p><img src='https://img.com/hero.jpg' />",
    enclosureUrl: undefined,
  }),
  parseHtmlContent: vi.fn().mockReturnValue({
    textBody: "Article content here.",
    featuredImageUrl: "https://img.com/hero.jpg",
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
    },
  }),
}));

vi.mock("../lib/ai.js", () => ({
  createAIClient: vi.fn(() => ({})),
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
}));

vi.mock("../lib/gemini.js", () => ({
  generateImageWithGemini: vi.fn().mockResolvedValue(null),
}));

// Mock duplicate check — no existing articles
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const config: AgentConfig = {
  github: { token: "token", repo: "owner/repo" },
  ai: { apiKey: "sk-test" },
  networkRepo: "owner/repo",
  localNetworkPath: "/tmp/network",
  geminiApiKey: undefined,
  port: 3001,
  notifications: {},
};

describe("runContentGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns created status with slug and path", async () => {
    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    expect(result.status).toBe("created");
    expect(result.slug).toBe("generated-title");
    expect(result.path).toContain("coolnews.dev/articles/generated-title.md");
  });

  it("returns skipped when source_url already exists", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(readdir).mockResolvedValueOnce(["existing.md"] as any);
    vi.mocked(readFile).mockResolvedValueOnce(
      `---\nsource_url: https://example.com/test\n---\nBody`,
    );

    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already exists");
  });

  it("sets status to published when review_percentage is 0", async () => {
    const { writeArticle } = await import("../lib/writer.js");

    await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    const writtenContent = vi.mocked(writeArticle).mock.calls[0]?.[3] ?? "";
    expect(writtenContent).toContain("status: published");
  });
});
