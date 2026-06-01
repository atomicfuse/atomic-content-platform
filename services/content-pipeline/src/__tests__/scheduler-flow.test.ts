import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFlowProducerAdd = vi.fn();
const mockGetChildrenValues = vi.fn();
const mockReadHistory = vi.fn();
const mockCommitFile = vi.fn();
const mockCreateOctokit = vi.fn().mockReturnValue({});

vi.mock("bullmq", () => ({
  FlowProducer: vi.fn().mockImplementation(() => ({
    add: (...args: unknown[]): unknown => mockFlowProducerAdd(...args),
  })),
  Queue: vi.fn(),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  QueueEvents: vi.fn(),
  UnrecoverableError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "UnrecoverableError";
    }
  },
}));

vi.mock("../lib/github.js", () => ({
  createOctokit: (...args: unknown[]): unknown =>
    mockCreateOctokit(...args),
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateOctokit(...args),
  readFile: (...args: unknown[]): unknown => mockReadHistory(...args),
  commitFile: (...args: unknown[]): unknown => mockCommitFile(...args),
}));

import {
  createSchedulerFlow,
  processSchedulerRun,
  buildRunId,
} from "../queue/scheduler-flow.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("buildRunId", () => {
  it("returns ISO string truncated to hour", () => {
    const id = buildRunId();
    // Format: "2026-05-03T14" (13 chars)
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});

describe("createSchedulerFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlowProducerAdd.mockResolvedValue({ job: { id: "parent-1" } });
  });

  it("creates a flow with parent + N children", async () => {
    const sites = [
      { domain: "alpha.com", branch: "staging/alpha.com", count: 3 },
      { domain: "beta.com", branch: "staging/beta.com", count: 2 },
    ];

    const result = await createSchedulerFlow(
      { add: mockFlowProducerAdd } as unknown as import("bullmq").FlowProducer,
      "2026-05-03T14",
      "UTC",
      false,
      sites,
      [],
    );

    expect(mockFlowProducerAdd).toHaveBeenCalledTimes(1);
    const call = mockFlowProducerAdd.mock.calls[0]!;
    const flowDef = call[0] as Record<string, unknown>;
    expect(flowDef.name).toBe("scheduler-run");
    expect(flowDef.queueName).toBe("scheduler-run");

    // Parent data
    const parentData = (flowDef.data as Record<string, unknown>);
    expect(parentData.runId).toBe("2026-05-03T14");
    expect(parentData.forced).toBe(false);
    expect(parentData.enqueuedDomains).toEqual(["alpha.com", "beta.com"]);

    // Children
    const children = flowDef.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    expect((children[0]!.data as Record<string, string>).siteDomain).toBe("alpha.com");
    expect((children[1]!.data as Record<string, string>).siteDomain).toBe("beta.com");
  });

  it("uses deterministic jobId to prevent double-enqueue", async () => {
    await createSchedulerFlow(
      { add: mockFlowProducerAdd } as unknown as import("bullmq").FlowProducer,
      "2026-05-03T14",
      "UTC",
      false,
      [{ domain: "a.com", branch: "staging/a.com", count: 1 }],
      [],
    );

    const call = mockFlowProducerAdd.mock.calls[0]!;
    const flowDef = call[0] as Record<string, unknown>;
    const opts = flowDef.opts as Record<string, unknown>;
    expect(opts.jobId).toBe("scheduler-run-2026-05-03T14");
  });

  it("includes skipped sites in parent data", async () => {
    const skipped = [
      { domain: "skip.com", reason: "no schedule" },
    ];

    await createSchedulerFlow(
      { add: mockFlowProducerAdd } as unknown as import("bullmq").FlowProducer,
      "2026-05-03T14",
      "UTC",
      false,
      [],
      skipped,
    );

    const call = mockFlowProducerAdd.mock.calls[0]!;
    const parentData = ((call[0] as Record<string, unknown>).data as Record<string, unknown>);
    expect(parentData.skipped).toEqual(skipped);
  });
});

