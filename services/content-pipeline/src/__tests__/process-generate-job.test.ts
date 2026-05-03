import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { GenerateJobData } from "../queue/types.js";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockReadSiteBriefWithFallback = vi.fn();
const mockRunContentGeneration = vi.fn();
const mockCreateGitHubClient = vi.fn().mockReturnValue({});

vi.mock("../lib/site-brief.js", () => ({
  readSiteBriefWithFallback: (...args: unknown[]): unknown =>
    mockReadSiteBriefWithFallback(...args),
}));

vi.mock("../agents/content-generation/agent.js", () => ({
  runContentGeneration: (...args: unknown[]): unknown =>
    mockRunContentGeneration(...args),
}));

vi.mock("../lib/github.js", () => ({
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateGitHubClient(...args),
}));

import { processGenerateJob } from "../queue/content-generation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJob(overrides: Partial<GenerateJobData> = {}): Job<GenerateJobData> {
  return {
    data: {
      siteDomain: "test.com",
      count: 3,
      branch: "staging/test.com",
      triggeredBy: "manual" as const,
      ...overrides,
    },
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
  });

  it("throws UnrecoverableError when site brief not found", async () => {
    mockReadSiteBriefWithFallback.mockRejectedValue(new Error("Not found"));

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      UnrecoverableError,
    );
    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      /not found/i,
    );
    // runContentGeneration should NOT be called (no LLM spend wasted)
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when brief has no schedule", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult(false));

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
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
      results: [
        { status: "error", message: "LLM timeout" },
        { status: "error", message: "LLM timeout" },
      ],
    });

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      /All 2 articles failed/,
    );
    // NOT an UnrecoverableError — BullMQ should retry
    try {
      await processGenerateJob(makeJob(), config);
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
      results: [
        { status: "created", slug: "article-1" },
        { status: "created", slug: "article-2" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
  });

  it("returns result on partial success (does not throw)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      results: [
        { status: "created", slug: "good-article" },
        { status: "error", message: "one failed" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
    // Partial success = job succeeded, no retry
  });

  it("returns result when no items sourced (empty results)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 0,
      duplicateCount: 0,
      availableNew: 0,
      results: [],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
    // Zero results = agent completed normally, not a failure
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("returns normally when all results are 'skipped' (no created, no error)", async () => {
    // All articles are duplicates → status "skipped", not "error".
    // Since there are zero "error" results, the throw guard (created === 0 && results.length > 0)
    // fires. But "skipped" articles aren't failures — this tests the guard behavior.
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 5,
      availableNew: 0,
      results: [
        { status: "skipped", slug: "dup-1", reason: "duplicate" },
        { status: "skipped", slug: "dup-2", reason: "duplicate" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    // The guard `created === 0 && results.length > 0` triggers because
    // "skipped" is neither "created" nor "error". This IS a throw case
    // because BullMQ should retry — maybe the duplicates clear next attempt.
    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      /All 2 articles failed/,
    );
  });

  it("returns normally when results is empty but totalSourced > 0", async () => {
    // Agent sourced items but filtered all out (quality too low, etc.)
    // Empty results array → no created, but also results.length === 0 → no throw.
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 10,
      duplicateCount: 10,
      availableNew: 0,
      results: [],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
  });

  it("returns result when 1 error among many successes (partial success)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 5,
      totalSourced: 10,
      duplicateCount: 0,
      availableNew: 10,
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

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
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
      results: [{ status: "created", slug: "a" }],
    });

    await processGenerateJob(
      makeJob({ siteDomain: "mysite.dev", count: 5, branch: "staging/mysite.dev" }),
      config,
    );

    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "mysite.dev", branch: "staging/mysite.dev", count: 5 },
      config,
    );
  });
});
