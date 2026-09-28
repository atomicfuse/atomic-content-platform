"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import type { GridSummaryStatus } from "@/types/grid";

interface SummaryEditorProps {
  site: string;
  slug: string;
  title: string;
  status: GridSummaryStatus;
  onClose: () => void;
  onSaved: () => void;
}

/** Modal markdown editor for one Grid AI summary — view, hand-edit, or regenerate. */
export function SummaryEditor({ site, slug, title, status, onClose, onSaved }: SummaryEditorProps): React.ReactElement {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const res = await fetch(`/api/grid/summary?site=${encodeURIComponent(site)}&slug=${encodeURIComponent(slug)}`);
      const data = (await res.json().catch(() => ({}))) as { exists?: boolean; markdown?: string };
      if (cancelled) return;
      setMarkdown(data.exists ? data.markdown ?? "" : "");
      setLoading(false);
    })();
    return (): void => {
      cancelled = true;
    };
  }, [site, slug]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return (): void => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function call(url: string, init: RequestInit): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function regenerate(): void {
    if (
      (status === "edited" || status === "stale") &&
      !window.confirm("This summary was edited by hand. Regenerating replaces the edit. Continue?")
    ) {
      return;
    }
    void call("/api/grid/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, slug }),
    });
  }

  function save(): void {
    void call("/api/grid/summary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, slug, markdown }),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Summary for ${title}`}
        onClick={(e): void => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5 space-y-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none"
          >
            ×
          </button>
        </header>

        {status === "stale" && (
          <div className="rounded border-l-2 border-amber-500/60 bg-amber-500/10 pl-3 py-2 text-xs text-amber-400">
            The source article changed after this summary was edited.
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <Textarea
            label="Summary markdown"
            value={markdown}
            onChange={(e): void => setMarkdown(e.target.value)}
            className="h-72 font-mono resize-none"
          />
        )}

        <p className="text-[11px] text-[var(--text-muted)]">
          One “## ” headline, then “### ” sections. Links and HTML are removed. Changes appear on the site after the
          next Grid sync (a few minutes).
        </p>

        {error && <p className="text-xs text-error">{error}</p>}

        <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={regenerate} disabled={busy}>
            Regenerate
          </Button>
          <Button onClick={save} loading={busy} disabled={busy || loading || !markdown.trim()}>
            Save summary
          </Button>
        </footer>
      </div>
    </div>
  );
}
