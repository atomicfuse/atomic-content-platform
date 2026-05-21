"use client";

import { useState, useEffect, useCallback } from "react";
import type { StagingDiffFile } from "@/app/api/sites/staging-diff/route";

interface StagingDiffModalProps {
  open: boolean;
  onClose: () => void;
  domain: string;
}

function statusBadge(status: string): React.ReactElement {
  const colors: Record<string, string> = {
    added: "bg-green-500/10 text-green-400",
    modified: "bg-amber-500/10 text-amber-400",
    removed: "bg-red-500/10 text-red-400",
    renamed: "bg-blue-500/10 text-blue-400",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[status] ?? "bg-zinc-500/10 text-zinc-400"}`}>
      {status}
    </span>
  );
}

function categorizeFile(filename: string): string {
  if (filename.includes("/articles/") && filename.endsWith(".md")) return "Articles";
  if (filename.includes("site.yaml") || filename.includes("config")) return "Config";
  if (filename.includes("/assets/")) return "Assets";
  return "Other";
}

export function StagingDiffModal({ open, onClose, domain }: StagingDiffModalProps): React.ReactElement | null {
  const [files, setFiles] = useState<StagingDiffFile[]>([]);
  const [aheadBy, setAheadBy] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/staging-diff?domain=${encodeURIComponent(domain)}`);
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setError(err.error ?? "Failed to load diff");
        return;
      }
      const data = await res.json() as { files: StagingDiffFile[]; aheadBy: number };
      setFiles(data.files);
      setAheadBy(data.aheadBy);
    } catch {
      setError("Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    if (open) void fetchDiff();
  }, [open, fetchDiff]);

  if (!open) return null;

  // Group files by category
  const groups = new Map<string, StagingDiffFile[]>();
  for (const f of files) {
    const cat = categorizeFile(f.filename);
    const arr = groups.get(cat) ?? [];
    arr.push(f);
    groups.set(cat, arr);
  }

  // Sort categories: Articles first, then Config, then Others
  const sortOrder = ["Articles", "Config", "Assets", "Other"];
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => sortOrder.indexOf(a[0]) - sortOrder.indexOf(b[0])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Staging Changes</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {aheadBy} commit{aheadBy !== 1 ? "s" : ""} ahead of main &middot; {files.length} file{files.length !== 1 ? "s" : ""} changed
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--card-bg)] text-[var(--text-muted)]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--primary)]" />
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</div>
          )}

          {!loading && !error && files.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">No changes found</p>
          )}

          {!loading && !error && sortedGroups.map(([category, categoryFiles]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                {category} ({categoryFiles.length})
              </h3>
              <div className="space-y-1">
                {categoryFiles.map((f) => (
                  <div
                    key={f.filename}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--card-bg)] text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {statusBadge(f.status)}
                      <span className="text-[var(--text-secondary)] truncate font-mono text-xs">
                        {f.filename}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
                      {f.additions > 0 && <span className="text-green-400">+{f.additions}</span>}
                      {f.additions > 0 && f.deletions > 0 && " "}
                      {f.deletions > 0 && <span className="text-red-400">-{f.deletions}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
