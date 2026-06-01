"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { publishStagingToProduction } from "@/actions/wizard";
import { StagingDiffModal } from "./StagingDiffModal";

interface PendingChangesBarProps {
  domain: string;
  customDomain: string | null;
}

export function PendingChangesBar({
  domain,
  customDomain,
}: PendingChangesBarProps): React.ReactElement | null {
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [isPublishing, startPublish] = useTransition();
  const { toast } = useToast();

  const checkStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/sites/staging-status?domain=${encodeURIComponent(domain)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { hasPendingChanges: boolean };
      setHasPendingChanges(data.hasPendingChanges);
    } catch {
      // Silently fail — banner just won't show
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  function handlePublish(): void {
    startPublish(async () => {
      try {
        await publishStagingToProduction(domain);
        setHasPendingChanges(false);
        setConfirming(false);
        toast("Changes published to production!", "success");
      } catch {
        toast("Failed to publish to production", "error");
      }
    });
  }

  if (loading || !hasPendingChanges) return null;

  const displayDomain = customDomain ?? domain;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-4">
      <button
        onClick={(): void => setShowDiff(true)}
        className="flex items-center gap-2 min-w-0 hover:opacity-80 cursor-pointer"
      >
        <div className="shrink-0 rounded-full bg-amber-500/10 p-1">
          <svg
            className="h-4 w-4 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          You have unpublished changes on staging
        </p>
      </button>
      <div className="shrink-0 flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-xs text-[var(--text-secondary)]">
              Publish to {displayDomain}?
            </span>
            <Button
              size="sm"
              variant="primary"
              loading={isPublishing}
              onClick={handlePublish}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(): void => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={(): void => setConfirming(true)}
          >
            Apply to Live Site &mdash; {displayDomain}
          </Button>
        )}
      </div>
      <StagingDiffModal
        open={showDiff}
        onClose={(): void => setShowDiff(false)}
        domain={domain}
      />
    </div>
  );
}
