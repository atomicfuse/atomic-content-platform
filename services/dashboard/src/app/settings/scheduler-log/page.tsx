"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";

interface SiteRunResult {
  domain: string;
  status: "success" | "partial" | "error" | "no_content";
  articlesCreated: number;
  articlesRequested: number;
  message?: string;
}

interface SchedulerRunEntry {
  timestamp: string;
  timezone: string;
  forced: boolean;
  sites: SiteRunResult[];
  skipped: Array<{ domain: string; reason: string }>;
}

function formatTimestamp(iso: string, timezone: string): string {
  try {
    const TIMEZONE_MAP: Record<string, string> = {
      EST: "America/New_York",
      EDT: "America/New_York",
      PST: "America/Los_Angeles",
      PDT: "America/Los_Angeles",
      CST: "America/Chicago",
      CDT: "America/Chicago",
      MST: "America/Denver",
      MDT: "America/Denver",
    };
    const resolved = TIMEZONE_MAP[timezone.toUpperCase()] ?? timezone;
    // Handle truncated runId timestamps like "2026-06-01T14" (old format)
    const normalized = iso.length <= 13 ? `${iso}:00:00Z` : iso;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: resolved,
      timeZoneName: "short",
    }).format(new Date(normalized));
  } catch {
    return iso;
  }
}

const STATUS_STYLES: Record<SiteRunResult["status"], { dot: string; text: string }> = {
  success: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  partial: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400" },
  error: { dot: "bg-red-500", text: "text-red-400" },
  no_content: { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400" },
};

function SiteRow({ site }: { site: SiteRunResult }): React.ReactElement {
  const style = STATUS_STYLES[site.status];
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
            {site.domain}
          </span>
          <span className={`text-xs font-mono ${style.text}`}>
            {site.status === "no_content"
              ? "no content"
              : `${site.articlesCreated}/${site.articlesRequested} articles`}
          </span>
        </div>
        {site.message && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {site.message}
          </p>
        )}
      </div>
    </div>
  );
}

function SkippedRow({ domain, reason }: { domain: string; reason: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-[var(--text-muted)]" />
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-mono text-[var(--text-muted)]">{domain}</span>
        <span className="text-xs text-[var(--text-muted)]">skipped — {reason}</span>
      </div>
    </div>
  );
}

function RunCard({ entry }: { entry: SchedulerRunEntry }): React.ReactElement {
  const hasErrors = entry.sites.some((s) => s.status === "error" || s.status === "no_content");
  const allGood = entry.sites.length > 0 && entry.sites.every((s) => s.status === "success");
  const borderColor = hasErrors
    ? "border-red-500/30"
    : allGood
      ? "border-green-500/30"
      : "border-[var(--border-primary)]";

  return (
    <div
      className={`rounded-xl border ${borderColor} bg-[var(--bg-elevated)] overflow-hidden`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {formatTimestamp(entry.timestamp, entry.timezone)}
        </span>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded-full ${
            entry.forced
              ? "bg-violet-500/20 text-violet-400"
              : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          {entry.forced ? "manual" : "cron"}
        </span>
      </div>
      <div className="px-4 py-2 divide-y divide-[var(--border-secondary)]">
        {entry.sites.map((site) => (
          <SiteRow key={site.domain} site={site} />
        ))}
        {entry.skipped.map((s) => (
          <SkippedRow key={s.domain} domain={s.domain} reason={s.reason} />
        ))}
        {entry.sites.length === 0 && entry.skipped.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] py-2">No sites processed</p>
        )}
      </div>
    </div>
  );
}

export default function SchedulerLogPage(): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SchedulerRunEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/scheduler/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SchedulerRunEntry[];
        setEntries(data);
      } catch {
        toast("Failed to load scheduler log", "error");
      }
      setLoading(false);
    })();
  }, [toast]);

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">Loading scheduler log…</div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scheduler Log</h2>
          <Link
            href="/scheduler-summary"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Weekly Summary →
          </Link>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          History of scheduler runs with per-site article creation results.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No scheduler runs recorded yet. Runs are logged after the scheduler
            processes sites (hour-skipped ticks are not recorded).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry, i) => (
            <RunCard key={`${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
