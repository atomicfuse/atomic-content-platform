"use client";

import { useState } from "react";

type RunState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; alreadyRunning: boolean }
  | { kind: "error"; message: string };

/** Local time of the next hourly summary run (the cron fires at minute 30). */
export function nextSummaryRun(now: Date): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (now.getMinutes() >= 30) next.setHours(next.getHours() + 1);
  next.setMinutes(30);
  return next;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Shown under the story-mode selects when AI summary is chosen: summaries are not
 * written on save but by an hourly job, which this lets you start right away.
 */
export function GridSummariesRunNote(): React.ReactElement {
  const [state, setState] = useState<RunState>({ kind: "idle" });

  async function runNow(): Promise<void> {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/grid/summaries-run", { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? `request failed (${res.status})`);
      setState({ kind: "done", alreadyRunning: out.status === "already_running" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="md:col-span-2 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-4 py-3 text-sm">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[var(--text-primary)]">
          AI summaries aren&apos;t written when you save. An hourly job writes them at :30 (next run{" "}
          <span className="font-medium">{timeLabel(nextSummaryRun(new Date()))}</span>), and they show on the site a few
          minutes later. Until then, stories keep their current text.
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          The job reads the published settings — on a Live site, save and publish first.
        </p>
        {state.kind === "done" && (
          <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
            {state.alreadyRunning
              ? "A summary run is already in progress. New summaries show on the site about 10 minutes after it ends."
              : "Started. New summaries show on the site in about 10 minutes."}
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            Couldn&apos;t start the run: {state.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={(): void => void runNow()}
        disabled={state.kind === "busy"}
        className="shrink-0 rounded-md border border-[var(--border-primary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-60"
      >
        {state.kind === "busy" ? "Starting…" : "Generate now"}
      </button>
    </div>
  );
}
