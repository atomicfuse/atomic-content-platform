import { describe, it, expect, vi, beforeEach } from "vitest";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

// Aggregator mock — behavior is configured per-test via mockGetContent.
const mockGetContent = vi.fn();
vi.mock("../agents/content-generation/api-client.js", () => ({
  getContent: (...args: unknown[]) => mockGetContent(...args),
  getSettings: vi.fn().mockResolvedValue({
    classification: { factual_tags: [] },
    enrichment: { batch_size: 20 },
  }),
  resolveTopicTagIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/site-brief.js", () => ({
  readSiteBrief: vi.fn().mockResolvedValue({
    domain: "giantsavings",
    siteName: "Giant Savings",
    group: "premium-ads",
    brief: {
      audience: "Deal hunters",
      tone: "Practical",
      article_types: { standard: 100 },
      topics: ["Saving Tips"],
      topics_v2: [
        {
          name: "Saving Tips",
          source: {
            type: "filter",
            category_ids: ["cat-finance"],
            tag_ids: ["tag-wrong-vertical"],
          },
          schedule: { articles_per_week: 3, preferred_days: [] },
        },
      ],
      seo_keywords_focus: ["savings"],
      content_guidelines: ["Be clear"],
      review_percentage: 0,
      schedule: { articles_per_week: 3, preferred_days: [], preferred_time: "10:00" },
      vertical: "Personal Finance",
      audience_type: "Adult 25-44",
      language: "EN",
    },
  }),
}));

vi.mock("../lib/ai.js", () => ({
  generateContent: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      title: "Generated Title",
      slug: "generated-title",
      description: "A description.",
      type: "standard",
      tags: ["savings"],
      body: "This is a generated article body with enough words to pass the minimum word count validation check that requires at least fifty words in the article body content before it can be accepted by the content generation pipeline quality gate for further processing and final publication on the target site.",
    }),
    usage: { inputTokens: 200, outputTokens: 800, estimated: false },
  }),
}));

vi.mock("../lib/writer.js", () => ({
  writeArticle: vi.fn().mockResolvedValue(undefined),
  writeAsset: vi.fn().mockResolvedValue(undefined),
  writeArticleBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../agents/content-generation/n8n-image.js", () => ({
  requestImageFromN8n: vi.fn().mockResolvedValue({ ok: false, reason: "disabled-in-test" }),
  processN8nImageResult: vi.fn().mockResolvedValue(undefined),
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
    note: "Good quality.",
  }),
  resolveStatus: vi.fn().mockReturnValue("published"),
}));

vi.mock("../stats/topic-rotation.js", () => ({
  loadTopicRotation: vi.fn().mockResolvedValue(null),
  saveTopicRotation: vi.fn().mockResolvedValue(undefined),
}));

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
  contentAggregatorUrl: "https://content-aggregator-v2-34cd--atomic.cloudgrid.io",
  port: 8080,
  notifications: {},
};

const ITEM = {
  id: "item-broad-1",
  url: "https://example.com/coupon-hacks",
  title: "Coupon Hacks",
  description: "Coupon hacks.",
  summary:
    "This is a detailed summary of the source item with enough content to pass the minimum length check for processing by the generation pipeline.",
  thumbnail: { url: "https://img.com/hero.jpg" },
  content_type: "article",
  vertical: { name: "Personal Finance" },
  categories: [{ name: "Personal Finance" }],
  tags: [{ name: "coupons" }],
  audience_types: [{ name: "Adult 25-44" }],
  source: { name: "DealsNews" },
  published_at: "2026-07-01T10:00:00Z",
  language: "EN",
};

const EMPTY_PAGE = {
  items: [],
  total_count: 0,
  total_returned: 0,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const FULL_PAGE = { ...EMPTY_PAGE, items: [ITEM], total_count: 1, total_returned: 1 };

describe("per-topic filter fallback — drop tags when the narrow query matches nothing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retries without tag_ids and generates from the broad result", async () => {
    // Narrow query (has tag_ids) → nothing; broad retry (no tag_ids) → 1 item.
    mockGetContent.mockImplementation((params: { tag_ids?: string[] }) =>
      Promise.resolve(params.tag_ids && params.tag_ids.length > 0 ? EMPTY_PAGE : FULL_PAGE),
    );

    const result = await runContentGeneration(
      { siteDomain: "giantsavings", bypassSchedule: true, count: 1 },
      config,
    );

    expect(result.results.some((r) => r.status === "created")).toBe(true);

    const calls = mockGetContent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const narrow = calls.filter((c) => Array.isArray(c.tag_ids) && (c.tag_ids as string[]).length > 0);
    const broad = calls.filter((c) => c.tag_ids === undefined && Array.isArray(c.category_ids));
    expect(narrow.length).toBeGreaterThan(0);
    expect(broad.length).toBeGreaterThan(0);
    // The broad retry must keep the topic's category filter.
    expect(broad[0]!.category_ids).toEqual(["cat-finance"]);
  });

  it("does not retry when the narrow query already produced items", async () => {
    mockGetContent.mockResolvedValue(FULL_PAGE);

    const result = await runContentGeneration(
      { siteDomain: "giantsavings", bypassSchedule: true, count: 1 },
      config,
    );

    expect(result.results.some((r) => r.status === "created")).toBe(true);
    const calls = mockGetContent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.every((c) => Array.isArray(c.tag_ids) && (c.tag_ids as string[]).length > 0)).toBe(
      true,
    );
  });

  it("reports a skip (not a crash) when both narrow and broad match nothing", async () => {
    mockGetContent.mockResolvedValue(EMPTY_PAGE);

    const result = await runContentGeneration(
      { siteDomain: "giantsavings", bypassSchedule: true, count: 1 },
      config,
    );

    expect(result.results[0]!.status).toBe("skipped");
  });
});
