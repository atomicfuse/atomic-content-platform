"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  goLive,
  publishStagingToProduction,
  saveStagingPreview,
  refreshPreviewUrl,
  ensureStagingBranch,
} from "@/actions/wizard";
import { StagingEditPanel } from "./StagingEditPanel";
import { workerPreviewUrl } from "@/lib/constants";
import type { SiteStatus } from "@/types/dashboard";

interface StagingTabProps {
  /** The network-repo directory slug for this site (e.g. "coolnews-atl").
   *  Stored in `dashboard-index.yaml` under the `domain` field — NOT the
   *  numeric `site_id` field, which is an unrelated internal id. Used as
   *  both the KV site config key and the `?_atl_site=` Worker override. */
  domain: string;
  pagesProject: string | null;
  pagesSubdomain: string | null;
  stagingBranch: string | null;
  previewUrl: string | null;
  savedPreviews: Array<{ url: string; label: string; saved_at: string }> | null;
  siteStatus: SiteStatus;
  customDomain: string | null;
  currentLogoPath: string | null;
  currentFaviconPath: string | null;
}

export function StagingTab({
  domain,
  pagesProject,
  pagesSubdomain,
  stagingBranch,
  previewUrl,
  savedPreviews,
  siteStatus,
  customDomain,
  currentLogoPath,
  currentFaviconPath,
}: StagingTabProps): React.ReactElement {
  const [currentStagingBranch, setCurrentStagingBranch] = useState(stagingBranch);

  // Post-migration: Pages projects no longer exist. Both the prominent
  // "Worker Preview" block and the inline "Staging Preview" link below
  // resolve to the same staging Worker URL — `?_atl_site=<domain>` forces
  // the right tenant. The `pagesProject` / `pagesSubdomain` props are
  // unused; kept on the interface for caller backward-compat.
  void pagesProject;
  void pagesSubdomain;
  const workerUrl = domain ? workerPreviewUrl(domain) : null;
  const currentPreviewUrl = currentStagingBranch ? workerUrl : previewUrl;
  const [isRefreshing, startRefresh] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isGoingLive, startGoLive] = useTransition();
  const [isPublishing, startPublish] = useTransition();
  const [isEnsuring, startEnsure] = useTransition();
  const { toast } = useToast();

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");

  // Determine mode: "initial" = first go-live (Staging/New), "live" = already live/ready
  const isLiveMode = siteStatus === "Ready" || siteStatus === "Live";
  const hasStagingBranch = !!currentStagingBranch;

  // Live URL is the custom domain (served by the prod Worker via the
  // `coolnews.dev` Workers Custom Domain route). Sites without a custom
  // domain don't have a public live URL — they're only reachable via
  // the Worker preview (above).
  const productionUrl = customDomain ? `https://${customDomain}` : null;

  function handleRefreshPreview(): void {
    startRefresh(async () => {
      try {
        await refreshPreviewUrl(domain);
        toast("Preview URL refreshed", "success");
      } catch {
        toast("Failed to refresh preview URL", "error");
      }
    });
  }

  function handleSavePreview(): void {
    if (!currentPreviewUrl || !saveLabel.trim()) return;
    startSave(async () => {
      try {
        await saveStagingPreview(domain, currentPreviewUrl, saveLabel.trim());
        setSaveLabel("");
        setShowSaveForm(false);
        toast("Preview saved", "success");
      } catch {
        toast("Failed to save preview", "error");
      }
    });
  }

  function handleGoLive(): void {
    startGoLive(async () => {
      try {
        await goLive(domain);
        toast("Site is now live! Staging branch kept for future edits.", "success");
      } catch {
        toast("Failed to go live", "error");
      }
    });
  }

  function handlePublishToProduction(): void {
    startPublish(async () => {
      try {
        await publishStagingToProduction(domain);
        toast("Changes published to production!", "success");
      } catch {
        toast("Failed to publish to production", "error");
      }
    });
  }

  function handleEnsureStagingBranch(): void {
    startEnsure(async () => {
      try {
        const branch = await ensureStagingBranch(domain);
        setCurrentStagingBranch(branch);
        toast("Staging branch ready", "success");
      } catch {
        toast("Failed to set up staging branch", "error");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Worker preview — always available for seeded sites, no DNS needed.
          Lives at the top so editors can compare Worker vs Pages output
          mid-migration. */}
      {workerUrl && (
        <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Worker Preview
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Preview this site on the multi-tenant Worker — works for any seeded
                site, no DNS needed. Asset edits show up within seconds (no rebuild).
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1 truncate font-mono">
                {workerUrl}
              </p>
            </div>
            <a
              href={workerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-sm font-medium text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              Open Worker Preview
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Header section — explains the mode */}
      {isLiveMode && (
        <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-blue-500/10 p-1.5">
              <svg className="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Edit &amp; Preview Before Publishing
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                All edits are made on a staging branch first. Preview your changes, then publish to production when ready.
                {productionUrl && (
                  <>
                    {" "}Production site:{" "}
                    <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">
                      {productionUrl.replace("https://", "")}
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* If no staging branch, show setup button */}
      {!hasStagingBranch && isLiveMode && (
        <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 text-center space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            No staging branch found. Create one to start editing.
          </p>
          <Button
            variant="primary"
            loading={isEnsuring}
            onClick={handleEnsureStagingBranch}
          >
            Set Up Staging Branch
          </Button>
        </div>
      )}

      {/* Current Preview */}
      {hasStagingBranch && (
        <>
          <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6">
            <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">
              Staging Preview
            </h3>
            {currentPreviewUrl ? (
              <div className="flex items-center gap-3">
                <a
                  href={currentPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan hover:underline text-sm truncate flex-1"
                >
                  {currentPreviewUrl}
                </a>
                <a
                  href={currentPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" size="sm">
                    Open Preview
                  </Button>
                </a>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No preview deployment yet. Make an edit to trigger a staging build.
              </p>
            )}
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={isRefreshing}
              onClick={handleRefreshPreview}
            >
              Refresh Preview
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!currentPreviewUrl}
              onClick={(): void => setShowSaveForm(!showSaveForm)}
            >
              Save Preview
            </Button>
          </div>

          {/* Edit Site Settings */}
          <StagingEditPanel domain={domain} previewUrl={currentPreviewUrl} currentLogoPath={currentLogoPath} currentFaviconPath={currentFaviconPath} />

          {/* Inline save form */}
          {showSaveForm && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)]">
              <input
                type="text"
                placeholder="Enter a label for this preview..."
                value={saveLabel}
                onChange={(e): void => setSaveLabel(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan"
              />
              <Button
                size="sm"
                loading={isSaving}
                disabled={!saveLabel.trim()}
                onClick={handleSavePreview}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(): void => {
                  setShowSaveForm(false);
                  setSaveLabel("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </>
      )}

      {/* Saved Previews */}
      {hasStagingBranch && (
        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-secondary)]">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Saved Previews
            </h3>
          </div>
          {savedPreviews && savedPreviews.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-secondary)]">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Label
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    URL
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Saved
                  </th>
                </tr>
              </thead>
              <tbody>
                {savedPreviews.map((preview) => (
                  <tr
                    key={`${preview.url}-${preview.saved_at}`}
                    className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      {preview.label}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={preview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan hover:underline text-xs"
                      >
                        {preview.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {new Date(preview.saved_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-8 text-center text-[var(--text-muted)]">
              No saved previews yet.
            </div>
          )}
        </div>
      )}

      {/* Go Live / Publish to Production */}
      {hasStagingBranch && !isLiveMode && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">
              Go Live
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Merging staging to production will sync this site&apos;s
              content to prod KV{customDomain && (
                <>
                  {" "}and make it live at{" "}
                  <span className="font-mono text-cyan">{customDomain}</span>
                </>
              )}.
            </p>
          </div>
          <Button
            variant="primary"
            loading={isGoingLive}
            onClick={handleGoLive}
          >
            Go Live
          </Button>
        </div>
      )}

      {hasStagingBranch && isLiveMode && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">
              Publish to Production
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Review your staging preview above, then publish all staged changes to the live site
              {productionUrl && (
                <>
                  {" "}at{" "}
                  <a href={productionUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan hover:underline">
                    {productionUrl.replace("https://", "")}
                  </a>
                </>
              )}
              . The staging branch will be reset for your next round of edits.
            </p>
          </div>
          <Button
            variant="primary"
            loading={isPublishing}
            onClick={handlePublishToProduction}
          >
            Publish to Production
          </Button>
        </div>
      )}

      {/* Footer info */}
      {currentStagingBranch && (
        <p className="text-xs text-[var(--text-muted)]">
          Branch: <span className="font-mono">{currentStagingBranch}</span>
          {customDomain && (
            <>
              {" "}&middot; Live: <span className="font-mono">{customDomain}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
