"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createSiteAndBuildStaging } from "@/actions/wizard";
import type { WizardFormData } from "@/types/dashboard";

interface StagingResult {
  stagingUrl: string;
  siteFolder: string;
}

interface StepPreviewProps {
  data: WizardFormData;
  onNext: () => void;
  onBack: () => void;
  onStagingResult?: (result: StagingResult) => void;
  /** If the user already deployed, this is passed back in so the preview survives Next/Back. */
  existingResult?: StagingResult | null;
}

const STAGING_STEPS = [
  { key: "branch", label: "Creating staging branch on GitHub..." },
  { key: "logo", label: "Generating logo with AI..." },
  { key: "commit", label: "Committing site files..." },
  { key: "kv-sync", label: "Waiting for Worker KV sync (sync-kv.yml)..." },
  { key: "done", label: "Staging site is ready!" },
] as const;

export function StepPreview({
  data,
  onNext,
  onBack,
  onStagingResult,
  existingResult,
}: StepPreviewProps): React.ReactElement {
  // If we already have a result from a previous deploy, restore it immediately
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    existingResult?.stagingUrl ?? null
  );
  const [, startBuildTransition] = useTransition();
  const [stagingUrl, setStagingUrl] = useState<string | null>(
    existingResult?.stagingUrl ?? null
  );
  const [deployStep, setDeployStep] = useState(-1);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [waitingForBuild, setWaitingForBuild] = useState(false);
  const [buildStage, setBuildStage] = useState<string>("");
  // EC-13: Track timeout so we can show "Check again" instead of a broken preview.
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // EC-12: Synchronous guard against double-click — set before startTransition
  const deployingRef = useRef(false);
  const { toast } = useToast();

  // Cleanup timers on unmount
  useEffect(() => {
    return (): void => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleBuildStaging(): void {
    // EC-12: Bail if already deploying (double-click guard).
    if (deployingRef.current) return;
    deployingRef.current = true;

    setDeployStep(0);
    setDeployError(null);

    // Advance steps on a timer to show progress (actual work is async)
    const stepDurations = [1500, 4000, 3000, 8000];
    let currentStep = 0;
    let elapsed = 0;

    stepTimerRef.current = setInterval(() => {
      elapsed += 500;
      const target = stepDurations.slice(0, currentStep + 1).reduce((a, b) => a + b, 0);
      if (elapsed >= target && currentStep < STAGING_STEPS.length - 2) {
        currentStep++;
        setDeployStep(currentStep);
      }
    }, 500);

    startBuildTransition(async () => {
      try {
        const result = await createSiteAndBuildStaging(data);

        if (stepTimerRef.current) {
          clearInterval(stepTimerRef.current);
          stepTimerRef.current = null;
        }
        setDeployStep(STAGING_STEPS.length - 1); // "done"

        setStagingUrl(result.stagingUrl);
        onStagingResult?.(result);

        // Poll the Worker preview URL until middleware stops returning 404 —
        // i.e. until sync-kv.yml has populated CONFIG_KV with this site's
        // hostname entry. 60s soft timeout falls through to "give it a moment".
        setWaitingForBuild(true);
        setBuildStage("kv-sync");

        const pollUrl = result.stagingUrl;
        const startedAt = Date.now();
        const TIMEOUT_MS = 120_000;

        let pollInFlight = false;
        // EC-11: Track consecutive non-404 error responses separately.
        let consecutiveErrors = 0;
        pollRef.current = setInterval(async () => {
          if (pollInFlight) return;
          pollInFlight = true;
          try {
            try {
              const res = await fetch(pollUrl, { method: "HEAD", cache: "no-store" });
              // EC-11: Only treat 200-299 as "live". Non-404 error codes
              // (500, 502, etc.) are transient — keep polling instead of
              // incorrectly declaring the site live.
              if (res.ok) {
                consecutiveErrors = 0;
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                setWaitingForBuild(false);
                setPreviewUrl(pollUrl);
                toast("Staging site is live!", "success");
                return;
              }
              if (res.status !== 404) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) {
                  toast("Preview returned an error. The site may still be syncing.", "info");
                  consecutiveErrors = 0; // reset so we don't spam toasts
                }
              } else {
                consecutiveErrors = 0;
              }
            } catch {
              // network blip — keep polling
            }
            if (Date.now() - startedAt > TIMEOUT_MS) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setWaitingForBuild(false);
              // EC-13: Do NOT auto-set previewUrl on timeout — the site
              // isn't confirmed live. Show a helpful message instead.
              setPollTimedOut(true);
              toast("KV sync hasn't completed yet. Use 'Check again' or proceed — the preview will become available once sync finishes.", "info");
            }
          } finally {
            pollInFlight = false;
          }
        }, 5000);
      } catch (error) {
        if (stepTimerRef.current) {
          clearInterval(stepTimerRef.current);
          stepTimerRef.current = null;
        }
        // EC-12: Reset guard so the Retry button can fire again.
        deployingRef.current = false;
        const msg = error instanceof Error ? error.message : "Unknown error";
        setDeployError(msg);
        toast(`Failed to build staging: ${msg}`, "error");
      }
    });
  }

  // EC-13: Re-poll handler for "Check again" button after timeout.
  const handleCheckAgain = useCallback((): void => {
    if (!stagingUrl) return;
    setPollTimedOut(false);
    setWaitingForBuild(true);
    setBuildStage("kv-sync");

    const pollUrl = stagingUrl;
    const startedAt = Date.now();
    const REPOLL_TIMEOUT_MS = 60_000;
    let pollInFlight = false;

    pollRef.current = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        try {
          const res = await fetch(pollUrl, { method: "HEAD", cache: "no-store" });
          if (res.ok) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            setWaitingForBuild(false);
            setPreviewUrl(pollUrl);
            toast("Staging site is live!", "success");
            return;
          }
        } catch { /* keep polling */ }
        if (Date.now() - startedAt > REPOLL_TIMEOUT_MS) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setWaitingForBuild(false);
          setPollTimedOut(true);
          toast("Still not ready. You can try again or proceed.", "info");
        }
      } finally { pollInFlight = false; }
    }, 5000);
  }, [stagingUrl, toast]);

  const isDeploying = deployStep >= 0 && !deployError && !stagingUrl;
  const hasDeployed = !!previewUrl;

  const buildStageLabel: Record<string, string> = {
    "kv-sync": "Worker KV sync running (sync-kv.yml on staging branch)...",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Site Preview</h2>

      {/* Deploy progress */}
      {isDeploying && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-magenta/30 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-magenta animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3 className="font-semibold text-[var(--text-primary)]">
              Deploying to Staging...
            </h3>
          </div>
          <div className="space-y-2">
            {STAGING_STEPS.map((step, i) => {
              const isDone = i < deployStep;
              const isActive = i === deployStep;
              const isFuture = i > deployStep;
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                    isActive ? "bg-magenta/10" : ""
                  } ${isFuture ? "opacity-30" : ""}`}
                >
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    {isDone ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : isActive ? (
                      <svg className="w-4 h-4 text-magenta animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                    )}
                  </div>
                  <span className={`text-sm ${isActive ? "text-[var(--text-primary)] font-medium" : isDone ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deploy error */}
      {deployError && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-6 space-y-3">
          <p className="text-sm text-red-400 font-medium">Staging deploy failed: {deployError}</p>
          <Button variant="ghost" size="sm" onClick={(): void => { setDeployStep(-1); setDeployError(null); handleBuildStaging(); }}>
            Retry Deploy
          </Button>
        </div>
      )}

      {/* Waiting for KV sync to land */}
      {waitingForBuild && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-cyan/30 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-cyan animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3 className="font-semibold text-[var(--text-primary)]">
              Syncing site to Worker KV...
            </h3>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            {buildStageLabel[buildStage] ?? `Stage: ${buildStage}`}
          </p>
          <div className="w-full h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div className="h-full bg-cyan rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
          {stagingUrl && (
            <p className="text-xs text-[var(--text-muted)]">
              Preview will appear at{" "}
              <span className="font-mono text-cyan">{stagingUrl}</span>
              {" "}once KV sync completes (~30-60s)
            </p>
          )}
        </div>
      )}

      {/* EC-13: Timed out — show "Check again" instead of a broken iframe */}
      {pollTimedOut && !previewUrl && !waitingForBuild && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-6 space-y-3">
          <p className="text-sm text-amber-400 font-medium">
            KV sync hasn&apos;t completed yet. The preview will become available once sync finishes.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" onClick={handleCheckAgain}>
              Check again
            </Button>
            <Button variant="ghost" size="sm" onClick={(): void => { if (stagingUrl) setPreviewUrl(stagingUrl); }}>
              Show preview anyway
            </Button>
          </div>
        </div>
      )}

      {/* Initial state — not yet deployed, show Deploy button */}
      {!previewUrl && !isDeploying && !deployError && !waitingForBuild && !pollTimedOut && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-elevated)] p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-magenta/10 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-magenta" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-[var(--text-primary)] text-lg">
                Deploy to Staging
              </h3>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto">
                This commits your site files to a staging branch on GitHub and seeds the multi-tenant Worker so a live preview is ready in ~30-60s.
              </p>
            </div>
            <Button onClick={handleBuildStaging}>
              Deploy Staging
            </Button>
          </div>
        </div>
      )}

      {/* Live preview iframe */}
      {hasDeployed && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <div className="bg-[var(--bg-elevated)] px-4 py-2 flex items-center gap-2 border-b border-[var(--border-secondary)]">
              <span className="w-3 h-3 rounded-full bg-red-400" />
              <span className="w-3 h-3 rounded-full bg-yellow-400" />
              <span className="w-3 h-3 rounded-full bg-green-400" />
              <span className="text-xs text-[var(--text-muted)] ml-2 font-mono">
                {stagingUrl}
              </span>
              <div className="ml-auto">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-magenta/15 text-magenta">
                  Staging
                </span>
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="w-full h-[500px] bg-white"
              title="Site Preview"
              sandbox="allow-scripts"
            />
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Live staging preview from the multi-tenant site-worker.
          </p>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={isDeploying || waitingForBuild}>
          &larr; Back
        </Button>
        <Button onClick={onNext} disabled={(!previewUrl && !pollTimedOut) || isDeploying}>
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