describe("processSchedulerRun", () => {
  const config = makeConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadHistory.mockRejectedValue(new Error("Not Found"));
    mockCommitFile.mockResolvedValue("sha-ok");
  });

  it("writes history entry with child results", async () => {
    // Children return BatchContentGenerationResult, not SiteRunResult.
    // The parent processor maps these to SiteRunResult internally.
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "alpha.com",
        requested: 3,
        totalSourced: 5,
        duplicateCount: 2,
        availableNew: 3,
        results: [
          { status: "created", slug: "a" },
          { status: "created", slug: "b" },
          { status: "created", slug: "c" },
        ],
      },
      "bull:content-generation:child-2": {
        siteDomain: "beta.com",
        requested: 2,
        totalSourced: 3,
        duplicateCount: 1,
        availableNew: 2,
        results: [
          { status: "error", slug: "x", message: "LLM timeout" },
          { status: "error", slug: "y", message: "rate limited" },
        ],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T14",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["alpha.com", "beta.com"],
        skipped: [{ domain: "gamma.com", reason: "no schedule" }],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    expect(mockCommitFile).toHaveBeenCalledTimes(1);
    const commitArg = mockCommitFile.mock.calls[0]![2] as {
      content: string;
      path: string;
    };
    expect(commitArg.path).toBe("scheduler/history.json");

    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string }>;
      skipped: Array<{ domain: string }>;
      timestamp: string;
    }>;
    expect(written).toHaveLength(1);
    expect(written[0]!.timestamp).toBe("2026-05-03T14");
    expect(written[0]!.sites).toHaveLength(2);
    // alpha.com: 3 created, 0 errors → "success"
    expect(written[0]!.sites[0]!.domain).toBe("alpha.com");
    expect(written[0]!.sites[0]!.status).toBe("success");
    // beta.com: 0 created, 2 errors → "error"
    expect(written[0]!.sites[1]!.domain).toBe("beta.com");
    expect(written[0]!.sites[1]!.status).toBe("error");
    expect(written[0]!.skipped).toHaveLength(1);
    expect(written[0]!.skipped[0]!.domain).toBe("gamma.com");
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("handles all children failed (empty getChildrenValues)", async () => {
    // All children crashed — getChildrenValues returns empty object
    mockGetChildrenValues.mockResolvedValue({});

    const job = {
      data: {
        runId: "2026-05-03T16",
        timezone: "EST",
        forced: true,
        enqueuedDomains: ["site-a.com", "site-b.com", "site-c.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string; message?: string }>;
    }>;
    // All 3 domains should be recorded as errors
    expect(written[0]!.sites).toHaveLength(3);
    for (const site of written[0]!.sites) {
      expect(site.status).toBe("error");
      expect(site.message).toContain("failed");
    }
  });

  it("skips null child values gracefully", async () => {
    // BullMQ can return null for a child key in getChildrenValues
    const childrenValues = {
      "bull:content-generation:child-1": null,
      "bull:content-generation:child-2": {
        siteDomain: "real.com",
        requested: 1,
        totalSourced: 1,
        duplicateCount: 0,
        availableNew: 1,
        results: [{ status: "created", slug: "article-1" }],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T17",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["real.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string }>;
    }>;
    // Only real.com should appear (null entry skipped)
    expect(written[0]!.sites).toHaveLength(1);
    expect(written[0]!.sites[0]!.domain).toBe("real.com");
    expect(written[0]!.sites[0]!.status).toBe("success");
  });

  it("handles malformed history JSON (starts fresh)", async () => {
    // readFile returns garbage JSON
    mockReadHistory.mockResolvedValue("not valid json {{{");
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "ok.com",
        requested: 1,
        totalSourced: 1,
        duplicateCount: 0,
        availableNew: 1,
        results: [{ status: "created", slug: "a" }],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T18",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["ok.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    // JSON.parse of garbage throws, caught by catch → start fresh
    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as unknown[];
    // Should have exactly 1 entry (the new one)
    expect(written).toHaveLength(1);
  });

  it("caps history at MAX_ENTRIES (50)", async () => {
    // Existing history has 50 entries
    const existingHistory = Array.from({ length: 50 }, (_, i) => ({
      timestamp: `2026-05-0${(i % 9) + 1}T${String(i % 24).padStart(2, "0")}`,
      timezone: "UTC",
      forced: false,
      sites: [],
      skipped: [],
    }));
    mockReadHistory.mockResolvedValue(JSON.stringify(existingHistory));

    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "new.com",
        requested: 1,
        totalSourced: 1,
        duplicateCount: 0,
        availableNew: 1,
        results: [{ status: "created", slug: "new-article" }],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T20",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["new.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as unknown[];
    // Should still be 50, not 51 — oldest entry dropped
    expect(written).toHaveLength(50);
    // First entry should be the new one
    expect((written[0] as Record<string, unknown>).timestamp).toBe("2026-05-03T20");
  });

  it("propagates commitFile failure (parent job fails, BullMQ retries)", async () => {
    mockCommitFile.mockRejectedValue(new Error("GitHub API rate limited"));
    mockGetChildrenValues.mockResolvedValue({
      "bull:content-generation:child-1": {
        siteDomain: "x.com",
        requested: 1,
        totalSourced: 1,
        duplicateCount: 0,
        availableNew: 1,
        results: [{ status: "created", slug: "a" }],
      },
    });

    const job = {
      data: {
        runId: "2026-05-03T21",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["x.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await expect(
      processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config),
    ).rejects.toThrow("GitHub API rate limited");
  });

  it("maps child with partial success to 'partial' status", async () => {
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "mixed.com",
        requested: 5,
        totalSourced: 10,
        duplicateCount: 0,
        availableNew: 10,
        results: [
          { status: "created", slug: "a" },
          { status: "created", slug: "b" },
          { status: "error", message: "LLM timeout" },
          { status: "error", message: "rate limited" },
        ],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T22",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["mixed.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string; articlesCreated: number }>;
    }>;
    expect(written[0]!.sites[0]!.status).toBe("partial");
    expect(written[0]!.sites[0]!.articlesCreated).toBe(2);
  });

  it("maps child with all duplicates to 'no_content' status", async () => {
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "dupes.com",
        requested: 3,
        totalSourced: 5,
        duplicateCount: 5,
        availableNew: 0,
        results: [],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T23",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["dupes.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string; message?: string }>;
    }>;
    expect(written[0]!.sites[0]!.status).toBe("no_content");
    expect(written[0]!.sites[0]!.message).toContain("duplicates");
  });

  it("records permanently failed children as error in history", async () => {
    // Only alpha.com completed — delta.com's child job failed permanently
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "alpha.com",
        requested: 2,
        totalSourced: 3,
        duplicateCount: 1,
        availableNew: 2,
        results: [
          { status: "created", slug: "a" },
          { status: "created", slug: "b" },
        ],
      },
      // delta.com is NOT here — its child job permanently failed
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T15",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["alpha.com", "delta.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as unknown as import("bullmq").Job<import("../queue/types.js").SchedulerRunData>, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string; message?: string }>;
    }>;
    expect(written[0]!.sites).toHaveLength(2);
    // alpha.com completed successfully
    expect(written[0]!.sites[0]!.domain).toBe("alpha.com");
    expect(written[0]!.sites[0]!.status).toBe("success");
    // delta.com failed — recorded from enqueuedDomains diff
    expect(written[0]!.sites[1]!.domain).toBe("delta.com");
    expect(written[0]!.sites[1]!.status).toBe("error");
    expect(written[0]!.sites[1]!.message).toContain("failed");
  });
});
