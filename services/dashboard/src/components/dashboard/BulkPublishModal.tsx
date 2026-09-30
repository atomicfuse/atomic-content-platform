"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { bulkPublishSite } from "@/actions/bulk-publish";
import {
  BULK_PUBLISH_BUSY_MESSAGE,
  isBulkPublishBusy,
  setBulkPublishBusy,
} from "@/lib/bulk-publish-activity";
import {
  unconfirmedDeletions,
  type PendingChangesResponse,
  type PendingSite,
} from "@/lib/pending-changes";
import {
  createBulkPublishRunner,
  type BulkPublishRunner,
  type BulkRunSnapshot,
  type SchedulerState,
  type SiteRunState,
} from "@/lib/bulk-publish";

interface BulkPublishModalProps {
  open: boolean;
  onClose: () => void;
  /** Number of Ready/Live sites with a staging branch (scan progress copy). */
  eligibleCount: number;
  /** Called once a run ends with at least one site published (table refresh). */
  onPublished: () => void;
}

type Step = "busy" | "scan" | "review" | "confirm" | "confirm-deletions" | "run";

export const TRUNCATED_ROW_MESSAGE = "Too many changes to review here — publish from the site page";
export const TRUNCATED_RECHECK_MESSAGE = "Too many changes to verify — publish from the site page";
export const NOT_ELIGIBLE_MESSAGE = "No longer eligible (not Ready/Live, or no staging branch)";

type ScanState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PendingChangesResponse };

const RUN_STATE_BADGE: Record<SiteRunState, { label: string; variant: "default" | "success" | "warning" | "error" | "info" }> = {
  queued: { label: "Queued", variant: "default" },
  publishing: { label: "Publishing", variant: "info" },
  published: { label: "Published", variant: "success" },
  skipped: { label: "Skipped", variant: "default" },
  failed: { label: "Failed", variant: "error" },
  paused: { label: "Paused", variant: "warning" },
};

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function changeLine(site: PendingSite): string {
  return `${site.added} added · ${site.modified} changed · ${site.removed} deleted`;
}

