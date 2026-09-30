/**
 * Sequential bulk-publish runner for the Sites page "Publish changes" flow.
 *
 * Framework-free and dependency-injected so it is unit-testable: the modal
 * wires `publish` to the existing `publishStagingToProduction` server action
 * (unchanged), `checkScheduler` to `/api/scheduler/active-run` and
 * `hasPendingChanges` to `/api/sites/pending-changes?domain=`.
 *
 * Per site, in order: scheduler check (pause if a run is active), fresh
 * pending-changes re-check (skip if none), publish. A failure never stops the
 * run. Cancel takes effect between sites, never mid-publish.
 */

export type SiteRunState = "queued" | "publishing" | "published" | "skipped" | "failed" | "paused";

export interface SiteRunEntry {
  domain: string;
  state: SiteRunState;
  message?: string;
}

export type RunPhase = "idle" | "running" | "paused" | "cancelling" | "cancelled" | "done";

/** Why the run is paused (only set while `phase === "paused"`). */
export type PauseReason = "scheduler-active" | "scheduler-unknown";

export type SchedulerState = "idle" | "active" | "unknown";

export interface BulkRunSnapshot {
  phase: RunPhase;
  pause: PauseReason | null;
  sites: SiteRunEntry[];
  /** The user chose to continue although the scheduler state is unknown. */
  schedulerUnknownAccepted: boolean;
}

export type RecheckVerdict = { skip: string } | { fail: string };
export type RecheckResult = boolean | RecheckVerdict;

export interface BulkPublishDeps {
  publish: (domain: string) => Promise<void>;
  checkScheduler: () => Promise<SchedulerState>;
  /**
   * Fresh per-site re-check. `true` publishes, `false` skips with
   * NO_CHANGES_MESSAGE; a verdict object skips or fails with its own message.
   */
  hasPendingChanges: (domain: string) => Promise<RecheckResult>;
  onChange: (snapshot: BulkRunSnapshot) => void;
}

export interface BulkPublishRunner {
  start: (domains: string[]) => Promise<void>;
  /** Re-check the scheduler and continue a paused run. */
  resume: () => Promise<void>;
  /** Continue a run paused because the scheduler state could not be read. */
  continueDespiteUnknownScheduler: () => Promise<void>;
  /** Stop after the current site (immediately when paused). */
  cancel: () => void;
  /** Re-run only the failed sites, through the same checks. */
  retryFailed: () => Promise<void>;
  getSnapshot: () => BulkRunSnapshot;
}

export const CANCELLED_MESSAGE = "Cancelled before publishing";
export const NO_CHANGES_MESSAGE = "No longer has changes";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

export function createBulkPublishRunner(deps: BulkPublishDeps): BulkPublishRunner {
  let sites: SiteRunEntry[] = [];
  let phase: RunPhase = "idle";
  let pause: PauseReason | null = null;
  let unknownAccepted = false;
  let cancelRequested = false;
  let looping = false;

  function snapshot(): BulkRunSnapshot {
    return { phase, pause, sites, schedulerUnknownAccepted: unknownAccepted };
  }

  function emit(): void {
    deps.onChange(snapshot());
  }

  function setSite(index: number, state: SiteRunState, message?: string): void {
    sites = sites.map((s, i) =>
      i === index ? { domain: s.domain, state, ...(message ? { message } : {}) } : s,
    );
    emit();
  }

  function finishCancelled(): void {
    sites = sites.map((s) =>
      s.state === "queued" || s.state === "paused"
        ? { domain: s.domain, state: "skipped", message: CANCELLED_MESSAGE }
        : s,
    );
    phase = "cancelled";
    pause = null;
    cancelRequested = false;
  }

  async function readScheduler(): Promise<SchedulerState> {
    try {
      return await deps.checkScheduler();
    } catch {
      return "unknown";
    }
  }

  async function loop(): Promise<void> {
    if (looping) return;
    looping = true;
    phase = "running";
    pause = null;
    emit();
    try {
      for (;;) {
        const index = sites.findIndex((s) => s.state === "queued" || s.state === "paused");
        if (index < 0) {
          // A cancel requested during the last site still ends as cancelled
          // (after the current site), and the flag never leaks into a retry.
          phase = cancelRequested ? "cancelled" : "done";
          cancelRequested = false;
          return;
        }
        if (cancelRequested) {
          finishCancelled();
          return;
        }

        const domain = sites[index]!.domain;
        const scheduler = await readScheduler();
        if (cancelRequested) {
          finishCancelled();
          return;
        }
        if (scheduler === "active" || (scheduler === "unknown" && !unknownAccepted)) {
          sites = sites.map((s, i) => (i === index ? { domain: s.domain, state: "paused" } : s));
          phase = "paused";
          pause = scheduler === "active" ? "scheduler-active" : "scheduler-unknown";
          return;
        }

        let pending: RecheckResult;
        try {
          pending = await deps.hasPendingChanges(domain);
        } catch (err) {
          setSite(index, "failed", `Could not re-check pending changes: ${errorMessage(err, "unknown error")}`);
          continue;
        }
        if (cancelRequested) {
          finishCancelled();
          return;
        }
        if (pending === false) {
          setSite(index, "skipped", NO_CHANGES_MESSAGE);
          continue;
        }
        if (typeof pending === "object") {
          if ("fail" in pending) setSite(index, "failed", pending.fail);
          else setSite(index, "skipped", pending.skip);
          continue;
        }

        setSite(index, "publishing");
        try {
          await deps.publish(domain);
          setSite(index, "published");
        } catch (err) {
          setSite(index, "failed", errorMessage(err, "Publish failed"));
        }
      }
    } finally {
      looping = false;
      emit();
    }
  }

  return {
    start: (domains) => {
      if (looping) return Promise.resolve();
      sites = domains.map((domain) => ({ domain, state: "queued" }));
      unknownAccepted = false;
      cancelRequested = false;
      return loop();
    },
    resume: () => {
      if (looping || phase !== "paused") return Promise.resolve();
      return loop();
    },
    continueDespiteUnknownScheduler: () => {
      if (looping || phase !== "paused" || pause !== "scheduler-unknown") return Promise.resolve();
      unknownAccepted = true;
      return loop();
    },
    cancel: () => {
      if (looping) {
        cancelRequested = true;
        phase = "cancelling";
        emit();
      } else if (phase === "paused") {
        finishCancelled();
        emit();
      }
    },
    retryFailed: () => {
      if (looping || !sites.some((s) => s.state === "failed")) return Promise.resolve();
      sites = sites.map((s) => (s.state === "failed" ? { domain: s.domain, state: "queued" } : s));
      cancelRequested = false;
      return loop();
    },
    getSnapshot: snapshot,
  };
}
