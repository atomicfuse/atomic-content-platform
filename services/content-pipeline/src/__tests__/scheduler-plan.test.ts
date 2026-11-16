import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowProducer } from "bullmq";
import {
  enqueueSchedulerPlan,
  planSchedulerRun,
  runScheduledPublish,
} from "../agents/scheduled-publisher/index.js";
import type { SchedulerPlanQueueLike } from "../agents/scheduled-publisher/index.js";
import type { QueueInstances } from "../queue/index.js";
import type { SchedulerPlanData } from "../queue/types.js";

const mockReadFile = vi.fn();
const mockListActiveSites = vi.fn();
const mockReadSiteBriefWithFallback = vi.fn();
const mockCreateSchedulerFlow = vi.fn();

vi.mock("../lib/github.js", () => ({
  createOctokit: (): unknown => ({}),
  readFile: (_o: unknown, _r: unknown, p: unknown): unknown => mockReadFile(p),
}));

vi.mock("../lib/site-brief.js", () => ({
  listActiveSites: (): unknown => mockListActiveSites(),
  readSiteBriefWithFallback: (_o: unknown, _r: unknown, d: unknown, b: unknown): unknown =>
    mockReadSiteBriefWithFallback(d, b),
}));

vi.mock("../queue/scheduler-flow.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../queue/scheduler-flow.js")>()),
  createSchedulerFlow: (...args: unknown[]): unknown => mockCreateSchedulerFlow(...args),
  buildRunId: (): string => "2026-11-16T07",
}));

function makeConfig(): Parameters<typeof runScheduledPublish>[0] {
  return {
    github: { token: "t", repo: "owner/repo" },
    networkRepo: "owner/repo",
    contentAggregatorUrl: "https://example.com",
    port: 5000,
    notifications: {},
  } as unknown as Parameters<typeof runScheduledPublish>[0];
}

function makeQueue(existing: unknown = undefined): SchedulerPlanQueueLike & {
  add: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
} {
  return {
    getJob: vi.fn().mockResolvedValue(existing),
    add: vi.fn().mockResolvedValue({ id: "job" }),
  };
}

const ALL_HOURS = `enabled: true\nrun_at_hours: [${Array.from({ length: 24 }, (_, i) => i).join(",")}]\ntimezone: UTC\n`;

