import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import type { GenerateJobData } from "../queue/types.js";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockReadSiteBriefWithFallback = vi.fn();
const mockRunContentGeneration = vi.fn();
const mockCreateOctokit = vi.fn().mockReturnValue({});
const mockWriteArticleBatch = vi.fn().mockResolvedValue(undefined);
const mockTriggerN8nImage = vi.fn().mockResolvedValue(true);
const mockTrackPendingImage = vi.fn();
const mockNotifyImageDefaultFallback = vi.fn().mockResolvedValue(undefined);

vi.mock("../lib/site-brief.js", () => ({
  readSiteBriefWithFallback: (...args: unknown[]): unknown =>
    mockReadSiteBriefWithFallback(...args),
}));

vi.mock("../agents/content-generation/agent.js", () => ({
  runContentGeneration: (...args: unknown[]): unknown =>
    mockRunContentGeneration(...args),
  normalizeUrl: (url: string) => url,
  normalizeTitleKey: (title: string) => title.toLowerCase(),
  dedupIndexPath: (domain: string) => `sites/${domain}/dedup-index.json`,
  serializeDedupIndex: () => "{}",
}));

vi.mock("../lib/github.js", () => ({
  createOctokit: (...args: unknown[]): unknown =>
    mockCreateOctokit(...args),
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateOctokit(...args),
  clearTreeCache: vi.fn(),
}));

vi.mock("../lib/writer.js", () => ({
  writeArticleBatch: (...args: unknown[]): unknown =>
    mockWriteArticleBatch(...args),
}));

vi.mock("../agents/content-generation/n8n-image.js", () => ({
  triggerN8nImage: (...args: unknown[]): unknown =>
    mockTriggerN8nImage(...args),
  trackPendingImage: (...args: unknown[]): unknown =>
    mockTrackPendingImage(...args),
}));

vi.mock("../lib/notifications.js", () => ({
  notifyImageDefaultFallback: (...args: unknown[]): unknown =>
    mockNotifyImageDefaultFallback(...args),
}));

import { processGenerateJob } from "../queue/content-generation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
} as unknown as Redis;

function makeJob(overrides: Partial<GenerateJobData> = {}): Job<GenerateJobData> {
  return {
    data: {
      siteDomain: "test.com",
      count: 3,
      branch: "staging/test.com",
      triggeredBy: "manual" as const,
      ...overrides,
    },
    attemptsMade: 0,
  } as Job<GenerateJobData>;
}

function makeConfig(): AgentConfig {
  return {
    github: { token: "ghp_test", repo: "owner/repo" },
    networkRepo: "owner/repo",
    localNetworkPath: undefined,
    geminiApiKey: undefined,
    contentAggregatorUrl: "https://example.com",
    port: 3001,
    redisUrl: "redis://localhost:6379",
    notifications: {},
  } as AgentConfig;
}

