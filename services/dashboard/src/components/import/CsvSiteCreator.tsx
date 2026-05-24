"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ParsedSiteRow {
  raw: Record<string, string>;
  name: string;
  domain: string;
  category: string;
  menuItems: string;
  postsApi: string;
}

interface SiteStatus {
  siteId: string;
  status: "pending" | "running" | "complete" | "error";
  phase?: string;
  error?: string;
  warnings?: string[];
  previewUrl?: string;
  postsApiUrl?: string;
}

interface BatchStatus {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
  sites: SiteStatus[];
}

interface ArticleImportState {
  status: "idle" | "importing" | "complete" | "error";
  phase?: string;
  totalArticles?: number;
  processedArticles?: number;
  currentArticleSlug?: string;
  successful?: number;
  failed?: number;
  error?: string;
}

type ComponentPhase = "idle" | "creating" | "results";

// --- CSV parsing (unchanged) ---

function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    if (row["Site Name"]?.trim()) {
      rows.push(row);
    }
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const CSV_HEADERS = [
  "Site Name", "domain", "Company", "Website Category", "Menu Items",
  "IAB Top Categories (Vertical)", "Sub Categories", "Color Palette",
  "Logo", "Favicon", "Posts REST API (articles)", "GA Info",
];

const CSV_EXAMPLE_ROW = [
  "Cool News", "coolnews.dev", "ATL", "Technology", "Tech, Science, Reviews",
  "Technology & Computing", "Software, Hardware",
  "primary: #3B82F6, secondary: #1E40AF",
  "https://coolnews.dev/logo.png", "https://coolnews.dev/favicon.ico",
  "https://coolnews.dev/wp-json/wp/v2/posts", "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
];

const PHASE_LABELS: Record<string, string> = {
  "resolving-categories": "Resolving categories",
  "fetching-assets": "Fetching logo & favicon",
  "building-config": "Building site config",
  "creating-branch": "Creating staging branch",
  "committing": "Committing files",
};

