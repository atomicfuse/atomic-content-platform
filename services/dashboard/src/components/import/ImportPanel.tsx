"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SiteEntry {
  domain: string;
  status: string;
}

type Phase =
  | "fetching"
  | "converting"
  | "generating-image"
  | "uploading-image"
  | "committing"
  | "triggering-images"
  | "complete"
  | "error";

interface ArticleImportProgress {
  jobId: string;
  site: string;
  status: "pending" | "running" | "complete" | "failed";
  phase?: string;
  totalArticles: number;
  processedArticles: number;
  successfulArticles: number;
  failedArticles: number;
  currentArticleSlug?: string;
  error?: string;
}

const PHASE_LABELS: Record<string, string> = {
  fetching: "Fetching articles from WordPress",
  converting: "Converting & cleaning up articles",
  "generating-image": "Generating hero images",
  "uploading-image": "Uploading images to R2",
  committing: "Committing to repository",
  "triggering-images": "Triggering image generation",
  complete: "Import complete",
  error: "Error",
};

const PIPELINE_PHASES: Phase[] = [
  "fetching",
  "converting",
  "generating-image",
  "uploading-image",
  "committing",
  "triggering-images",
  "complete",
];

const POLL_INTERVAL_MS = 2000;

/** Key used to persist active job in localStorage so it survives page refreshes. */
const STORAGE_KEY = "wp-article-import-job";

