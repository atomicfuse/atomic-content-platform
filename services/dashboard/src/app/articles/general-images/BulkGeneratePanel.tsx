"use client";

import { useState, useCallback } from "react";
import type { SiteBreakdownEntry } from "@/app/api/articles/general-images/route";

interface BulkImageResponse {
  dry_run: boolean;
  scope: string;
  domain?: string;
  queued: number;
  skipped: number;
  skipped_reasons: { domain: string; slug: string; reason: string }[];
  batch_size: number;
  batch_pause_seconds: number;
  total_batches: number;
  estimated_total_seconds: number;
  articles: { domain: string; slug: string; title: string }[];
  error?: string;
}

interface BulkGeneratePanelProps {
  siteBreakdown: SiteBreakdownEntry[];
}

export function BulkGeneratePanel({
  siteBreakdown,
}: BulkGeneratePanelProps): React.ReactElement {
  const [scope, setScope] = useState<"all" | "site">("site");
  const [domain, setDomain] = useState(siteBreakdown[0]?.domain ?? "");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkImageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async (): Promise<void> => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const body: Record<string, unknown> = { scope, dry_run: dryRun };
      if (scope === "site") body.domain = domain;

      const res = await fetch("/api/agent/bulk-generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as BulkImageResponse;

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      setResult(data);
    } catch {
      setError("Failed to reach the server");
    } finally {
      setLoading(false);
    }
  }, [scope, domain, dryRun]);

  const totalArticles = siteBreakdown.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Bulk Image Generation
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          Trigger AI image generation for articles still using default images.
          Images are generated in batches of 3 with a 3-minute pause between
          batches.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {/* Scope selector */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">
            Scope
          </label>
          <select
            value={scope}
            onChange={(e): void => setScope(e.target.value as "all" | "site")}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] outline-none focus:border-cyan"
          >
            <option value="all">All Sites ({totalArticles} articles)</option>
            <option value="site">Single Site</option>
          </select>
        </div>

        {/* Site selector (shown when scope=site) */}
        {scope === "site" && (
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Site
            </label>
            <select
              value={domain}
              onChange={(e): void => setDomain(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] outline-none focus:border-cyan min-w-[200px]"
            >
              {siteBreakdown.map((s) => (
                <option key={s.domain} value={s.domain}>
                  {s.domain} ({s.count} article{s.count !== 1 ? "s" : ""})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Dry run toggle */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--text-secondary)]">
            Mode
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={(): void => setDryRun(true)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                dryRun
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Preview
            </button>
            <button
              onClick={(): void => setDryRun(false)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                !dryRun
                  ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Generate
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          onClick={(): void => {
            void handleGenerate();
          }}
          disabled={loading || (scope === "site" && !domain)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan text-white hover:bg-cyan/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
              />
            </svg>
          )}
          {loading ? "Processing..." : dryRun ? "Preview Articles" : "Generate Images"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] px-4 py-2.5">
              <div className="text-xs text-[var(--text-muted)]">Queued</div>
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                {result.queued}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] px-4 py-2.5">
              <div className="text-xs text-[var(--text-muted)]">Skipped</div>
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                {result.skipped}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] px-4 py-2.5">
              <div className="text-xs text-[var(--text-muted)]">Batches</div>
              <div className="text-lg font-semibold text-[var(--text-primary)]">
                {result.total_batches}
              </div>
            </div>
            {!result.dry_run && result.estimated_total_seconds > 0 && (
              <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] px-4 py-2.5">
                <div className="text-xs text-[var(--text-muted)]">
                  Est. Dispatch Time
                </div>
                <div className="text-lg font-semibold text-[var(--text-primary)]">
                  {Math.ceil(result.estimated_total_seconds / 60)} min
                </div>
              </div>
            )}
          </div>

          {/* Mode badge */}
          <div className="flex items-center gap-2">
            {result.dry_run ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan/10 text-cyan">
                Preview only — no images were generated
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                Generation started — images will be generated in the background
              </span>
            )}
          </div>

          {/* Skipped reasons */}
          {result.skipped_reasons.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                Skipped Articles
              </h3>
              <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-3 py-2 text-xs space-y-1">
                {result.skipped_reasons.map((s) => (
                  <div
                    key={`${s.domain}::${s.slug}`}
                    className="text-yellow-700 dark:text-yellow-400"
                  >
                    <span className="font-mono">{s.domain}/{s.slug}</span>
                    {" — "}
                    {s.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Article list */}
          {result.articles.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">
                {result.dry_run ? "Articles that would be queued" : "Queued Articles"} ({result.articles.length})
              </h3>
              <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)]">
                      <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">
                        Site
                      </th>
                      <th className="text-left px-3 py-2 text-[var(--text-muted)] font-medium">
                        Article
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.articles.map((a) => (
                      <tr
                        key={`${a.domain}::${a.slug}`}
                        className="border-b border-[var(--border-secondary)] last:border-b-0"
                      >
                        <td className="px-3 py-1.5 font-mono text-cyan">
                          {a.domain}
                        </td>
                        <td className="px-3 py-1.5 text-[var(--text-primary)]">
                          {a.title}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
