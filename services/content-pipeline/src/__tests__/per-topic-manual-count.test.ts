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
      topics_v2: ["Celebrities", "Fashion", "Entertainment", "Movies", "Pop Culture"].map((name, i) => ({
        name,
        source: { type: "filter", category_ids: [`cat-${i}`], tag_ids: [] },
        schedule: { articles_per_week: 1, preferred_days: ["monday"] },
      })),
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

function itemsFor(category: string, nonEnglishFirst: boolean): unknown[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `${category}-item-${i}`,
    url: `https://example.com/${category}/${i}`,
    title: `${category} story ${i}`,
    description: "A story.",
    summary:
      "This is a detailed summary of the source item with enough content to pass the minimum length check for processing by the generation pipeline.",
    thumbnail: { url: "https://img.com/hero.jpg" },
    content_type: "article",
    vertical: null,
    categories: [{ name: "Pop Culture" }],
    tags: [{ name: "celebs" }],
    audience_types: [],
    source: { name: "Source" },
    published_at: "2026-10-01T10:00:00Z",
    // A non-English first item is skipped by processItem — a backup must replace it.
    language: nonEnglishFirst && i === 0 ? "FR" : "EN",
  }));
}

function serveTopics(nonEnglishFirst = false): void {
  mockGetContent.mockImplementation((params: { category_ids?: string[] }) => {
    const items = itemsFor(params.category_ids?.[0] ?? "none", nonEnglishFirst);
    return Promise.resolve({ items, total_count: items.length, total_returned: items.length, page: 1, page_size: 20, total_pages: 1 });
  });
}

function created(result: Awaited<ReturnType<typeof runContentGeneration>>): number {
  return result.results.filter((r) => r.status === "created").length;
}

describe("manual 'Generate N' across all topics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("splits the requested count across topics instead of 1 per topic", async () => {
    serveTopics();
    const result = await runContentGeneration({ siteDomain: "scoopella", bypassSchedule: true, count: 10 }, config);
    expect(created(result)).toBe(10);
  });

  it("never exceeds the requested count when it doesn't divide evenly", async () => {
    serveTopics();
    const result = await runContentGeneration({ siteDomain: "scoopella", bypassSchedule: true, count: 7 }, config);
    expect(created(result)).toBe(7);
  });

  it("replaces a skipped item with a backup candidate", async () => {
    serveTopics(true);
    const result = await runContentGeneration({ siteDomain: "scoopella", bypassSchedule: true, count: 5 }, config);
    expect(created(result)).toBe(5);
  });
});
