"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { parseSimilarwebCsv } from "@/lib/similarweb/parse";
import { matchSimilarwebRows } from "@/lib/similarweb/match";

/** Asaf's checklist page (private — share it from its Share menu to let others run the monthly check). */
const CHECKLIST_URL = "https://claude.ai/artifact/PRfFbfoS77CbdpJZPpjqgk";

interface SimilarwebImportModalProps {
  open: boolean;
  onClose: () => void;
  sites: Array<{ domain: string; custom_domain?: string | null }>;
  onImported: () => void;
}

interface Preview {
  error: string | null;
  rows: number;
  yes: number;
  no: number;
  unknown: string[];
  rejected: Array<{ line: number; reason: string }>;
  matched: number;
}

function buildPreview(text: string, sites: SimilarwebImportModalProps["sites"]): Preview {
  const parsed = parseSimilarwebCsv(text);
  if (parsed.missingColumns.length > 0) {
    return { error: `This doesn't look like the checklist results — missing column: ${parsed.missingColumns.join(", ")}`, rows: 0, yes: 0, no: 0, unknown: [], rejected: [], matched: 0 };
  }
  const { statuses, unknown } = matchSimilarwebRows(parsed.rows, sites, new Date().toISOString());
  return {
    error: null,
    rows: parsed.rows.length + parsed.rejected.length + parsed.ignored,
    yes: statuses.filter((s) => s.has_rank).length,
    no: statuses.filter((s) => !s.has_rank).length,
    unknown,
    rejected: parsed.rejected,
    matched: statuses.length,
  };
}

export function SimilarwebImportModal({ open, onClose, sites, onImported }: SimilarwebImportModalProps): React.ReactElement {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((content) => { setText(content); setPreview(null); });
    e.target.value = "";
  }

  async function handleImport(): Promise<void> {
    setImporting(true);
    try {
      const res = await fetch("/api/sites/similarweb/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = (await res.json()) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast(`Similarweb updated for ${data.updated ?? 0} sites`, "success");
      onImported();
      setText("");
      setPreview(null);
      onClose();
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Update Similarweb data" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Once a month, check each site with the Similarweb extension on the{" "}
          <a href={CHECKLIST_URL} target="_blank" rel="noopener noreferrer" className="text-cyan underline">checklist page</a>
          , click <strong>Copy results</strong>, and paste them here (or upload the saved .csv).
        </p>
        <label htmlFor="sw-results" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Checklist results
        </label>
        <textarea
          id="sw-results"
          value={text}
          onChange={(e): void => { setText(e.target.value); setPreview(null); }}
          rows={8}
          placeholder="domain,site,similarweb,global_rank,monthly_visits"
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 font-mono text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer text-sm text-[var(--text-secondary)] underline">
            Upload .csv
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          <Button variant="secondary" size="sm" onClick={(): void => setPreview(buildPreview(text, sites))} disabled={!text.trim()}>
            Preview
          </Button>
        </div>

        {preview && (
          <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 space-y-2" role="status">
            {preview.error ? (
              <p className="text-sm text-red-400">{preview.error}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {`${preview.rows} rows · ${preview.yes} has rank · ${preview.no} no rank · ${preview.unknown.length} not matched · ${preview.rejected.length} rejected`}
                </p>
                {preview.unknown.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)]">
                    Not matched to a site (skipped):
                    <ul className="mt-1 flex flex-wrap gap-2">{preview.unknown.map((u) => <li key={u} className="font-mono">{u}</li>)}</ul>
                  </div>
                )}
                {preview.rejected.length > 0 && (
                  <ul className="text-xs text-red-400 space-y-0.5">
                    {preview.rejected.map((r) => <li key={r.line}>Line {r.line}: {r.reason}</li>)}
                  </ul>
                )}
                {preview.matched > 0 && (
                  <Button variant="primary" size="sm" loading={importing} onClick={(): void => { void handleImport(); }}>
                    {`Import ${preview.matched} sites`}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
