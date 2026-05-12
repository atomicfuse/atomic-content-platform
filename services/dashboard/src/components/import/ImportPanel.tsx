"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SiteEntry {
  domain: string;
  status: string;
  vertical?: string;
  company?: string;
  custom_domain?: string;
}

type Phase =
  | "fetching"
  | "converting"
  | "uploading"
  | "committing"
  | "done"
  | "error";

interface ProgressEvent {
  phase: Phase;
  step: number;
  total: number;
  current: number;
  message: string;
  articleSlug?: string;
  error?: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  fetching: "Fetching posts from WordPress",
  converting: "Converting to Markdown",
  uploading: "Uploading articles",
  committing: "Committing to repository",
  done: "Import complete",
  error: "Error",
};

const PHASE_ORDER: Phase[] = [
  "fetching",
  "converting",
  "uploading",
  "committing",
  "done",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ImportPanel(): React.ReactElement {
  /* --- state --- */
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [wpUrl, setWpUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  /* --- fetch sites on mount --- */
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
    return (): void => {
      cancelled = true;
    };
  }, []);

  /* --- auto-scroll log --- */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  /* --- handle site selection --- */
  const handleSiteChange = useCallback(
    (domain: string): void => {
      setSelectedDomain(domain);
      const match = sites.find((s) => s.domain === domain);
      if (match?.custom_domain) {
        setWpUrl(`https://${match.custom_domain}/wp-json/wp/v2`);
      } else if (domain) {
        setWpUrl(`https://${domain}/wp-json/wp/v2`);
      } else {
        setWpUrl("");
      }
    },
    [sites],
  );

  /* --- start import --- */
  const startImport = useCallback(async (): Promise<void> => {
    if (!selectedDomain || !wpUrl) return;

    setRunning(true);
    setProgress(null);
    setLog([]);
    setErrorMsg(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent/wp-migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain: selectedDomain, wpApiUrl: wpUrl }),
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
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const evt = JSON.parse(payload) as ProgressEvent;
            setProgress(evt);
            setLog((prev) => [...prev, evt.message]);

            if (evt.phase === "error") {
              setErrorMsg(evt.error ?? evt.message);
            }
          } catch {
            /* skip malformed SSE lines */
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setLog((prev) => [...prev, "Import cancelled."]);
      } else {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        setErrorMsg(msg);
        setLog((prev) => [...prev, `Error: ${msg}`]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [selectedDomain, wpUrl]);

  /* --- cancel --- */
  const cancelImport = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  /* --- derived --- */
  const isDone = progress?.phase === "done";
  const isError = progress?.phase === "error";
  const currentPhaseIdx = progress
    ? PHASE_ORDER.indexOf(progress.phase)
    : -1;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">
        WordPress Import
      </h1>
      <p className="text-sm text-[var(--text-secondary)] mb-8">
        Migrate content from a WordPress site into the network.
      </p>

      {/* ---- Form ---- */}
      <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5 mb-8">
        {/* Site selector */}
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
                {s.company ? ` (${s.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* WP API URL */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            WordPress API URL
          </label>
          <input
            type="text"
            value={wpUrl}
            onChange={(e): void => setWpUrl(e.target.value)}
            disabled={running}
            placeholder="https://example.com/wp-json/wp/v2"
            className="w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
          />
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            The REST API base URL of the source WordPress site.
          </p>
        </div>

        {/* Actions */}
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

      {/* ---- Progress steps ---- */}
      {progress && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 mb-8">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Progress
          </h2>

          <div className="space-y-3">
            {PHASE_ORDER.map((phase, idx) => {
              const isCurrent = phase === progress.phase;
              const isComplete = idx < currentPhaseIdx || isDone;
              const isPending = idx > currentPhaseIdx && !isDone;

              return (
                <div key={phase} className="flex items-center gap-3">
                  {/* indicator */}
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

                  {/* label */}
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

                  {/* article progress for current phase */}
                  {isCurrent && progress.total > 0 && (
                    <span className="text-xs text-[var(--text-secondary)] ml-auto">
                      {progress.current}/{progress.total}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* error badge */}
          {isError && errorMsg && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          {/* done summary */}
          {isDone && (
            <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
              Import finished successfully.{" "}
              {progress.current > 0 && (
                <span className="font-medium">
                  {progress.current} article{progress.current !== 1 ? "s" : ""}{" "}
                  imported.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Log ---- */}
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
