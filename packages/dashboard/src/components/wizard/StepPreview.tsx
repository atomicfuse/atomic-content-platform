"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createSiteAndBuildStaging } from "@/actions/wizard";
import type { WizardFormData } from "@/types/dashboard";

interface StepPreviewProps {
  data: WizardFormData;
  onNext: () => void;
  onBack: () => void;
  onStagingResult?: (result: { stagingUrl: string; pagesProject: string }) => void;
}

const STAGING_STEPS = [
  { key: "project", label: "Creating Cloudflare Pages project..." },
  { key: "branch", label: "Creating staging branch on GitHub..." },
  { key: "logo", label: "Generating logo with AI..." },
  { key: "commit", label: "Committing site files..." },
  { key: "build", label: "Triggering staging build..." },
  { key: "done", label: "Staging site created!" },
] as const;

export function StepPreview({
  data,
  onNext,
  onBack,
  onStagingResult,
}: StepPreviewProps): React.ReactElement {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"local" | "staging" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isBuildPending, startBuildTransition] = useTransition();
  const [stagingUrl, setStagingUrl] = useState<string | null>(null);
  const [deployStep, setDeployStep] = useState(-1); // -1 = not started
  const [deployError, setDeployError] = useState<string | null>(null);
  const [waitingForBuild, setWaitingForBuild] = useState(false);
  const [buildStage, setBuildStage] = useState<string>(""); // current CF build stage
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stagingResultRef = useRef<{ stagingUrl: string; pagesProject: string } | null>(null);
  const { toast } = useToast();

  // Cleanup timers on unmount
  useEffect(() => {
    return (): void => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleLocalPreview(): void {
    startTransition(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to generate preview");
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewMode("local");
      } catch (error) {
        toast(
          `Preview error: ${error instanceof Error ? error.message : "Unknown"}`,
          "error"
        );
      }
    });
  }

  function handleBuildStaging(): void {
    setDeployStep(0);
    setDeployError(null);

    // Advance steps on a timer to show progress (actual work is async)
    // Steps roughly correspond to the operations in createSiteAndBuildStaging
    const stepDurations = [2000, 1500, 4000, 3000, 2000]; // ms per step
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

        // Stop progress timer and jump to "done" step
        if (stepTimerRef.current) {
          clearInterval(stepTimerRef.current);
          stepTimerRef.current = null;
        }
        setDeployStep(STAGING_STEPS.length - 1); // "done"

        // Store result but DON'T show iframe yet — wait for CF build to finish
        stagingResultRef.current = result;
        setStagingUrl(result.stagingUrl);
        onStagingResult?.(result);

        // Start polling CF for build readiness
        setWaitingForBuild(true);
        setBuildStage("queued");

        // Pass the staging URL so the server can probe SSL readiness too
        const pollUrl = `/api/agent/deployment?project=${encodeURIComponent(result.pagesProject)}&url=${encodeURIComponent(result.stagingUrl)}`;

        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch(pollUrl);
            if (!res.ok) return;
            const pollData = (await res.json()) as {
              is_ready?: boolean;
              deploy_ready?: boolean;
              ssl_ready?: boolean;
              stage?: string;
              stage_status?: string;
            };
            // Show real CF build stage
            if (pollData.stage) setBuildStage(pollData.stage);
            // Once deploy is done but SSL pending, update the label
            if (pollData.deploy_ready && !pollData.ssl_ready) {
              setBuildStage("ssl");
            }
            if (pollData.is_ready) {
              // Build AND SSL are ready — safe to show iframe
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setWaitingForBuild(false);
              setPreviewUrl(result.stagingUrl);
              setPreviewMode("staging");
              toast("Staging build is live!", "success");
            }
          } catch {
            // Keep polling
          }
        }, 5000); // Poll every 5 seconds

        // Safety timeout — stop polling after 5 minutes
        setTimeout(() => {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setWaitingForBuild(false);
            // Show iframe anyway — it might be ready by the time user looks
            setPreviewUrl(result.stagingUrl);
            setPreviewMode("staging");
            toast("Build may still be deploying. Preview link is ready to check.", "info");
          }
        }, 5 * 60 * 1000);
      } catch (error) {
        if (stepTimerRef.current) {
          clearInterval(stepTimerRef.current);
          stepTimerRef.current = null;
        }
        const msg = error instanceof Error ? error.message : "Unknown error";
        setDeployError(msg);
        toast(`Failed to build staging: ${msg}`, "error");
      }
    });
  }

  const isDeploying = deployStep >= 0 && !deployError && !stagingUrl;

  const buildStageLabel: Record<string, string> = {
    queued: "Queued — waiting for Cloudflare...",
    initialize: "Initializing build environment...",
    clone_repo: "Cloning repository...",
    build: "Building site with Astro...",
    deploy: "Deploying to edge network...",
    ssl: "Deployed! Waiting for SSL certificate...",
    active: "Deployment is live!",
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Site Preview</h2>

      {/* Deploy progress overlay */}
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
          <Button variant="ghost" size="sm" onClick={(): void => { setDeployStep(-1); setDeployError(null); }}>
            Try Again
          </Button>
        </div>
      )}

      {/* Waiting for CF build to finish */}
      {waitingForBuild && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-cyan/30 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-cyan animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3 className="font-semibold text-[var(--text-primary)]">
              Building on Cloudflare Pages...
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
              {" "}once the build completes (~1-2 min)
            </p>
          )}
        </div>
      )}

      {!previewUrl && !isDeploying && !deployError && !waitingForBuild ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 text-center space-y-2">
            <p className="text-[var(--text-secondary)]">
              Choose how to preview your site:
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Local Preview */}
            <button
              onClick={handleLocalPreview}
              disabled={isPending}
              className="rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6 text-left hover:border-cyan transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-cyan/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-[var(--text-primary)]">
                  {isPending ? "Generating..." : "Quick Preview"}
                </h3>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Instantly see how your site will look based on your wizard settings. No deployment needed.
              </p>
            </button>

            {/* Staging Deploy */}
            <button
              onClick={handleBuildStaging}
              disabled={isBuildPending}
              className="rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6 text-left hover:border-magenta transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-magenta/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-magenta" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-[var(--text-primary)]">
                  Deploy Staging
                </h3>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Commit site files to GitHub & trigger a real Cloudflare Pages staging build.
              </p>
            </button>
          </div>
        </div>
      ) : previewUrl ? (
        <div className="space-y-4">
          {/* Browser chrome */}
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <div className="bg-[var(--bg-elevated)] px-4 py-2 flex items-center gap-2 border-b border-[var(--border-secondary)]">
              <span className="w-3 h-3 rounded-full bg-red-400" />
              <span className="w-3 h-3 rounded-full bg-yellow-400" />
              <span className="w-3 h-3 rounded-full bg-green-400" />
              <span className="text-xs text-[var(--text-muted)] ml-2 font-mono">
                {previewMode === "local" ? `${data.domain} (local preview)` : stagingUrl}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {previewMode === "local" && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan/15 text-cyan">
                    Local
                  </span>
                )}
                {previewMode === "staging" && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-magenta/15 text-magenta">
                    Staging
                  </span>
                )}
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="w-full h-[500px] bg-white"
              title="Site Preview"
              sandbox="allow-scripts"
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">
              {previewMode === "local"
                ? "This is a local mockup based on your wizard data. Deploy staging for a real build."
                : "Live staging preview from Cloudflare Pages."}
            </p>
            <div className="flex gap-2">
              {previewMode === "local" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBuildStaging}
                  loading={isBuildPending}
                >
                  Deploy Staging Too
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(): void => {
                  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setPreviewMode(null);
                }}
              >
                Reset Preview
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} disabled={isDeploying}>
          &larr; Back
        </Button>
        <Button onClick={onNext} disabled={!previewUrl || isDeploying}>
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
