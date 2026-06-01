import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isGeneralImage,
  scanArticlesForGeneralImages,
  buildResponse,
  getBulkJobStatus,
  startBulkImageGeneration,
  SiteNotFoundError,
  type ScanResult,
} from "../agents/content-generation/bulk-image.js";
import type { AgentConfig } from "../lib/config.js";

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("../lib/github.js", () => {
  const mock = vi.fn(() => ({ _mock: "octokit" }));
  return {
    createOctokit: mock,
    createGitHubClient: mock,
    readFile: vi.fn(),
    listFiles: vi.fn(),
  };
});

vi.mock("../lib/site-brief.js", () => ({
  listActiveSites: vi.fn(),
  readSiteBriefWithFallback: vi.fn(),
}));

vi.mock("../agents/content-generation/n8n-image.js", () => ({
  triggerN8nImage: vi.fn(),
}));

import { createOctokit, readFile, listFiles } from "../lib/github.js";
import { listActiveSites, readSiteBriefWithFallback } from "../lib/site-brief.js";
import { triggerN8nImage } from "../agents/content-generation/n8n-image.js";

// ── Fixtures ───────────────────────────────────────────────────────
const fakeConfig: AgentConfig = {
  github: { token: "ghp_test", repo: "atomicfuse/atomic-labs-network" },
  networkRepo: "atomicfuse/atomic-labs-network",
  localNetworkPath: undefined,
  geminiApiKey: undefined,
  contentAggregatorUrl: "",
  port: 5000,
  n8nImageWebhookUrl: "https://n8n.example.com/webhook/test",
  imageCallbackUrl: "https://example.com/api/agent/image-callback",
  bulkImageApiKey: "test-api-key",
  notifications: {},
};

const articleWithGeneralImage = [
  "---",
  "title: Best Travel Gear 2026",
  "slug: best-travel-gear-2026",
  "description: A guide to travel gear",
  "featuredImage: /assets/images/travelswire-general-article.webp",
  "---",
  "",
  "Article body content here for summary extraction.",
].join("\n");

const articleWithRealImage = [
  "---",
  "title: Wine Regions of France",
  "slug: wine-regions-france",
  "description: Explore French wine regions",
  "featuredImage: /assets/images/wine-regions-france.webp",
  "---",
  "",
  "Body text about wine.",
].join("\n");

const articleWithNoImage = [
  "---",
  "title: No Image Article",
  "slug: no-image-article",
  "description: This article has no featured image",
  "---",
  "",
  "Body without image.",
].join("\n");

const articleWithNoTitle = [
  "---",
  "slug: no-title-article",
  "featuredImage: /assets/images/travelswire-general-article.webp",
  "---",
  "",
  "Body text.",
].join("\n");

// ── isGeneralImage ─────────────────────────────────────────────────
describe("isGeneralImage", () => {
  it("returns true when featuredImage is undefined", () => {
    expect(isGeneralImage(undefined, "travelswire")).toBe(true);
  });

  it("returns true when featuredImage is empty string", () => {
    expect(isGeneralImage("", "travelswire")).toBe(true);
  });

  it("returns true when featuredImage contains domain-general-article", () => {
    expect(
      isGeneralImage("/assets/images/travelswire-general-article.webp", "travelswire"),
    ).toBe(true);
  });

  it("returns true when featuredImage contains general-article without domain", () => {
    expect(isGeneralImage("/assets/images/general-article.webp", "travelswire")).toBe(true);
  });

  it("returns false when featuredImage is a real article image", () => {
    expect(
      isGeneralImage("/assets/images/best-travel-gear-2026.webp", "travelswire"),
    ).toBe(false);
  });

  it("returns false when featuredImage is an external URL", () => {
    expect(isGeneralImage("https://cdn.example.com/photo.jpg", "travelswire")).toBe(false);
  });
});

