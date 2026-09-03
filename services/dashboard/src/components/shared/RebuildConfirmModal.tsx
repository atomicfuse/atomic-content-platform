"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";

interface AffectedSite {
  domain: string;
  site_name?: string;
}

interface RebuildConfirmModalProps {
  open: boolean;
  onClose: () => void;
  affectedSites: AffectedSite[];
  /** e.g. "group 'taboola'" or "override 'test-ads-mock'" or "org settings" */
  changeLabel: string;
}

const REBUILD_NOW_TOOLTIP = (
  <span className="block space-y-1">
    <span className="block">This will trigger a KV sync for all affected sites.</span>
    <span className="block">Each site syncs independently and takes about 1 minute.</span>
    <span className="block">Check &quot;Also sync to production&quot; to push changes to live sites immediately.</span>
  </span>
);

const REBUILD_LATER_TOOLTIP = (
  <span className="block space-y-1">
    <span className="block">Your changes are saved in git but won&apos;t appear on the live site yet.</span>
    <span className="block">The site will pick up your changes when any of these happen:</span>
    <span className="block pl-2">&bull; You click &quot;Sync now&quot; from the site detail page</span>
    <span className="block pl-2">&bull; A new article is published by the content pipeline</span>
    <span className="block pl-2">&bull; Someone edits the site config from the dashboard</span>
    <span className="block pl-2">&bull; A push to the staging branch triggers the sync-kv workflow</span>
    <span className="block text-[var(--text-muted)]">Until one of these happens, visitors see the previous version.</span>
  </span>
);

export function RebuildConfirmModal({
  open,
  onClose,
  affectedSites,
  changeLabel,
}: RebuildConfirmModalProps): React.ReactElement {
  const [rebuilding, setRebuilding] = useState(false);
  const [syncProduction, setSyncProduction] = useState(true);
  const [liveDomains, setLiveDomains] = useState<string[]>([]);
  const { toast } = useToast();
  const count = affectedSites.length;

  // Determine which affected sites are Live (eligible for production sync)
  useEffect(() => {
    if (!open || affectedSites.length === 0) {
      setLiveDomains([]);
      return;
    }
    const affectedSet = new Set(affectedSites.map((s) => s.domain));
    fetch("/api/sites/list")
      .then((res) => res.json())
      .then((sites: Array<{ domain: string; status: string }>) => {
        const live = sites
          .filter((s) => affectedSet.has(s.domain) && s.status === "Live")
          .map((s) => s.domain);
        setLiveDomains(live);
      })
      .catch(() => setLiveDomains([]));
  }, [open, affectedSites]);

  async function handleRebuild(): Promise<void> {
    if (count === 0) {
      toast("No sites to rebuild", "info");
      onClose();
      return;
    }
    setRebuilding(true);
    try {
      // Stage 1: staging KV sync (existing behavior)
      const res = await fetch("/api/sites/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: affectedSites.map((s) => s.domain),
          reason: changeLabel,
        }),
      });
      if (!res.ok) throw new Error(`Staging sync failed: HTTP ${res.status}`);

      // Stage 2: production KV sync (if checkbox checked and Live sites exist)
      if (syncProduction && liveDomains.length > 0) {
        const prodRes = await fetch("/api/sites/rebuild-production", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domains: liveDomains,
            reason: changeLabel,
          }),
        });
        if (!prodRes.ok) {
          toast(
            `Staging synced (${count} sites). Production sync failed — try again from the site detail page.`,
            "error",
          );
          onClose();
          return;
        }
        toast(
          `Syncing ${count} site(s) to staging + ${liveDomains.length} to production — changes will be live in ~1 minute`,
          "success",
        );
      } else {
        toast(
          `Syncing ${count} site(s) — changes will be live in ~1 minute`,
          "success",
        );
      }
      onClose();
    } catch {
      toast("Failed to trigger rebuilds", "error");
    } finally {
      setRebuilding(false);
    }
  }

  function handleSkip(): void {
    toast("Saved to git. Sites will sync on next push.", "info");
    onClose();
  }

  // Format sites list for display
  const MAX_DISPLAY = 5;
  const displayDomains = affectedSites
    .slice(0, MAX_DISPLAY)
    .map((s) => s.site_name ?? s.domain);
  const overflow = count - MAX_DISPLAY;
  const sitesLabel =
    count === 0
      ? "No sites affected"
      : `${count} site(s) affected: ${displayDomains.join(", ")}${overflow > 0 ? `, +${overflow} more` : ""}`;

  return (
    <Modal open={open} onClose={onClose} title="Changes saved — sync to Worker?" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Your changes are saved to git. To see them on the live site, affected sites need to sync.
        </p>

        <p className="text-sm text-[var(--text-primary)] font-medium">
          {sitesLabel}
        </p>

        {liveDomains.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={syncProduction}
              onChange={(e): void => setSyncProduction(e.target.checked)}
              className="rounded border-[var(--border)] accent-[var(--color-primary)]"
            />
            Also sync to production ({liveDomains.length} Live site{liveDomains.length !== 1 ? "s" : ""})
          </label>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRebuild}
              loading={rebuilding}
              autoFocus
              className="flex-1"
            >
              Sync now
            </Button>
            <InfoTooltip content={REBUILD_NOW_TOOLTIP} maxWidth={320} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={handleSkip}
              disabled={rebuilding}
              className="flex-1"
            >
              I&apos;ll sync later
            </Button>
            <InfoTooltip content={REBUILD_LATER_TOOLTIP} maxWidth={320} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
