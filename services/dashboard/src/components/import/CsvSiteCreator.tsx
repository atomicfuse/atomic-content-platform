"use client";

import { useCallback, useRef, useState } from "react";

interface ParsedSiteRow {
  raw: Record<string, string>;
  name: string;
  category: string;
  menuItems: string;
  postsApi: string;
}

interface CreateResult {
  domain: string;
  siteId: string;
  status: "created" | "error";
  error?: string;
}

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
    if (row["Name"]?.trim()) {
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
  "Name",
  "Website Category",
  "Menu Items",
  "IAB Top Categories (Vertical)",
  "Sub Categories",
  "Color Palette",
  "Logo",
  "Favicon",
  "Posts REST API (articles)",
  "GA Info",
];

const CSV_EXAMPLE_ROW = [
  "coolnews.dev",
  "Technology",
  "Tech, Science, Reviews",
  "Technology & Computing",
  "Software, Hardware",
  "primary: #3B82F6, secondary: #1E40AF",
  "https://coolnews.dev/logo.png",
  "https://coolnews.dev/favicon.ico",
  "https://coolnews.dev/wp-json/wp/v2/posts",
  "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
];

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

export function CsvSiteCreator(): React.ReactElement {
  const [sites, setSites] = useState<ParsedSiteRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [target, setTarget] = useState<"staging" | "main">("main");
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<CreateResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResults(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (ev): void => {
      const text = ev.target?.result as string;
      const rows = parseCsvText(text);

      if (rows.length === 0) {
        setError("No valid rows found. Make sure the CSV has a 'Name' column.");
        return;
      }

      setRawRows(rows);
      setSites(
        rows.map((r) => ({
          raw: r,
          name: r["Name"] ?? "",
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

    setCreating(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch("/api/agent/wp-migrate/create-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows, branch: target }),
      });

      const data = (await res.json()) as {
        status?: string;
        error?: string;
        results?: CreateResult[];
        created?: number;
      };

      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      }

      if (data.results) {
        setResults(data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }, [rawRows, target]);

  const createdCount = results?.filter((r) => r.status === "created").length ?? 0;
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0;

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

      {/* File upload + template */}
      <div className="flex items-center gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFile}
          disabled={creating}
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
      {sites.length > 0 && !results && (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-secondary)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                  <th className="text-left px-3 py-2 font-medium">#</th>
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
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{s.category}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] max-w-xs truncate">{s.menuItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Target selector */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
              Deploy To
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={(): void => setTarget("main")}
                disabled={creating}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                  target === "main"
                    ? "border-cyan bg-cyan/10 text-cyan"
                    : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Live (main)
              </button>
              <button
                type="button"
                onClick={(): void => setTarget("staging")}
                disabled={creating}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                  target === "staging"
                    ? "border-cyan bg-cyan/10 text-cyan"
                    : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Staging
              </button>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              {target === "main"
                ? "Sites will be created on main + each staging/<domain> branch"
                : "Sites will be created on main only (staging branches created during article import)"}
            </p>
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? `Creating ${sites.length} sites...` : `Create ${sites.length} Sites`}
          </button>
        </>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-3">
          <div className={`rounded-lg px-4 py-3 text-sm ${
            errorCount === 0
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-amber-500/10 border border-amber-500/30 text-amber-400"
          }`}>
            {createdCount} site{createdCount !== 1 ? "s" : ""} created
            {errorCount > 0 && `, ${errorCount} failed`}.
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--border-secondary)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                  <th className="text-left px-3 py-2 font-medium">Domain</th>
                  <th className="text-left px-3 py-2 font-medium">Site ID</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-[var(--border-secondary)]">
                    <td className="px-3 py-2 text-[var(--text-primary)]">{r.domain}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-xs">{r.siteId}</td>
                    <td className="px-3 py-2">
                      {r.status === "created" ? (
                        <span className="text-green-400">Created</span>
                      ) : (
                        <span className="text-red-400">{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={(): void => {
              setSites([]);
              setRawRows([]);
              setResults(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Upload Another CSV
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
