"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createSiteAndBuildStaging } from "@/actions/wizard";
import type { WizardFormData } from "@/types/dashboard";

interface StepPreviewProps {
  data: WizardFormData;
  onNext: () => void;
  onBack: () => void;
}

export function StepPreview({
  data,
  onNext,
  onBack,
}: StepPreviewProps): React.ReactElement {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"local" | "staging" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isBuildPending, startBuildTransition] = useTransition();
  const [stagingUrl, setStagingUrl] = useState<string | null>(null);
  const { toast } = useToast();

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
    startBuildTransition(async () => {
      try {
        const result = await createSiteAndBuildStaging(data);
        setStagingUrl(result.stagingUrl);
        setPreviewUrl(result.stagingUrl);
        setPreviewMode("staging");
        toast("Staging build triggered & site files committed", "success");
      } catch (error) {
        toast(
          `Failed to build staging: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Site Preview</h2>

      {!previewUrl ? (
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
                  {isBuildPending ? "Deploying..." : "Deploy Staging"}
                </h3>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Commit site files to GitHub & trigger a real Cloudflare Pages staging build.
              </p>
            </button>
          </div>
        </div>
      ) : (
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
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext} disabled={!previewUrl}>
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
