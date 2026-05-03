"use client";

import { useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueJob {
  id: string;
  status: "completed" | "failed" | "active" | "waiting" | "delayed";
  domain: string;
  triggeredBy: string;
  branch?: string;
  count?: number;
  articlesCreated?: number;
  articlesErrored?: number;
  totalResults?: number;
  requested?: number;
  totalSourced?: number;
  duplicateCount?: number;
  failedReason?: string;
  errorReasons?: string[];
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

type StatusFilter = "all" | "completed" | "failed" | "active";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return "—";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  QueueJob["status"],
  { dot: string; label: string; bg: string }
> = {
  completed: {
    dot: "bg-green-500",
    label: "Completed",
    bg: "bg-green-500/10 text-green-400",
  },
  failed: {
    dot: "bg-red-500",
    label: "Failed",
    bg: "bg-red-500/10 text-red-400",
  },
  active: {
    dot: "bg-blue-500 animate-pulse",
    label: "Running",
    bg: "bg-blue-500/10 text-blue-400",
  },
  waiting: {
    dot: "bg-yellow-500",
    label: "Waiting",
    bg: "bg-yellow-500/10 text-yellow-400",
  },
  delayed: {
    dot: "bg-orange-500",
    label: "Delayed",
    bg: "bg-orange-500/10 text-orange-400",
  },
};

const TRIGGER_STYLE: Record<string, string> = {
  manual: "bg-violet-500/20 text-violet-400",
  scheduled: "bg-[var(--bg-surface)] text-[var(--text-muted)]",
  "scheduled-forced": "bg-violet-500/20 text-violet-400",
};

function JobCard({ job }: { job: QueueJob }): React.ReactElement {
  const cfg = STATUS_CONFIG[job.status];
  const [expanded, setExpanded] = useState(false);

  const hasErrors =
    job.status === "failed" ||
    (job.errorReasons && job.errorReasons.length > 0);

  const borderColor = hasErrors
    ? "border-red-500/30"
    : job.status === "completed"
      ? "border-green-500/30"
      : job.status === "active"
        ? "border-blue-500/30"
        : "border-[var(--border-primary)]";

  return (
    <div
      className={`rounded-xl border ${borderColor} bg-[var(--bg-elevated)] overflow-hidden`}
    >
      {/* Header */}
      <button
        onClick={(): void => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
          <span className="text-sm font-mono font-medium text-[var(--text-primary)] truncate">
            {job.domain}
          </span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded-full shrink-0 ${cfg.bg}`}>
            {cfg.label}
          </span>
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full shrink-0 ${
              TRIGGER_STYLE[job.triggeredBy] ?? TRIGGER_STYLE.scheduled
            }`}
          >
            {job.triggeredBy === "scheduled-forced" ? "forced" : job.triggeredBy}
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {job.status === "completed" && (
            <span className="text-xs font-mono text-green-400">
              {job.articlesCreated}/{job.requested ?? job.count ?? "?"} articles
            </span>
          )}
          {job.status === "failed" && job.attemptsMade > 1 && (
            <span className="text-xs font-mono text-red-400">
              {job.attemptsMade} attempts
            </span>
          )}
          <span
            className="text-xs text-[var(--text-muted)]"
            title={formatTimestamp(job.timestamp)}
          >
            {timeAgo(job.timestamp)}
          </span>
          <svg
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 space-y-2 text-xs">
          {/* Stats row */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[var(--text-secondary)]">
            <span>Job ID: {job.id}</span>
            {job.branch && <span>Branch: {job.branch}</span>}
            <span>Duration: {formatDuration(job.processedOn, job.finishedOn)}</span>
            <span>Attempts: {job.attemptsMade}/3</span>
            {job.timestamp && (
              <span>Created: {formatTimestamp(job.timestamp)}</span>
            )}
          </div>

          {/* Article breakdown */}
          {job.totalResults !== undefined && job.totalResults > 0 && (
            <div className="flex gap-4 font-mono text-[var(--text-secondary)]">
              <span className="text-green-400">
                {job.articlesCreated} created
              </span>
              {(job.articlesErrored ?? 0) > 0 && (
                <span className="text-red-400">
                  {job.articlesErrored} failed
                </span>
              )}
              {(job.duplicateCount ?? 0) > 0 && (
                <span className="text-orange-400">
                  {job.duplicateCount} duplicates
                </span>
              )}
              <span className="text-[var(--text-muted)]">
                {job.totalSourced ?? 0} sourced
              </span>
            </div>
          )}

          {/* Job-level failure reason (BullMQ) */}
          {job.failedReason && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2">
              <span className="text-red-400 font-mono break-all">
                {job.failedReason}
              </span>
            </div>
          )}

          {/* Per-article error reasons */}
          {job.errorReasons && job.errorReasons.length > 0 && (
            <div className="space-y-1">
              <span className="text-[var(--text-muted)] font-medium">
                Article errors:
              </span>
              {job.errorReasons.map((reason, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-red-500/5 px-3 py-1.5 font-mono text-red-400/80 break-all"
                >
                  {reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const FILTER_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

export default function QueuePage(): React.ReactElement {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/queue?status=completed,failed,active,waiting,delayed&limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { jobs: QueueJob[]; error?: string };
      if (data.error) {
        setError(data.error);
        setJobs([]);
      } else {
        setError(null);
        setJobs(data.jobs);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch";
      setError(msg);
      toast("Failed to load queue data", "error");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchJobs();
    // Auto-refresh every 10s
    const interval = setInterval(() => void fetchJobs(), 10_000);
    return (): void => clearInterval(interval);
  }, [fetchJobs]);

  const filtered =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  // Stats
  const activeCount = jobs.filter((j) => j.status === "active").length;
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">
        Loading queue data…
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Queue Monitor</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          BullMQ job history — completed jobs retained 7 days, failed 30 days.
          Auto-refreshes every 10s.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400 font-mono">{error}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Is the content-pipeline running with REDIS_URL configured?
          </p>
        </div>
      )}

      {/* Stats strip */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-sm text-[var(--text-secondary)]">
            {activeCount} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-[var(--text-secondary)]">
            {completedCount} completed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-sm text-[var(--text-secondary)]">
            {failedCount} failed
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--bg-secondary)] p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={(): void => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === tab.key
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {tab.label}
            {tab.key === "failed" && failedCount > 0 && (
              <span className="ml-1.5 text-xs text-red-400">
                {failedCount}
              </span>
            )}
            {tab.key === "active" && activeCount > 0 && (
              <span className="ml-1.5 text-xs text-blue-400">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            {error
              ? "Queue not available — content pipeline may be in direct execution mode."
              : filter === "all"
                ? "No jobs recorded. Jobs appear here once a generation runs through the BullMQ queue."
                : `No ${filter} jobs.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
