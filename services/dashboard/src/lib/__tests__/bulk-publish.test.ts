import { describe, it, expect, vi } from "vitest";
import {
  createBulkPublishRunner,
  type BulkPublishDeps,
  type BulkRunSnapshot,
  type SchedulerState,
} from "@/lib/bulk-publish";

/** Deps where every call is a mock: nothing here can publish anything. */
function makeDeps(overrides: Partial<BulkPublishDeps> = {}): BulkPublishDeps & {
  snapshots: BulkRunSnapshot[];
  log: string[];
} {
  const snapshots: BulkRunSnapshot[] = [];
  const log: string[] = [];
  return {
    snapshots,
    log,
    publish: vi.fn(async (domain: string) => {
      log.push(`publish:${domain}`);
    }),
    checkScheduler: vi.fn(async (): Promise<SchedulerState> => {
      log.push("scheduler");
      return "idle";
    }),
    hasPendingChanges: vi.fn(async (domain: string) => {
      log.push(`recheck:${domain}`);
      return true;
    }),
    onChange: (s: BulkRunSnapshot): void => {
      snapshots.push(s);
    },
    ...overrides,
  };
}

function states(s: BulkRunSnapshot): Record<string, string> {
  return Object.fromEntries(s.sites.map((e) => [e.domain, e.state]));
}