export function ImportPanel(): React.ReactElement {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [siteTopics, setSiteTopics] = useState<string[]>([]);
  const [wpUrl, setWpUrl] = useState("");
  const [target, setTarget] = useState<"staging" | "main">("staging");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ArticleImportProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const logEndRef = useRef<HTMLDivElement | null>(null);
  const prevSlugRef = useRef<string | undefined>(undefined);

  // Restore active job from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { jobId: string; domain: string };
        if (parsed.jobId) {
          setJobId(parsed.jobId);
          setSelectedDomain(parsed.domain ?? "");
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Load sites list
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const res = await fetch("/api/sites/list");
        if (!res.ok) throw new Error("Failed to load sites");
        const data = (await res.json()) as SiteEntry[];
        if (!cancelled) setSites(data);
      } catch {
        if (!cancelled) setSites([]);
      } finally {
        if (!cancelled) setSitesLoading(false);
      }
    })();
    return (): void => { cancelled = true; };
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleSiteChange = useCallback((domain: string): void => {
    setSelectedDomain(domain);
    setSiteTopics([]);
    setWpUrl(domain ? `https://${domain}/wp-json/wp/v2/posts` : "");
    if (domain) {
      fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: { config?: { brief?: { topics?: string[] } } } | null) => {
          const topics = data?.config?.brief?.topics;
          if (Array.isArray(topics) && topics.length > 0) {
            setSiteTopics(topics);
          }
        })
        .catch(() => { /* non-fatal */ });
    }
  }, []);

  const appendLog = useCallback((msg: string): void => {
    setLog((prev) => [...prev, msg]);
  }, []);

  // Poll for job status
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/agent/wp-migrate/article-import-status/${jobId}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as ArticleImportProgress;
        if (cancelled) return;

        setProgress(data);

        // Append log for new article slugs
        if (data.currentArticleSlug && data.currentArticleSlug !== prevSlugRef.current) {
          prevSlugRef.current = data.currentArticleSlug;
          appendLog(`[${data.phase ?? "processing"}] ${data.currentArticleSlug}`);
        }

        if (data.status === "complete") {
          appendLog(`Import complete: ${data.successfulArticles} succeeded, ${data.failedArticles} failed`);
          localStorage.removeItem(STORAGE_KEY);
        } else if (data.status === "failed") {
          appendLog(`Error: ${data.error ?? "Unknown error"}`);
          setErrorMsg(data.error ?? "Unknown error");
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Silently retry
      }
    };

    // Poll immediately, then on interval
    void poll();
    const interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    return (): void => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, appendLog]);

  const startImport = useCallback(async (): Promise<void> => {
    if (!selectedDomain || !wpUrl) return;

    setSubmitting(true);
    setProgress(null);
    setLog([]);
    setErrorMsg(null);
    prevSlugRef.current = undefined;

    try {
      const res = await fetch("/api/agent/wp-migrate/import-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: selectedDomain,
          wpApiUrl: wpUrl,
          branch: target === "main" ? "main" : `staging/${selectedDomain}`,
          ...(siteTopics.length > 0 ? { menuItems: siteTopics } : {}),
        }),
      });

      const data = (await res.json()) as { jobId?: string; error?: string };

      if (!res.ok || !data.jobId) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }

      setJobId(data.jobId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: data.jobId, domain: selectedDomain }));
      appendLog(`Import enqueued — job ${data.jobId.slice(0, 8)}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }, [selectedDomain, wpUrl, target, siteTopics, appendLog]);

  const handleReset = useCallback((): void => {
    setJobId(null);
    setProgress(null);
    setLog([]);
    setErrorMsg(null);
    prevSlugRef.current = undefined;
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const currentPhase = progress?.phase as Phase | undefined;
  const isDone = progress?.status === "complete";
  const isFailed = progress?.status === "failed";
  const isRunning = !!jobId && !isDone && !isFailed;
  const currentPhaseIndex = currentPhase ? PIPELINE_PHASES.indexOf(currentPhase) : -1;

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Import Articles from WordPress
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Select a site and its WordPress API URL to migrate articles.
            Import runs in the background — you can close this tab safely.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            Target Site
          </label>
          <select
            value={selectedDomain}
            onChange={(e): void => handleSiteChange(e.target.value)}
            disabled={isRunning || submitting || sitesLoading}
            className="w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">
              {sitesLoading ? "Loading sites..." : "Select a site"}
            </option>
            {sites.map((s) => (
              <option key={s.domain} value={s.domain}>
                {s.domain}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            WordPress Posts API URL
          </label>
          <input
            type="text"
            value={wpUrl}
            onChange={(e): void => setWpUrl(e.target.value)}
            disabled={isRunning || submitting}
            placeholder="https://example.com/wp-json/wp/v2/posts"
            className="w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
          />
        </div>

        {/* Deploy target */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            Deploy To
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={(): void => setTarget("staging")}
              disabled={isRunning || submitting}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                target === "staging"
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Staging
            </button>
            <button
              type="button"
              onClick={(): void => setTarget("main")}
              disabled={isRunning || submitting}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                target === "main"
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Live (main)
            </button>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {target === "staging"
              ? `Articles will be committed to staging/${selectedDomain || "<domain>"}. You can deploy to production after reviewing.`
              : `Articles will be committed to both main and staging/${selectedDomain || "<domain>"}`}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!isRunning ? (
            <button
              onClick={startImport}
              disabled={!selectedDomain || !wpUrl || submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Start Import"}
            </button>
          ) : (
            <span className="px-4 py-2 rounded-lg text-sm font-medium text-cyan bg-cyan/10">
              Import running in background...
            </span>
          )}
          {(isDone || isFailed) && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              New Import
            </button>
          )}
        </div>
      </div>

      {/* Submission error (e.g. dedup lock — no job created, so no progress to show) */}
      {errorMsg && !progress && !isRunning && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Progress steps */}
      {progress && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Progress
            {progress.totalArticles > 0 && (
              <span className="ml-2 font-normal text-[var(--text-secondary)]">
                ({progress.processedArticles}/{progress.totalArticles} articles
                {(progress.successfulArticles > 0 || progress.failedArticles > 0) && (
                  <>
                    {" — "}
                    <span className="text-green-500">{progress.successfulArticles} succeeded</span>
                    {progress.failedArticles > 0 && (
                      <>, <span className="text-red-400">{progress.failedArticles} failed</span></>
                    )}
                  </>
                )}
                )
              </span>
            )}
          </h2>

          <div className="space-y-3">
            {PIPELINE_PHASES.map((phase, idx) => {
              const isCurrent = phase === currentPhase;
              const isComplete = idx < currentPhaseIndex || isDone;
              const isPending = idx > currentPhaseIndex && !isDone;

              return (
                <div key={phase} className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isComplete
                        ? "bg-green-500 text-white"
                        : isCurrent
                          ? "bg-cyan text-white animate-pulse"
                          : isPending
                            ? "border border-[var(--border-secondary)] text-[var(--text-tertiary)]"
                            : "border border-[var(--border-secondary)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    {isComplete ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span
                    className={`text-sm ${
                      isCurrent
                        ? "text-[var(--text-primary)] font-medium"
                        : isComplete
                          ? "text-green-500"
                          : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {PHASE_LABELS[phase] ?? phase}
                  </span>
                </div>
              );
            })}
          </div>

          {isFailed && errorMsg && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          {isDone && (
            <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
              Import finished: {progress.successfulArticles} article{progress.successfulArticles !== 1 ? "s" : ""} imported
              {progress.failedArticles > 0 && `, ${progress.failedArticles} failed`}.
            </div>
          )}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            Log
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-[var(--bg-primary)] border border-[var(--border-secondary)] p-3 font-mono text-xs text-[var(--text-secondary)] space-y-0.5">
            {log.map((entry, i) => (
              <div key={i}>{entry}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