function brief(schedule: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): unknown {
  return { data: { siteName: "S", brief: { topics: [], schedule }, ...extra }, branch: "staging/x" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runScheduledPublish — queue path returns immediately", () => {
  it("enqueues one plan job for the hour and does no per-site work in the request", async () => {
    mockReadFile.mockResolvedValue(ALL_HOURS);
    const queue = makeQueue();

    const result = await runScheduledPublish(makeConfig(), false, {
      schedulerPlanQueue: queue,
    } as unknown as QueueInstances);

    expect(result).toMatchObject({ status: "ok", queued: true, runId: "2026-11-16T07", triggered: [] });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "scheduler-plan",
      { runId: "2026-11-16T07", timezone: "UTC", forced: false },
      expect.objectContaining({ jobId: "scheduler-plan-2026-11-16T07" }),
    );
    expect(mockListActiveSites).not.toHaveBeenCalled();
    expect(mockReadSiteBriefWithFallback).not.toHaveBeenCalled();
  });

  it("reports alreadyQueued when this hour's plan job exists (duplicate tick / second Run now)", async () => {
    mockReadFile.mockResolvedValue(ALL_HOURS);
    const queue = makeQueue({ getState: vi.fn().mockResolvedValue("active"), remove: vi.fn() });

    const result = await runScheduledPublish(makeConfig(), true, {
      schedulerPlanQueue: queue,
    } as unknown as QueueInstances);

    expect(result.alreadyQueued).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.errors[0]?.domain).toBe("scheduler");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("does not enqueue anything when the hour gate is closed", async () => {
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: [99]\ntimezone: UTC\n");
    const queue = makeQueue();

    const result = await runScheduledPublish(makeConfig(), false, {
      schedulerPlanQueue: queue,
    } as unknown as QueueInstances);

    expect(result.skippedGlobal).toBe("hour_not_matched");
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("enqueueSchedulerPlan", () => {
  it("uses a deterministic per-hour jobId with retries", async () => {
    const queue = makeQueue();
    const data: SchedulerPlanData = { runId: "2026-11-16T07", timezone: "EST", forced: true };

    const out = await enqueueSchedulerPlan(queue, data);

    expect(out.alreadyQueued).toBe(false);
    const opts = queue.add.mock.calls[0]?.[2] as { jobId: string; attempts: number };
    expect(opts.jobId).toBe("scheduler-plan-2026-11-16T07");
    expect(opts.attempts).toBeGreaterThan(1);
  });

  it("replaces this hour's job when it failed, so Run now can retry after an outage", async () => {
    const failed = { getState: vi.fn().mockResolvedValue("failed"), remove: vi.fn().mockResolvedValue(undefined) };
    const queue = makeQueue(failed);

    const out = await enqueueSchedulerPlan(queue, { runId: "2026-11-16T07", timezone: "EST", forced: true });

    expect(out.alreadyQueued).toBe(false);
    expect(failed.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("keeps a waiting/active/completed job for this hour", async () => {
    for (const state of ["waiting", "active", "delayed", "completed"]) {
      const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
      const queue = makeQueue(existing);

      const out = await enqueueSchedulerPlan(queue, { runId: "2026-11-16T07", timezone: "EST", forced: false });

      expect(out.alreadyQueued).toBe(true);
      expect(existing.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });
});

describe("planSchedulerRun — runs inside the background job", () => {
  const flowProducer = {} as FlowProducer;
  const data: SchedulerPlanData = { runId: "2026-11-16T07", timezone: "UTC", forced: false };

  it("enqueues eligible sites and records why the others were skipped", async () => {
    mockListActiveSites.mockResolvedValue([
      { domain: "due", branch: "staging/due" },
      { domain: "noschedule", branch: "staging/noschedule" },
      { domain: "grid", branch: "staging/grid" },
      { domain: "broken", branch: "staging/broken" },
    ]);
    mockReadSiteBriefWithFallback.mockImplementation((domain: string) => {
      if (domain === "due") return Promise.resolve(brief({ articles_per_day: 2, preferred_days: [] }));
      if (domain === "noschedule") return Promise.resolve(brief(undefined));
      if (domain === "grid") return Promise.resolve(brief({ articles_per_day: 1 }, { themeTemplate: "grid" }));
      return Promise.reject(new Error("Expected file at sites/broken/site.yaml, got nothing"));
    });
    mockCreateSchedulerFlow.mockResolvedValue({ runId: data.runId, enqueued: 1 });

    const out = await planSchedulerRun(makeConfig(), data, flowProducer);

    expect(out.enqueued).toBe(1);
    const [, runId, tz, forced, sites, skipped] = mockCreateSchedulerFlow.mock.calls[0] as [
      unknown, string, string, boolean, Array<{ domain: string; count: number; branch: string }>, Array<{ domain: string; reason: string }>,
    ];
    expect(runId).toBe("2026-11-16T07");
    expect(tz).toBe("UTC");
    expect(forced).toBe(false);
    expect(sites).toEqual([expect.objectContaining({ domain: "due", count: 2, branch: "staging/x" })]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { domain: "noschedule", reason: "no publishing schedule" },
        { domain: "grid", reason: "grid template" },
        { domain: "broken", reason: "no brief configured" },
      ]),
    );
  });

  it("does not create a flow when no site is due", async () => {
    mockListActiveSites.mockResolvedValue([{ domain: "a", branch: "staging/a" }]);
    mockReadSiteBriefWithFallback.mockResolvedValue(brief(undefined));

    const out = await planSchedulerRun(makeConfig(), data, flowProducer);

    expect(out.enqueued).toBe(0);
    expect(mockCreateSchedulerFlow).not.toHaveBeenCalled();
  });

  it("treats a duplicate flow (already ran this hour) as done, not as a retryable failure", async () => {
    mockListActiveSites.mockResolvedValue([{ domain: "due", branch: "staging/due" }]);
    mockReadSiteBriefWithFallback.mockResolvedValue(brief({ articles_per_day: 1 }));
    mockCreateSchedulerFlow.mockRejectedValue(new Error("Job scheduler-run-2026-11-16T07 already exists"));

    const out = await planSchedulerRun(makeConfig(), data, flowProducer);

    expect(out.enqueued).toBe(0);
    expect(out.duplicate).toMatch(/already exists/);
  });

  it("throws when the site list cannot be read so the queue retries the job", async () => {
    mockListActiveSites.mockRejectedValue(new Error("GitHub 502"));

    await expect(planSchedulerRun(makeConfig(), data, flowProducer)).rejects.toThrow("GitHub 502");
  });

  it("checks sites concurrently rather than one at a time", async () => {
    const sites = Array.from({ length: 10 }, (_, i) => ({ domain: `s${i}`, branch: `staging/s${i}` }));
    mockListActiveSites.mockResolvedValue(sites);
    let inFlight = 0;
    let maxInFlight = 0;
    mockReadSiteBriefWithFallback.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return brief(undefined);
    });

    await planSchedulerRun(makeConfig(), data, flowProducer);

    expect(maxInFlight).toBeGreaterThan(1);
    expect(mockReadSiteBriefWithFallback).toHaveBeenCalledTimes(10);
  });
});
