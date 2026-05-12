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
  | "complete"
  | "error";

interface SSEProgressEvent {
  type: "progress" | "complete" | "error";
  phase?: Phase;
  totalArticles?: number;
  processedArticles?: number;
  currentArticleSlug?: string;
  error?: string;
  successful?: number;
  failed?: number;
}

const PHASE_LABELS: Record<Phase, string> = {
  fetching: "Fetching articles from WordPress",
  converting: "Converting & cleaning up articles",
  "generating-image": "Generating hero images",
  "uploading-image": "Uploading images to R2",
  committing: "Committing to repository",
  complete: "Import complete",
  error: "Error",
};

const PIPELINE_PHASES: Phase[] = [
  "fetching",
  "converting",
  "generating-image",
  "uploading-image",
  "committing",
  "complete",
];

export function ImportPanel(): React.ReactElement {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [wpUrl, setWpUrl] = useState("");
  const [target, setTarget] = useState<"staging" | "main">("staging");
  const [running, setRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<Phase | null>(null);
  const [totalArticles, setTotalArticles] = useState(0);
  const [processedArticles, setProcessedArticles] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ successful: number; failed: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleSiteChange = useCallback((domain: string): void => {
    setSelectedDomain(domain);
    setWpUrl(domain ? `https://${domain}/wp-json/wp/v2/posts` : "");
  }, []);

  const appendLog = useCallback((msg: string): void => {
    setLog((prev) => [...prev, msg]);
  }, []);

  const startImport = useCallback(async (): Promise<void> => {
    if (!selectedDomain || !wpUrl) return;

    setRunning(true);
    setCurrentPhase(null);
    setTotalArticles(0);
    setProcessedArticles(0);
    setLog([]);
    setErrorMsg(null);
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent/wp-migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: selectedDomain,
          wpApiUrl: wpUrl,
          branch: target === "main" ? "main" : `staging/${selectedDomain}`,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as SSEProgressEvent;

            if (evt.type === "progress" && evt.phase) {
              setCurrentPhase(evt.phase);
              if (evt.totalArticles) setTotalArticles(evt.totalArticles);
              if (evt.processedArticles !== undefined) setProcessedArticles(evt.processedArticles);
              if (evt.currentArticleSlug) {
                appendLog(`[${evt.phase}] ${evt.currentArticleSlug}`);
              }
            } else if (evt.type === "complete") {
              setCurrentPhase("complete");
              setResult({
                successful: evt.successful ?? 0,
                failed: evt.failed ?? 0,
              });
              appendLog(`Import complete: ${evt.successful} succeeded, ${evt.failed} failed`);
            } else if (evt.type === "error") {
              setCurrentPhase("error");
              setErrorMsg(evt.error ?? "Unknown error");
              appendLog(`Error: ${evt.error}`);
            }
          } catch {
            /* skip malformed SSE lines */
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        appendLog("Import cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setErrorMsg(msg);
        appendLog(`Error: ${msg}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [selectedDomain, wpUrl, target, appendLog]);

  const cancelImport = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const isDone = currentPhase === "complete";
  const isError = currentPhase === "error";
  const currentPhaseIndex = currentPhase ? PIPELINE_PHASES.indexOf(currentPhase) : -1;

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
        WordPress Import
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mb-8">
        Migrate articles from a WordPress site into the network.
      </p>

      {/* Form */}
      <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5 mb-8">
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            Target Site
          </label>
          <select
            value={selectedDomain}
            onChange={(e): void => handleSiteChange(e.target.value)}
            disabled={running || sitesLoading}
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
            disabled={running}
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
              disabled={running}
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
              disabled={running}
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
              ? `Articles will be committed to staging/${selectedDomain || "<domain>"}`
              : "Articles will be committed directly to main (live site)"}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!running ? (
            <button
              onClick={startImport}
              disabled={!selectedDomain || !wpUrl}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Start Import
            </button>
          ) : (
            <button
              onClick={cancelImport}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress steps */}
      {currentPhase && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 mb-8">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Progress
            {totalArticles > 0 && (
              <span className="ml-2 font-normal text-[var(--text-secondary)]">
                ({processedArticles}/{totalArticles} articles)
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
                    {PHASE_LABELS[phase]}
                  </span>
                </div>
              );
            })}
          </div>

          {isError && errorMsg && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          {isDone && result && (
            <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
              Import finished: {result.successful} article{result.successful !== 1 ? "s" : ""} imported
              {result.failed > 0 && `, ${result.failed} failed`}.
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
