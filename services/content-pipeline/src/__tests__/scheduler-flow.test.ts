import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFlowProducerAdd = vi.fn();
const mockGetChildrenValues = vi.fn();
const mockReadHistory = vi.fn();
const mockCommitFile = vi.fn();
const mockCreateGitHubClient = vi.fn().mockReturnValue({});

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
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateGitHubClient(...args),
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