function downloadTemplate(): void {
  const escapeCsvField = (field: string): string =>
    field.includes(",") || field.includes('"') ? `"${field.replace(/"/g, '""')}"` : field;

  const header = CSV_HEADERS.map(escapeCsvField).join(",");
  const example = CSV_EXAMPLE_ROW.map(escapeCsvField).join(",");
  const csv = `${header}\n${example}\n`;

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "site-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// --- SSE helper for article import (unchanged) ---

type ArticleImportEvent =
  | { type: "progress"; phase: string; totalArticles?: number; processedArticles?: number; currentArticleSlug?: string }
  | { type: "complete"; successful: number; failed: number }
  | { type: "error"; error: string };

async function consumeSSE<T>(
  response: Response,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          try { onEvent(JSON.parse(trimmed.slice(6)) as T); } catch { /* skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Polling interval ---
const POLL_INTERVAL_MS = 2000;

export function CsvSiteCreator(): React.ReactElement {
  const [sites, setSites] = useState<ParsedSiteRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [phase, setPhase] = useState<ComponentPhase>("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [articleImports, setArticleImports] = useState<Map<string, ArticleImportState>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const importAbortRefs = useRef<Map<string, AbortController>>(new Map());

  // --- Poll for batch status ---
  useEffect(() => {
    if (!batchId || phase !== "creating") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/wp-migrate/import-status/${batchId}`);
        if (!res.ok) return;
        const data = (await res.json()) as BatchStatus;
        setBatchStatus(data);

        if (data.status === "complete" || data.status === "failed") {
          setPhase("results");
        }
      } catch {
        // Silently retry on next interval
      }
    }, POLL_INTERVAL_MS);

    return (): void => clearInterval(interval);
  }, [batchId, phase]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBatchId(null);
    setBatchStatus(null);
    setError(null);
    setPhase("idle");
    setArticleImports(new Map());

    const reader = new FileReader();
    reader.onload = (ev): void => {
      const text = ev.target?.result as string;
      const rows = parseCsvText(text);

      if (rows.length === 0) {
        setError("No valid rows found. Make sure the CSV has a 'Site Name' column.");
        return;
      }

      setRawRows(rows);
      setSites(
        rows.map((r) => ({
          raw: r,
          name: r["Site Name"] ?? "",
          domain: r["domain"] ?? "",
          category: r["Website Category"] ?? "",
          menuItems: r["Menu Items"] ?? "",
          postsApi: r["Posts REST API (articles)"] ?? "",
        })),
      );
    };
    reader.readAsText(file);
  }, []);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (rawRows.length === 0) return;

    setPhase("creating");
    setError(null);
    setBatchStatus(null);
    setArticleImports(new Map());

    try {
      const res = await fetch("/api/agent/wp-migrate/create-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows }),
      });

      const data = (await res.json()) as { batchId?: string; error?: string };

      if (!res.ok || !data.batchId) {
        setError(data.error ?? `HTTP ${res.status}`);
        setPhase("idle");
        return;
      }

      setBatchId(data.batchId);
      // Polling starts via useEffect
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("idle");
    }
  }, [rawRows]);

  const handleImportArticles = useCallback(
    async (siteId: string, postsApiUrl: string): Promise<void> => {
      const existingController = importAbortRefs.current.get(siteId);
      existingController?.abort();

      const controller = new AbortController();
      importAbortRefs.current.set(siteId, controller);

      setArticleImports((prev) => {
        const next = new Map(prev);
        next.set(siteId, { status: "importing" });
        return next;
      });

      try {
        const res = await fetch("/api/agent/wp-migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteDomain: siteId,
            wpApiUrl: postsApiUrl,
            branch: `staging/${siteId}`,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `HTTP ${res.status}`;
          try { const parsed = JSON.parse(text) as { error?: string }; if (parsed.error) msg = parsed.error; } catch { /* */ }
          setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "error", error: msg }); return next; });
          return;
        }

        await consumeSSE<ArticleImportEvent>(
          res,
          (event) => {
            if (event.type === "progress") {
              setArticleImports((prev) => {
                const next = new Map(prev);
                next.set(siteId, { status: "importing", phase: event.phase, totalArticles: event.totalArticles, processedArticles: event.processedArticles, currentArticleSlug: event.currentArticleSlug });
                return next;
              });
            } else if (event.type === "complete") {
              setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "complete", successful: event.successful, failed: event.failed }); return next; });
            } else if (event.type === "error") {
              setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "error", error: event.error }); return next; });
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setArticleImports((prev) => {
          const next = new Map(prev);
          next.set(siteId, { status: "error", error: err instanceof Error ? err.message : "Unknown error" });
          return next;
        });
      } finally {
        importAbortRefs.current.delete(siteId);
      }
    },
    [],
  );

  const handleReset = useCallback((): void => {
    for (const controller of importAbortRefs.current.values()) {
      controller.abort();
    }
    importAbortRefs.current.clear();
    setSites([]);
    setRawRows([]);
    setBatchId(null);
    setBatchStatus(null);
    setPhase("idle");
    setArticleImports(new Map());
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const isCreating = phase === "creating";
  const completedSites = batchStatus?.sites.filter((s) => s.status === "complete") ?? [];
  const failedSites = batchStatus?.sites.filter((s) => s.status === "error") ?? [];
  const progressPercent = batchStatus
    ? Math.round(((batchStatus.completed + batchStatus.failed) / batchStatus.total) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Create Sites from CSV
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Upload a CSV export from the site spreadsheet. Each row becomes a site.yaml in the network repo.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFile}
          disabled={isCreating}
          className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyan/10 file:text-cyan hover:file:bg-cyan/20 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="shrink-0 text-sm text-[var(--text-secondary)] hover:text-cyan underline underline-offset-2 transition-colors"
        >
          Download template CSV
        </button>
      </div>

      {/* Preview table */}
      {sites.length > 0 && phase === "idle" && (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-secondary)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Site Name</th>
                  <th className="text-left px-3 py-2 font-medium">Domain</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-left px-3 py-2 font-medium">Menu Items</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s, i) => (
                  <tr key={i} className="border-t border-[var(--border-secondary)]">
                    <td className="px-3 py-2 text-[var(--text-tertiary)]">{i + 1}</td>
                    <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-xs">{s.domain}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{s.category}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] max-w-xs truncate">{s.menuItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create {sites.length} Sites on Staging
          </button>
        </>
      )}

      {/* Progress (polling-based) */}
      {phase === "creating" && batchStatus && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Creating {batchStatus.total} sites... ({batchStatus.completed + batchStatus.failed}/{batchStatus.total})
            </p>
            <span className="text-xs text-[var(--text-tertiary)]">{progressPercent}%</span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid gap-2 max-h-96 overflow-y-auto">
            {batchStatus.sites.map((site) => (
              <div
                key={site.siteId}
                className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-shrink-0">
                    {site.status === "pending" && <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />}
                    {site.status === "running" && <span className="inline-block w-2 h-2 rounded-full bg-cyan animate-pulse" />}
                    {site.status === "complete" && <span className="text-green-400">&#10003;</span>}
                    {site.status === "error" && <span className="text-red-400">&#10005;</span>}
                  </div>
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{site.siteId}</p>
                  {site.status === "running" && site.phase && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      {PHASE_LABELS[site.phase] ?? site.phase}
                    </span>
                  )}
                  {site.status === "error" && site.error && (
                    <span className="text-xs text-red-400 truncate">{site.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting for first poll */}
      {phase === "creating" && !batchStatus && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Submitting import batch...</p>
        </div>
      )}

      {/* Results */}
      {phase === "results" && batchStatus && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {completedSites.length} of {batchStatus.total} sites created
              {failedSites.length > 0 && (
                <span className="text-red-400 ml-1">({failedSites.length} failed)</span>
              )}
            </p>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Upload Another CSV
            </button>
          </div>

          <div className="grid gap-3">
            {batchStatus.sites.map((site) => {
              const importState = articleImports.get(site.siteId);

              return (
                <div
                  key={site.siteId}
                  className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-4 py-3 space-y-2"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {site.status === "complete" ? (
                        <span className="text-green-400 text-lg">&#10003;</span>
                      ) : (
                        <span className="text-red-400 text-lg">&#10005;</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{site.siteId}</p>

                      {site.status === "error" && site.error && (
                        <p className="text-sm text-red-400 mt-1">{site.error}</p>
                      )}

                      {site.previewUrl && (
                        <a
                          href={site.previewUrl}
                          target="_blank"
                          rel="noopener"
                          className="inline-block text-xs text-cyan underline underline-offset-2 hover:text-cyan/80 mt-1"
                        >
                          Open staging preview
                        </a>
                      )}

                      {site.warnings && site.warnings.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {site.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-amber-400">{w}</p>
                          ))}
                        </div>
                      )}

                      {importState?.status === "importing" && (
                        <div className="mt-2 text-xs text-[var(--text-secondary)]">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan animate-pulse mr-1.5 align-middle" />
                          {importState.phase ?? "Starting import..."}
                          {importState.processedArticles != null && importState.totalArticles != null && (
                            <span className="ml-1">({importState.processedArticles}/{importState.totalArticles})</span>
                          )}
                        </div>
                      )}

                      {importState?.status === "complete" && (
                        <p className="mt-2 text-xs text-green-400">
                          {importState.successful ?? 0} articles imported
                          {(importState.failed ?? 0) > 0 && (
                            <span className="text-red-400 ml-1">({importState.failed} failed)</span>
                          )}
                        </p>
                      )}

                      {importState?.status === "error" && (
                        <p className="mt-2 text-xs text-red-400">{importState.error}</p>
                      )}
                    </div>

                    {site.status === "complete" && site.postsApiUrl && (
                      <div className="flex-shrink-0">
                        {(!importState || importState.status === "idle" || importState.status === "error") && (
                          <button
                            onClick={(): void => {
                              void handleImportArticles(site.siteId, site.postsApiUrl!);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-cyan hover:bg-cyan/90 transition-colors"
                          >
                            Import Articles
                          </button>
                        )}
                        {importState?.status === "importing" && (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-cyan bg-cyan/10">
                            Importing...
                          </span>
                        )}
                        {importState?.status === "complete" && (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-green-400 bg-green-500/10">
                            Done
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
