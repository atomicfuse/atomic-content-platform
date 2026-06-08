"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SiteEntry {
  domain: string;
  status: string;
  vertical: string;
  company: string;
  custom_domain: string | null;
}

interface ArticleEntry {
  slug: string;
  title: string;
  status: string;
  featuredImage?: string;
}

interface SkippedArticle {
  slug: string;
  reason: string;
}

interface CopyResult {
  copied: string[];
  skipped: SkippedArticle[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "published") return "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10";
  if (s === "review") return "text-amber-700 dark:text-amber-400 bg-amber-500/10";
  return "text-[var(--text-muted)] bg-[var(--bg-elevated)]";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }): React.ReactElement {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(status)}`}>
      {status}
    </span>
  );
}

function Spinner(): React.ReactElement {
  return (
    <svg
      className="w-4 h-4 animate-spin text-[var(--text-muted)]"
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
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CopyArticlesPage(): React.ReactElement {
  // Site list
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);

  // Selection
  const [sourceDomain, setSourceDomain] = useState<string>("");
  const [targetDomain, setTargetDomain] = useState<string>("");

  // Article list
  const [articles, setArticles] = useState<ArticleEntry[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState<string | null>(null);

  // Checked slugs
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());

  // Copy operation
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load sites on mount
  // ---------------------------------------------------------------------------

  useEffect((): void => {
    setSitesLoading(true);
    setSitesError(null);
    void (async (): Promise<void> => {
      try {
        const res = await fetch("/api/sites/list");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SiteEntry[];
        setSites(data);
      } catch (err) {
        setSitesError(err instanceof Error ? err.message : "Failed to load sites");
      } finally {
        setSitesLoading(false);
      }
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // Load articles when source domain changes
  // ---------------------------------------------------------------------------

  const loadArticles = useCallback(async (domain: string): Promise<void> => {
    setArticles([]);
    setSelectedSlugs(new Set());
    setCopyResult(null);
    setCopyError(null);

    if (!domain) return;

    setArticlesLoading(true);
    setArticlesError(null);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/list`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { articles: ArticleEntry[] };
      setArticles(data.articles);
      // Select all by default
      setSelectedSlugs(new Set(data.articles.map((a) => a.slug)));
    } catch (err) {
      setArticlesError(err instanceof Error ? err.message : "Failed to load articles");
    } finally {
      setArticlesLoading(false);
    }
  }, []);

  useEffect((): void => {
    void loadArticles(sourceDomain);
  }, [sourceDomain, loadArticles]);

  // ---------------------------------------------------------------------------
  // Checkbox handlers
  // ---------------------------------------------------------------------------

  const toggleSlug = useCallback((slug: string): void => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const allSelected = articles.length > 0 && selectedSlugs.size === articles.length;

  const toggleAll = useCallback((): void => {
    if (allSelected) {
      setSelectedSlugs(new Set());
    } else {
      setSelectedSlugs(new Set(articles.map((a) => a.slug)));
    }
  }, [allSelected, articles]);

  // ---------------------------------------------------------------------------
  // Copy action
  // ---------------------------------------------------------------------------

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!sourceDomain || !targetDomain || selectedSlugs.size === 0) return;

    setCopying(true);
    setCopyResult(null);
    setCopyError(null);

    try {
      const res = await fetch("/api/articles/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDomain,
          targetDomain,
          slugs: Array.from(selectedSlugs),
        }),
      });

      const data = (await res.json()) as CopyResult & { error?: string };

      if (!res.ok) {
        setCopyError(data.error ?? `HTTP ${res.status}`);
        return;
      }

      setCopyResult(data);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setCopying(false);
    }
  }, [sourceDomain, targetDomain, selectedSlugs]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const canCopy =
    !!sourceDomain &&
    !!targetDomain &&
    sourceDomain !== targetDomain &&
    selectedSlugs.size > 0 &&
    !copying;

  const activeSites = sites.filter((s) => s.status !== "deleted");

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
          Copy Articles
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Copy articles from one site to another. Articles are written to the
          target site&apos;s staging branch. Existing slugs on the target are
          skipped automatically.
        </p>
      </div>

      {/* Sites error */}
      {sitesError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{sitesError}</p>
        </div>
      )}

      {/* Site selectors */}
      <div className="grid grid-cols-2 gap-4">
        {/* Source */}
        <div className="space-y-1.5">
          <label
            htmlFor="source-select"
            className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
          >
            Source Site
          </label>
          <div className="relative">
            <select
              id="source-select"
              value={sourceDomain}
              onChange={(e): void => {
                setSourceDomain(e.target.value);
              }}
              disabled={sitesLoading}
              className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)] px-3 py-2 pr-8 text-sm outline-none focus:border-cyan disabled:opacity-50"
            >
              <option value="">
                {sitesLoading ? "Loading sites…" : "Select source site"}
              </option>
              {activeSites.map((s) => (
                <option key={s.domain} value={s.domain}>
                  {s.domain}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>

        {/* Target */}
        <div className="space-y-1.5">
          <label
            htmlFor="target-select"
            className="block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
          >
            Target Site
          </label>
          <div className="relative">
            <select
              id="target-select"
              value={targetDomain}
              onChange={(e): void => {
                setTargetDomain(e.target.value);
                setCopyResult(null);
                setCopyError(null);
              }}
              disabled={sitesLoading}
              className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)] px-3 py-2 pr-8 text-sm outline-none focus:border-cyan disabled:opacity-50"
            >
              <option value="">
                {sitesLoading ? "Loading sites…" : "Select target site"}
              </option>
              {activeSites
                .filter((s) => s.domain !== sourceDomain)
                .map((s) => (
                  <option key={s.domain} value={s.domain}>
                    {s.domain}
                  </option>
                ))}
            </select>
            <svg
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>
      </div>

      {/* Article list */}
      {sourceDomain && (
        <div className="space-y-3">
          {/* List header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Articles
              {!articlesLoading && articles.length > 0 && (
                <span className="ml-1.5 text-[var(--text-muted)] font-normal">
                  ({articles.length})
                </span>
              )}
            </h2>
            {!articlesLoading && articles.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs text-cyan hover:text-cyan/80 font-medium transition-colors"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>

          {/* Loading state */}
          {articlesLoading && (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-5 py-4 flex items-center gap-3">
              <Spinner />
              <span className="text-sm text-[var(--text-secondary)]">
                Loading articles…
              </span>
            </div>
          )}

          {/* Error state */}
          {articlesError && !articlesLoading && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{articlesError}</p>
            </div>
          )}

          {/* Empty state */}
          {!articlesLoading && !articlesError && articles.length === 0 && (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-5 py-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">
                No articles found on{" "}
                <span className="font-mono">{sourceDomain}</span>.
              </p>
            </div>
          )}

          {/* Article checklist */}
          {!articlesLoading && articles.length > 0 && (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] overflow-hidden max-h-96 overflow-y-auto">
              {articles.map((article, idx) => {
                const checked = selectedSlugs.has(article.slug);
                const isLast = idx === articles.length - 1;

                return (
                  <label
                    key={article.slug}
                    className={`flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--bg-surface)] transition-colors ${
                      isLast ? "" : "border-b border-[var(--border-secondary)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(): void => toggleSlug(article.slug)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--border-primary)] accent-cyan shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {article.title}
                        </span>
                        <StatusBadge status={article.status} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono text-[var(--text-muted)] truncate">
                          {article.slug}
                        </span>
                        {article.featuredImage && (
                          <span className="text-xs text-[var(--text-muted)] shrink-0">
                            · has image
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Selected count hint */}
          {!articlesLoading && articles.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">
              {selectedSlugs.size} of {articles.length} selected
            </p>
          )}
        </div>
      )}

      {/* Copy button */}
      {sourceDomain && articles.length > 0 && (
        <div>
          <button
            onClick={(): void => { void handleCopy(); }}
            disabled={!canCopy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan text-[var(--bg-primary)] font-semibold text-sm hover:bg-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copying && <Spinner />}
            {copying
              ? "Copying…"
              : `Copy ${selectedSlugs.size} article${selectedSlugs.size !== 1 ? "s" : ""} to ${targetDomain || "target"}`}
          </button>
        </div>
      )}

      {/* Copy error */}
      {copyError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm font-medium text-red-400">Copy failed</p>
          <p className="text-xs text-red-400/80 mt-0.5">{copyError}</p>
        </div>
      )}

      {/* Copy result */}
      {copyResult && (
        <div className="space-y-3">
          {/* Copied */}
          {copyResult.copied.length > 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-400">
                {copyResult.copied.length} article{copyResult.copied.length !== 1 ? "s" : ""} copied successfully
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {copyResult.copied.map((slug) => (
                  <li key={slug} className="text-xs font-mono text-emerald-400/80">
                    {slug}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Skipped */}
          {copyResult.skipped.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-amber-400">
                {copyResult.skipped.length} article{copyResult.skipped.length !== 1 ? "s" : ""} skipped
              </p>
              <ul className="mt-1.5 space-y-1">
                {copyResult.skipped.map((s) => (
                  <li key={s.slug} className="text-xs text-amber-400/80">
                    <span className="font-mono">{s.slug}</span>
                    {" — "}
                    {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {copyResult.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-amber-400">
                {copyResult.warnings.length} warning{copyResult.warnings.length !== 1 ? "s" : ""}
              </p>
              <ul className="mt-1.5 space-y-1">
                {copyResult.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-400/80">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Nothing happened */}
          {copyResult.copied.length === 0 && copyResult.skipped.length === 0 && (
            <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-4 py-3">
              <p className="text-sm text-[var(--text-secondary)]">
                No articles were copied.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