async function fetchScheduler(): Promise<SchedulerState> {
  try {
    const res = await fetch("/api/scheduler/active-run", { cache: "no-store" });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { status?: string };
    if (body.status === "active") return "active";
    if (body.status === "none") return "idle";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function fetchPending(domain?: string): Promise<PendingChangesResponse> {
  const url = domain
    ? `/api/sites/pending-changes?domain=${encodeURIComponent(domain)}`
    : "/api/sites/pending-changes";
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Partial<PendingChangesResponse> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return {
    scannedAt: body.scannedAt ?? new Date().toISOString(),
    scanned: body.scanned ?? 0,
    sites: body.sites ?? [],
    errors: body.errors ?? [],
    ...(typeof body.eligible === "boolean" ? { eligible: body.eligible } : {}),
  };
}

function Spinner(): React.ReactElement {
  return (
    <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "error" | "info";
  children: React.ReactNode;
}): React.ReactElement {
  const styles = {
    warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200",
    error: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200",
    info: "border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  }[tone];
  return (
    <div role={tone === "info" ? undefined : "alert"} className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

/**
 * Sites page "Publish changes" flow: scan every Ready/Live site for
 * unpublished staging changes, review and select, confirm (with an extra
 * confirmation for article deletions), then publish one site at a time
 * through `bulkPublishSite`, a thin wrapper around the existing
 * `publishStagingToProduction` server action.
 */
export function BulkPublishModal({
  open,
  onClose,
  eligibleCount,
  onPublished,
}: BulkPublishModalProps): React.ReactElement | null {
  const [step, setStep] = useState<Step>("scan");
  const [scan, setScan] = useState<ScanState>({ kind: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<BulkRunSnapshot | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const runnerRef = useRef<BulkPublishRunner | null>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);

  const startScan = useCallback(async (): Promise<void> => {
    setStep("scan");
    setScan({ kind: "loading" });
    try {
      const data = await fetchPending();
      setScan({ kind: "ready", data });
      setSelected(new Set(data.sites.filter((s) => !s.truncated).map((s) => s.domain)));
      setExpanded(new Set());
      setStep(data.sites.length > 0 ? "review" : "scan");
    } catch (err) {
      setScan({ kind: "error", message: err instanceof Error ? err.message : "Scan failed" });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRun(null);
    setConfirmingClose(false);
    runnerRef.current = null;
    startingRef.current = false;
    setStarting(false);
    // A previous run (modal closed mid-run) is still finishing its site.
    if (isBulkPublishBusy()) {
      setStep("busy");
      return;
    }
    void startScan();
  }, [open, startScan]);

  // Unmounting (e.g. navigating away) behaves like "Stop and close": the
  // current site finishes, nothing further starts, and a paused run ends so
  // the module-level busy flag can't get stuck.
  useEffect(() => {
    return (): void => {
      const runner = runnerRef.current;
      const phase = runner?.getSnapshot().phase;
      if (runner && (phase === "running" || phase === "paused")) runner.cancel();
    };
  }, []);

  const sites = scan.kind === "ready" ? scan.data.sites : [];
  const scanErrors = scan.kind === "ready" ? scan.data.errors : [];
  const selectableSites = useMemo(() => sites.filter((s) => !s.truncated), [sites]);
  const selectedSites = useMemo(() => sites.filter((s) => selected.has(s.domain)), [sites, selected]);
  const deletingSites = selectedSites.filter((s) => s.deletedArticles.length > 0);
  const totalDeleted = deletingSites.reduce((n, s) => n + s.deletedArticles.length, 0);

  const runActive = run !== null && (run.phase === "running" || run.phase === "cancelling" || run.phase === "paused");

  function toggle(set: Set<string>, domain: string): Set<string> {
    const next = new Set(set);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    return next;
  }

  async function startRun(): Promise<void> {
    // In-flight guard: a double click must never start two runners.
    if (startingRef.current || isBulkPublishBusy()) return;
    startingRef.current = true;
    setStarting(true);
    const reviewed = new Map(selectedSites.map((s) => [s.domain, s.deletedArticles]));
    const runner = createBulkPublishRunner({
      publish: async (domain) => {
        const result = await bulkPublishSite(domain);
        if (!result.ok) throw new Error(result.error);
      },
      checkScheduler: fetchScheduler,
      hasPendingChanges: async (domain) => {
        const fresh = await fetchPending(domain);
        if (fresh.errors.length > 0) throw new Error(fresh.errors[0]!.message);
        if (fresh.eligible === false) return { skip: NOT_ELIGIBLE_MESSAGE };
        const site = fresh.sites.find((s) => s.domain === domain);
        if (!site) return false;
        // Past GitHub's compare cap the deletion list can't be trusted.
        if (site.truncated) return { fail: TRUNCATED_RECHECK_MESSAGE };
        const surprise = unconfirmedDeletions(reviewed.get(domain) ?? [], site.deletedArticles);
        if (surprise.length > 0) {
          return {
            fail: `${plural(surprise.length, "new article deletion")} appeared since review (${surprise.join(", ")}). Review this site on its page.`,
          };
        }
        return true;
      },
      onChange: (snap) => {
        setRun(snap);
        setBulkPublishBusy(snap.phase === "running" || snap.phase === "cancelling" || snap.phase === "paused");
      },
    });
    runnerRef.current = runner;
    setBulkPublishBusy(true);
    setStep("run");
    await runner.start(selectedSites.map((s) => s.domain));
    afterRun(runner);
  }

  function afterRun(runner: BulkPublishRunner): void {
    const snap = runner.getSnapshot();
    if (snap.phase === "paused") return;
    if (snap.sites.some((s) => s.state === "published")) onPublished();
  }

  async function runnerAction(action: (r: BulkPublishRunner) => Promise<void>): Promise<void> {
    const runner = runnerRef.current;
    if (!runner) return;
    await action(runner);
    afterRun(runner);
  }

  function requestClose(): void {
    if (runActive) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  function cancelRun(): void {
    const runner = runnerRef.current;
    if (!runner) return;
    const pausedBefore = runner.getSnapshot().phase === "paused";
    runner.cancel();
    // A paused run ends synchronously on cancel, so nothing else will report
    // what already went live. A running one reports when its loop finishes.
    if (pausedBefore) afterRun(runner);
  }

  function stopAndClose(): void {
    cancelRun();
    setConfirmingClose(false);
    onClose();
  }

  if (!open) return null;

  const title =
    step === "run" ? "Publishing changes" : step === "confirm" || step === "confirm-deletions" ? "Confirm publish" : "Publish changes";

  return (
    <Modal open={open} onClose={requestClose} title={title} size="lg">
      <div className="space-y-4">
        {step === "busy" && (
          <>
            <Notice tone="warning">
              {BULK_PUBLISH_BUSY_MESSAGE} It stops after its current site. Try again in a moment.
            </Notice>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}

        {step === "scan" && (
          <ScanStep
            scan={scan}
            eligibleCount={eligibleCount}
            onRetry={(): void => void startScan()}
            onClose={onClose}
          />
        )}

        {step === "review" && (
          <>
            <p className="text-sm text-[var(--text-secondary)]">
              Publishing sends everything on each site&apos;s staging branch live, including other people&apos;s
              unpublished edits and AI-generated articles still on staging.
            </p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">
                {selected.size} of {plural(selectableSites.length, "site")} selected
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={(): void => setSelected(new Set(selectableSites.map((s) => s.domain)))}>
                  Select all
                </Button>
                <Button size="sm" variant="ghost" onClick={(): void => setSelected(new Set())}>
                  Select none
                </Button>
              </div>
            </div>
            <ul className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)]">
              {sites.map((site) => {
                const isOpen = expanded.has(site.domain);
                return (
                  <li key={site.domain} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-cyan)] disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selected.has(site.domain)}
                        disabled={site.truncated}
                        onChange={(): void => setSelected((prev) => toggle(prev, site.domain))}
                        aria-label={`Publish ${site.domain}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--text-primary)] break-all">{site.domain}</span>
                          <StatusBadge status={site.status} />
                          {site.deletedArticles.length > 0 && (
                            <Badge variant="error" label={`${plural(site.deletedArticles.length, "article")} deleted`} />
                          )}
                        </div>
                        <div className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">{changeLine(site)}</div>
                        {site.truncated && (
                          <div className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                            {TRUNCATED_ROW_MESSAGE}
                          </div>
                        )}
                        {isOpen && (
                          <ul className="mt-2 max-h-48 overflow-auto rounded-md bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-xs">
                            {site.files.map((f) => (
                              <li key={f.filename} className="flex gap-2 py-0.5">
                                <span className="w-16 shrink-0 text-[var(--text-muted)]">{f.status}</span>
                                <span className="break-all text-[var(--text-secondary)]">
                                  {f.filename.slice(`sites/${site.domain}/`.length)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(): void => setExpanded((prev) => toggle(prev, site.domain))}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} files for ${site.domain}`}
                        className="rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        {isOpen ? "Hide files" : `${plural(site.files.length, "file")}`}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <ScanErrors errors={scanErrors} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={selectedSites.length === 0} onClick={(): void => setStep("confirm")}>
                Continue with {plural(selectedSites.length, "site")}
              </Button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm text-[var(--text-primary)]">
              {plural(selectedSites.length, "site")} will be published one at a time. Each site&apos;s staging branch is
              merged to main and then reset. Publishing pauses while a scheduler run is in progress.
            </p>
            <ul className="max-h-48 overflow-auto rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm">
              {selectedSites.map((s) => (
                <li key={s.domain} className="flex justify-between gap-3 py-0.5">
                  <span className="break-all">{s.domain}</span>
                  <span className="shrink-0 tabular-nums text-xs text-[var(--text-secondary)]">{changeLine(s)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={(): void => setStep("review")}>
                Back
              </Button>
              <Button
                onClick={(): void => {
                  if (deletingSites.length > 0) setStep("confirm-deletions");
                  else void startRun();
                }}
                disabled={starting}
              >
                Publish {plural(selectedSites.length, "site")}
              </Button>
            </div>
          </>
        )}

        {step === "confirm-deletions" && (
          <>
            <Notice tone="error">
              <p className="font-semibold">
                {plural(totalDeleted, "live article")} will be permanently deleted
              </p>
              <p className="mt-1">
                These articles were removed on staging. Publishing deletes them from the live site, including their
                stored data and images. This cannot be undone.
              </p>
            </Notice>
            <ul className="rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
              {deletingSites.map((s) => (
                <li key={s.domain} className="flex justify-between gap-3 px-3 py-2">
                  <span className="break-all">{s.domain}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-red-700 dark:text-red-300">
                    {plural(s.deletedArticles.length, "article")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={(): void => setStep("confirm")}>
                Back
              </Button>
              <Button variant="danger" disabled={starting} onClick={(): void => void startRun()}>
                Delete articles and publish
              </Button>
            </div>
          </>
        )}

        {step === "run" && run && (
          <RunView
            run={run}
            confirmingClose={confirmingClose}
            onKeepRunning={(): void => setConfirmingClose(false)}
            onStopAndClose={stopAndClose}
            onResume={(): void => void runnerAction((r) => r.resume())}
            onContinueAnyway={(): void => void runnerAction((r) => r.continueDespiteUnknownScheduler())}
            onCancel={cancelRun}
            onRetryFailed={(): void => void runnerAction((r) => r.retryFailed())}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

function ScanStep({
  scan,
  eligibleCount,
  onRetry,
  onClose,
}: {
  scan: ScanState;
  eligibleCount: number;
  onRetry: () => void;
  onClose: () => void;
}): React.ReactElement {
  if (scan.kind === "loading") {
    return (
      <div className="flex items-center gap-3 py-6 text-sm text-[var(--text-secondary)]" role="status">
        <Spinner />
        Checking {plural(eligibleCount, "site")} for unpublished changes…
      </div>
    );
  }
  if (scan.kind === "error") {
    return (
      <>
        <Notice tone="error">Couldn&apos;t check for unpublished changes: {scan.message}</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="py-4 text-center">
        <p className="font-semibold text-[var(--text-primary)]">No sites have unpublished changes</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Checked {plural(scan.data.scanned, "site")}. Everything on staging is already live.
        </p>
      </div>
      <ScanErrors errors={scan.data.errors} />
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

function ScanErrors({ errors }: { errors: PendingChangesResponse["errors"] }): React.ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <details className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-yellow-800 dark:text-yellow-200">
        {plural(errors.length, "site")} couldn&apos;t be checked
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {errors.map((e) => (
          <li key={e.domain}>
            <span className="font-medium">{e.domain}</span>
            <span className="text-[var(--text-secondary)]">: {e.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RunView({
  run,
  confirmingClose,
  onKeepRunning,
  onStopAndClose,
  onResume,
  onContinueAnyway,
  onCancel,
  onRetryFailed,
  onClose,
}: {
  run: BulkRunSnapshot;
  confirmingClose: boolean;
  onKeepRunning: () => void;
  onStopAndClose: () => void;
  onResume: () => void;
  onContinueAnyway: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
}): React.ReactElement {
  const total = run.sites.length;
  const finished = run.sites.filter((s) => s.state === "published" || s.state === "skipped" || s.state === "failed").length;
  const published = run.sites.filter((s) => s.state === "published").length;
  const failed = run.sites.filter((s) => s.state === "failed").length;
  const ended = run.phase === "done" || run.phase === "cancelled";
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);

  return (
    <>
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-[var(--text-primary)]" aria-live="polite">
            {run.phase === "done" && `Done: ${published} published${failed ? `, ${failed} failed` : ""}`}
            {run.phase === "cancelled" && `Cancelled: ${published} published`}
            {run.phase === "running" && "Publishing one site at a time…"}
            {run.phase === "cancelling" && "Stopping after the current site…"}
            {run.phase === "paused" && "Paused"}
          </span>
          <span className="tabular-nums text-[var(--text-secondary)]" data-testid="bulk-progress">
            {finished} / {total}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full rounded-full bg-cyan transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {confirmingClose && (
        <Notice tone="warning">
          <p>Stop publishing? The current site finishes first; the rest are not published.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onKeepRunning}>
              Keep publishing
            </Button>
            <Button size="sm" variant="danger" onClick={onStopAndClose}>
              Stop and close
            </Button>
          </div>
        </Notice>
      )}

      {run.phase === "paused" && run.pause === "scheduler-active" && (
        <Notice tone="warning">
          <div className="flex items-center justify-between gap-3">
            <span>Paused: the scheduler is running. Resume once it finishes.</span>
            <Button size="sm" variant="secondary" onClick={onResume}>
              Resume
            </Button>
          </div>
        </Notice>
      )}
      {run.phase === "paused" && run.pause === "scheduler-unknown" && (
        <Notice tone="warning">
          <p>Couldn&apos;t check whether the scheduler is running (content pipeline unreachable).</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onResume}>
              Check again
            </Button>
            <Button size="sm" variant="secondary" onClick={onContinueAnyway}>
              Continue anyway
            </Button>
          </div>
        </Notice>
      )}
      {run.schedulerUnknownAccepted && !ended && run.phase !== "paused" && (
        <p className="text-xs text-yellow-700 dark:text-yellow-300">
          Scheduler status unknown: publishing without the scheduler check.
        </p>
      )}

      <ul className="max-h-[45vh] overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)]">
        {run.sites.map((s) => {
          const badge = RUN_STATE_BADGE[s.state];
          return (
            <li key={s.domain} className="flex items-start justify-between gap-3 px-3 py-2 text-sm" data-testid={`run-row-${s.domain}`}>
              <div className="min-w-0">
                <div className="break-all text-[var(--text-primary)]">{s.domain}</div>
                {s.message && (
                  <div className={`text-xs ${s.state === "failed" ? "text-red-700 dark:text-red-300" : "text-[var(--text-secondary)]"}`}>
                    {s.message}
                  </div>
                )}
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-cyan">
                {s.state === "publishing" && <Spinner />}
                <Badge variant={badge.variant} label={badge.label} />
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-end gap-2 pt-1">
        {!ended && (
          <Button variant="secondary" onClick={onCancel} disabled={run.phase === "cancelling"}>
            Cancel
          </Button>
        )}
        {ended && failed > 0 && (
          <Button variant="secondary" onClick={onRetryFailed}>
            Retry failed ({failed})
          </Button>
        )}
        {ended && <Button onClick={onClose}>Close</Button>}
      </div>
    </>
  );
}