describe("createBulkPublishRunner", () => {
  it("publishes sequentially, checking the scheduler and re-checking each site first", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps();
    deps.publish = vi.fn(async (domain: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      deps.log.push(`publish:${domain}`);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b", "c"]);

    expect(maxInFlight).toBe(1);
    expect(deps.log).toEqual([
      "scheduler", "recheck:a", "publish:a",
      "scheduler", "recheck:b", "publish:b",
      "scheduler", "recheck:c", "publish:c",
    ]);
    const final = runner.getSnapshot();
    expect(final.phase).toBe("done");
    expect(states(final)).toEqual({ a: "published", b: "published", c: "published" });
    // Live updates: "publishing" was emitted for a site before it finished.
    expect(deps.snapshots.some((s) => states(s).b === "publishing" && states(s).a === "published")).toBe(true);
  });

  it("skips a site whose fresh re-check shows no pending changes", async () => {
    const deps = makeDeps({
      hasPendingChanges: vi.fn(async (d: string) => d !== "b"),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b", "c"]);
    const final = runner.getSnapshot();
    expect(states(final)).toEqual({ a: "published", b: "skipped", c: "published" });
    expect(final.sites[1]?.message).toBe("No longer has changes");
    expect(deps.publish).not.toHaveBeenCalledWith("b");
  });

  it("marks a site failed (without publishing) when the re-check itself errors", async () => {
    const deps = makeDeps({
      hasPendingChanges: vi.fn(async (d: string) => {
        if (d === "a") throw new Error("GitHub 502");
        return true;
      }),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b"]);
    const final = runner.getSnapshot();
    expect(states(final)).toEqual({ a: "failed", b: "published" });
    expect(final.sites[0]?.message).toMatch(/GitHub 502/);
    expect(deps.publish).toHaveBeenCalledTimes(1);
  });

  it("pauses when a scheduler run is active and resumes after re-checking", async () => {
    const schedulerAnswers: SchedulerState[] = ["idle", "active", "active", "idle"];
    const deps = makeDeps({
      checkScheduler: vi.fn(async () => schedulerAnswers.shift() ?? "idle"),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b"]);

    let snap = runner.getSnapshot();
    expect(snap.phase).toBe("paused");
    expect(snap.pause).toBe("scheduler-active");
    expect(states(snap)).toEqual({ a: "published", b: "paused" });
    expect(deps.publish).toHaveBeenCalledTimes(1);

    // First resume: the scheduler is still running, stay paused.
    await runner.resume();
    snap = runner.getSnapshot();
    expect(snap.phase).toBe("paused");
    expect(deps.publish).toHaveBeenCalledTimes(1);

    await runner.resume();
    snap = runner.getSnapshot();
    expect(snap.phase).toBe("done");
    expect(states(snap)).toEqual({ a: "published", b: "published" });
  });

  it("pauses before the first site if the scheduler is already running", async () => {
    const deps = makeDeps({ checkScheduler: vi.fn(async (): Promise<SchedulerState> => "active") });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a"]);
    expect(runner.getSnapshot().phase).toBe("paused");
    expect(deps.hasPendingChanges).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("treats an unreachable scheduler as unknown and continues only when the user chooses to", async () => {
    const deps = makeDeps({ checkScheduler: vi.fn(async (): Promise<SchedulerState> => "unknown") });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b"]);
    let snap = runner.getSnapshot();
    expect(snap.phase).toBe("paused");
    expect(snap.pause).toBe("scheduler-unknown");
    expect(deps.publish).not.toHaveBeenCalled();

    await runner.continueDespiteUnknownScheduler();
    snap = runner.getSnapshot();
    expect(snap.phase).toBe("done");
    expect(snap.schedulerUnknownAccepted).toBe(true);
    expect(states(snap)).toEqual({ a: "published", b: "published" });
  });

  it("still pauses for an active scheduler after unknown was accepted", async () => {
    const answers: SchedulerState[] = ["unknown", "unknown", "active"];
    const deps = makeDeps({ checkScheduler: vi.fn(async () => answers.shift() ?? "idle") });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b"]);
    await runner.continueDespiteUnknownScheduler();
    const snap = runner.getSnapshot();
    expect(snap.phase).toBe("paused");
    expect(snap.pause).toBe("scheduler-active");
    expect(states(snap)).toEqual({ a: "published", b: "paused" });
  });

  it("a failed publish marks that site failed and continues with the next", async () => {
    const deps = makeDeps({
      publish: vi.fn(async (d: string) => {
        if (d === "b") throw new Error("merge conflict");
      }),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b", "c"]);
    const final = runner.getSnapshot();
    expect(final.phase).toBe("done");
    expect(states(final)).toEqual({ a: "published", b: "failed", c: "published" });
    expect(final.sites[1]?.message).toBe("merge conflict");
  });

  it("Retry failed re-runs only the failed sites through the same checks", async () => {
    let bAttempts = 0;
    const deps = makeDeps({
      publish: vi.fn(async (d: string) => {
        deps.log.push(`publish:${d}`);
        if (d === "b" && bAttempts++ === 0) throw new Error("boom");
        if (d === "d") throw new Error("still broken");
      }),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b", "c", "d"]);
    expect(states(runner.getSnapshot())).toEqual({
      a: "published", b: "failed", c: "published", d: "failed",
    });

    deps.log.length = 0;
    await runner.retryFailed();
    expect(deps.log).toEqual([
      "scheduler", "recheck:b", "publish:b",
      "scheduler", "recheck:d", "publish:d",
    ]);
    const final = runner.getSnapshot();
    expect(final.phase).toBe("done");
    expect(states(final)).toEqual({ a: "published", b: "published", c: "published", d: "failed" });
  });

  it("Cancel stops after the current site finishes and never interrupts a publish", async () => {
    let releaseA: () => void = () => undefined;
    const deps = makeDeps();
    deps.publish = vi.fn(
      (d: string) =>
        new Promise<void>((resolve) => {
          deps.log.push(`publish:${d}`);
          if (d === "a") releaseA = resolve;
          else resolve();
        }),
    );
    const runner = createBulkPublishRunner(deps);
    const run = runner.start(["a", "b", "c"]);
    await vi.waitFor(() => expect(deps.publish).toHaveBeenCalledWith("a"));

    runner.cancel();
    expect(runner.getSnapshot().phase).toBe("cancelling");
    expect(states(runner.getSnapshot()).a).toBe("publishing");

    releaseA();
    await run;
    const final = runner.getSnapshot();
    expect(final.phase).toBe("cancelled");
    expect(states(final)).toEqual({ a: "published", b: "skipped", c: "skipped" });
    expect(final.sites[1]?.message).toBe("Cancelled before publishing");
    expect(deps.publish).toHaveBeenCalledTimes(1);
  });

  it("Cancel while paused ends the run without publishing the rest", async () => {
    const deps = makeDeps({ checkScheduler: vi.fn(async (): Promise<SchedulerState> => "active") });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b"]);
    runner.cancel();
    const final = runner.getSnapshot();
    expect(final.phase).toBe("cancelled");
    expect(states(final)).toEqual({ a: "skipped", b: "skipped" });
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

describe("createBulkPublishRunner: re-check verdicts and cancel edge cases", () => {
  it("a re-check verdict can skip or fail a site with its own message, without publishing", async () => {
    const deps = makeDeps({
      hasPendingChanges: vi.fn(async (d: string) => {
        if (d === "a") return { skip: "No longer eligible" };
        if (d === "b") return { fail: "Too many changes to verify" };
        return true;
      }),
    });
    const runner = createBulkPublishRunner(deps);
    await runner.start(["a", "b", "c"]);
    const final = runner.getSnapshot();
    expect(states(final)).toEqual({ a: "skipped", b: "failed", c: "published" });
    expect(final.sites[0]?.message).toBe("No longer eligible");
    expect(final.sites[1]?.message).toBe("Too many changes to verify");
    expect(vi.mocked(deps.publish).mock.calls.map((c) => c[0])).toEqual(["c"]);
  });

  it("cancel during the last site ends as cancelled, and does not leak into a retry", async () => {
    let release: () => void = () => undefined;
    let attempts = 0;
    const deps = makeDeps();
    deps.publish = vi.fn(
      (d: string) =>
        new Promise<void>((resolve, reject) => {
          if (d === "a") {
            resolve();
            return;
          }
          attempts++;
          if (attempts === 1) release = (): void => reject(new Error("boom"));
          else resolve();
        }),
    );
    const runner = createBulkPublishRunner(deps);
    const run = runner.start(["a", "b"]);
    await vi.waitFor(() => expect(deps.publish).toHaveBeenCalledWith("b"));
    runner.cancel();
    release();
    await run;
    expect(runner.getSnapshot().phase).toBe("cancelled");
    expect(states(runner.getSnapshot())).toEqual({ a: "published", b: "failed" });

    await runner.retryFailed();
    const final = runner.getSnapshot();
    expect(final.phase).toBe("done");
    expect(states(final)).toEqual({ a: "published", b: "published" });
  });
});