// ── scanArticlesForGeneralImages ───────────────────────────────────
describe("scanArticlesForGeneralImages", () => {
  beforeEach(() => {
    vi.mocked(createOctokit).mockReturnValue({ _mock: "octokit" } as never);
    vi.mocked(listActiveSites).mockResolvedValue([
      { domain: "travelswire", branch: "staging/travelswire", status: "live" },
    ]);
    vi.mocked(listFiles).mockResolvedValue([
      "best-travel-gear-2026.md",
      "wine-regions-france.md",
    ]);
    vi.mocked(readFile).mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path.includes("best-travel-gear")) return articleWithGeneralImage;
      if (path.includes("wine-regions")) return articleWithRealImage;
      throw new Error("not found");
    });
  });

  it("returns articles with general images and skips those with real images", async () => {
    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]!.slug).toBe("best-travel-gear-2026");
    expect(result.articles[0]!.branch).toBe("staging/travelswire");
    expect(result.skipped).toHaveLength(0);
  });

  it("includes articles with no featuredImage field", async () => {
    vi.mocked(listFiles).mockResolvedValue(["no-image-article.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithNoImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]!.slug).toBe("no-image-article");
  });

  it("skips articles missing title", async () => {
    vi.mocked(listFiles).mockResolvedValue(["no-title-article.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithNoTitle);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe("missing title");
  });

  it("throws SiteNotFoundError for unknown domain", async () => {
    vi.mocked(listActiveSites).mockResolvedValue([]);

    await expect(
      scanArticlesForGeneralImages(fakeConfig, "site", "nonexistent"),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("requires domain when scope is site", async () => {
    await expect(
      scanArticlesForGeneralImages(fakeConfig, "site"),
    ).rejects.toThrow("domain is required");
  });

  it("scans all sites when scope is all", async () => {
    vi.mocked(listActiveSites).mockResolvedValue([
      { domain: "travelswire", branch: "staging/travelswire", status: "live" },
      { domain: "wineoceans", branch: "staging/wineoceans", status: "live" },
    ]);
    vi.mocked(listFiles).mockResolvedValue(["best-travel-gear-2026.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithGeneralImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "all");

    expect(result.articles).toHaveLength(2);
  });

  it("falls back to main branch when staging branch fails", async () => {
    vi.mocked(listFiles)
      .mockRejectedValueOnce(new Error("branch not found"))
      .mockResolvedValueOnce(["best-travel-gear-2026.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithGeneralImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]!.branch).toBe("main");
  });
});

// ── buildResponse ──────────────────────────────────────────────────
describe("buildResponse", () => {
  it("calculates batch info correctly", () => {
    const scan: ScanResult = {
      articles: Array.from({ length: 10 }, (_, i) => ({
        domain: "travelswire",
        slug: `article-${i}`,
        title: `Article ${i}`,
        description: `Description ${i}`,
        summary: `Summary ${i}`,
        branch: "staging/travelswire",
      })),
      skipped: [{ domain: "travelswire", slug: "bad", reason: "missing title" }],
    };

    const response = buildResponse({ scope: "site", domain: "travelswire" }, scan);

    expect(response.queued).toBe(10);
    expect(response.skipped).toBe(1);
    expect(response.batch_size).toBe(3);
    expect(response.batch_pause_seconds).toBe(180);
    expect(response.total_batches).toBe(4);
    expect(response.estimated_total_seconds).toBe(540);
    expect(response.articles).toHaveLength(10);
    expect(response.dry_run).toBe(false);
  });

  it("returns 0 estimated time for empty queue", () => {
    const response = buildResponse(
      { scope: "site", domain: "travelswire", dry_run: true },
      { articles: [], skipped: [] },
    );

    expect(response.queued).toBe(0);
    expect(response.total_batches).toBe(0);
    expect(response.estimated_total_seconds).toBe(0);
    expect(response.dry_run).toBe(true);
  });
});

// ── concurrency guard + startBulkImageGeneration ───────────────────
describe("getBulkJobStatus", () => {
  it("returns not in progress by default", () => {
    const status = getBulkJobStatus();
    expect(status.inProgress).toBe(false);
    expect(status.remaining).toBe(0);
  });
});

describe("startBulkImageGeneration", () => {
  beforeEach(() => {
    vi.mocked(triggerN8nImage).mockResolvedValue(true);
    vi.mocked(readSiteBriefWithFallback).mockResolvedValue({
      data: {
        domain: "travelswire",
        siteName: "TravelsWire",
        group: "travel",
        brief: { vertical: "Travel" } as never,
      },
      branch: "staging/travelswire",
    });
  });

  it("does nothing for empty article list", () => {
    startBulkImageGeneration(fakeConfig, []);
    expect(getBulkJobStatus().inProgress).toBe(false);
  });

  it("sets concurrency guard when started", () => {
    const articles = [
      {
        domain: "travelswire",
        slug: "test-article",
        title: "Test",
        description: "Desc",
        summary: "Sum",
        branch: "staging/travelswire",
      },
    ];

    startBulkImageGeneration(fakeConfig, articles);

    const status = getBulkJobStatus();
    expect(status.inProgress).toBe(true);
    expect(status.remaining).toBe(1);
    expect(status.totalBatches).toBe(1);
  });
});
