import { describe, it, expect, vi } from "vitest";
import { getActiveRunState } from "../queue/active-run.js";

type Job = { data: { runId?: string } };

function queues(opts: {
  parentActive?: Job[];
  parentWaiting?: Job[];
  parentWaitingChildren?: Job[];
  genActive?: Job[];
  genWaiting?: Job[];
  genCompleted?: Job[];
  genFailed?: Job[];
}) {
  return {
    schedulerRunQueue: {
      getActive: vi.fn(async () => opts.parentActive ?? []),
      getWaiting: vi.fn(async () => opts.parentWaiting ?? []),
      getWaitingChildren: vi.fn(async () => opts.parentWaitingChildren ?? []),
    },
    generateQueue: {
      getActive: vi.fn(async () => opts.genActive ?? []),
      getWaiting: vi.fn(async () => opts.genWaiting ?? []),
      getCompleted: vi.fn(async () => opts.genCompleted ?? []),
      getFailed: vi.fn(async () => opts.genFailed ?? []),
    },
  };
}

describe("getActiveRunState", () => {
  it("returns none when no parent or generate job is in flight", async () => {
    // Old completed/failed jobs alone don't make a run active.
    const q = queues({ genCompleted: [{ data: { runId: "old" } }], genFailed: [{ data: {} }] });
    expect(await getActiveRunState(q)).toEqual({ status: "none" });
  });

  it("is active while the scheduler-run parent is active", async () => {
    const q = queues({ parentActive: [{ data: { runId: "run-1" } }] });
    expect(await getActiveRunState(q)).toEqual({
      status: "active",
      runId: "run-1",
      total: 0,
      active: 0,
      completed: 0,
      failed: 0,
    });
  });

  it("is active while the parent waits for its generate children (the generation phase)", async () => {
    const q = queues({
      parentWaitingChildren: [{ data: { runId: "run-2" } }],
      genActive: [{ data: { runId: "run-2" } }, { data: { runId: "run-2" } }],
      genCompleted: [{ data: { runId: "run-2" } }],
      genFailed: [],
    });
    expect(await getActiveRunState(q)).toEqual({
      status: "active",
      runId: "run-2",
      total: 3,
      active: 2,
      completed: 1,
      failed: 0,
    });
  });

  it("is active when a generate job is active even if no parent is visible", async () => {
    const q = queues({ genActive: [{ data: { runId: "run-3" } }], genFailed: [{ data: {} }] });
    const state = await getActiveRunState(q);
    expect(state).toMatchObject({ status: "active", runId: "run-3", active: 1, failed: 1, total: 2 });
  });

  it("is active when generate jobs are only waiting", async () => {
    const q = queues({ genWaiting: [{ data: { runId: "run-4" } }] });
    expect(await getActiveRunState(q)).toMatchObject({ status: "active", runId: "run-4", active: 0 });
  });

  it("still reports a waiting parent as active", async () => {
    const q = queues({ parentWaiting: [{ data: { runId: "run-5" } }] });
    expect(await getActiveRunState(q)).toMatchObject({ status: "active", runId: "run-5" });
  });
});