function makeBriefResult(hasSchedule = true): unknown {
  return {
    data: {
      domain: "test.com",
      siteName: "Test Site",
      group: "default",
      brief: {
        topics: ["tech"],
        ...(hasSchedule
          ? { schedule: { articles_per_day: 3, preferred_days: ["monday"] } }
          : {}),
      },
    },
    branch: "staging/test.com",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("processGenerateJob", () => {
  const config = makeConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue("OK");
    (mockRedis.del as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  });

  it("throws UnrecoverableError when site brief not found", async () => {
    mockReadSiteBriefWithFallback.mockRejectedValue(new Error("Not found"));

    await expect(processGenerateJob(makeJob(), config, mockRedis)).rejects.toThrow(
      UnrecoverableError,
    );
    await expect(processGenerateJob(makeJob(), config, mockRedis)).rejects.toThrow(
      /not found/i,
    );
    // runContentGeneration should NOT be called (no LLM spend wasted)
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when brief has no schedule", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult(false));

    await expect(processGenerateJob(makeJob(), config, mockRedis)).rejects.toThrow(
      UnrecoverableError,
    );
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  it("throws Error when all articles fail (triggers BullMQ retry)", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue({
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [
        { status: "error", message: "LLM timeout" },
        { status: "error", message: "LLM timeout" },
      ],
    });

    await expect(processGenerateJob(makeJob(), config, mockRedis)).rejects.toThrow(
      /All 2 article\(s\) failed for test\.com: LLM timeout/,
    );
    // NOT an UnrecoverableError — BullMQ should retry
    try {
      await processGenerateJob(makeJob(), config, mockRedis);
    } catch (err) {
      expect(err).not.toBeInstanceOf(UnrecoverableError);
    }
  });

  it("returns result on full success", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [
        { status: "created", slug: "article-1" },
        { status: "created", slug: "article-2" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(2);
    expect(result.siteDomain).toBe("test.com");
  });

  it("returns result on partial success (does not throw)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [
        { status: "created", slug: "good-article" },
        { status: "error", message: "one failed" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(2);
    // Partial success = job succeeded, no retry
  });

  it("returns result when no items sourced (empty results)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 0,
      duplicateCount: 0,
      availableNew: 0,
      n8nImagesTriggered: 0,
      results: [],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(0);
    // Zero results = agent completed normally, not a failure
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("returns normally when all results are 'skipped' (no created, no error)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 5,
      availableNew: 0,
      n8nImagesTriggered: 0,
      results: [
        { status: "skipped", slug: "dup-1", reason: "duplicate" },
        { status: "skipped", slug: "dup-2", reason: "duplicate" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(2);
  });

  it("returns normally when results is empty but totalSourced > 0", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 10,
      duplicateCount: 10,
      availableNew: 0,
      n8nImagesTriggered: 0,
      results: [],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(0);
  });

  it("returns result when 1 error among many successes (partial success)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 5,
      totalSourced: 10,
      duplicateCount: 0,
      availableNew: 10,
      n8nImagesTriggered: 0,
      results: [
        { status: "created", slug: "a1" },
        { status: "created", slug: "a2" },
        { status: "created", slug: "a3" },
        { status: "created", slug: "a4" },
        { status: "error", message: "LLM timeout" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results).toHaveLength(5);
    // 4 created > 0 → no throw, even though 1 failed
  });

  it("passes correct params to runContentGeneration", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue({
      siteDomain: "test.com",
      requested: 5,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [{ status: "created", slug: "a" }],
    });

    await processGenerateJob(
      makeJob({ siteDomain: "mysite.dev", count: 5, branch: "staging/mysite.dev" }),
      config,
      mockRedis,
    );

    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "mysite.dev", branch: "staging/mysite.dev", count: 5 }),
      config,
    );
  });

  // ---------------------------------------------------------------------------
  // Redis checkpoint / retry
  // ---------------------------------------------------------------------------

  it("uses cached results on retry (skips LLM)", async () => {
    const cachedResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [{ status: "created", slug: "cached-article" }],
    };
    (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(cachedResult));
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());

    const job = makeJob();
    (job as any).attemptsMade = 1;

    const result = await processGenerateJob(job, config, mockRedis);
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
  });

  it("cleans up Redis cache on success", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [{ status: "created", slug: "article-1" }],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    await processGenerateJob(makeJob(), config, mockRedis);
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it("strips _pendingArticle and _imageRequest from results", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      n8nImagesTriggered: 0,
      results: [
        {
          status: "created",
          slug: "article-1",
          _pendingArticle: { siteDomain: "test.com", slug: "article-1", content: "test" },
          _imageRequest: { requestId: "img_123", siteDomain: "test.com", slug: "article-1" },
        },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config, mockRedis);
    expect(result.results[0]).not.toHaveProperty("_pendingArticle");
    expect(result.results[0]).not.toHaveProperty("_imageRequest");
    expect(result.results[0]!.slug).toBe("article-1");
  });
});
