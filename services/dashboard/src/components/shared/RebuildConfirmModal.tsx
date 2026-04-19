"use client";

import { useState } from "react";
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
    <span className="block">This will trigger a Cloudflare Pages rebuild for all affected sites.</span>
    <span className="block">Each site rebuilds independently and takes 2-3 minutes.</span>
    <span className="block">Once complete, your changes will be live on the staging/production URL.</span>
    <span className="block text-[var(--text-muted)]">This is the same as manually pushing a .build-trigger commit.</span>
  </span>
);

const REBUILD_LATER_TOOLTIP = (
  <span className="block space-y-1">
    <span className="block">Your changes are saved in git but won&apos;t appear on the live site yet.</span>
    <span className="block">The site will pick up your changes when any of these happen:</span>
    <span className="block pl-2">&bull; You click &quot;Rebuild now&quot; from the site detail page</span>
    <span className="block pl-2">&bull; A new article is published by the content pipeline</span>
    <span className="block pl-2">&bull; Someone edits the site.yaml from the dashboard</span>
    <span className="block pl-2">&bull; You manually push a .build-trigger commit</span>
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
  const { toast } = useToast();
  const count = affectedSites.length;

  async function handleRebuild(): Promise<void> {
    if (count === 0) {
      toast("No sites to rebuild", "info");
      onClose();
      return;
    }
    setRebuilding(true);
    try {
      const res = await fetch("/api/sites/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domains: affectedSites.map((s) => s.domain),
          reason: changeLabel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(
        `Rebuilding ${count} site(s) — changes will be live in 2-3 minutes`,
        "success",
      );
      onClose();
    } catch {
      toast("Failed to trigger rebuilds", "error");
    } finally {
      setRebuilding(false);
    }
  }

  function handleSkip(): void {
    toast("Saved to git. Sites will update on next rebuild.", "info");
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
    <Modal open={open} onClose={onClose} title="Changes saved — trigger rebuild?" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Your changes are saved to git. To see them on the live site, affected sites need to rebuild.
        </p>

        <p className="text-sm text-[var(--text-primary)] font-medium">
          {sitesLabel}
        </p>

        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRebuild}
              loading={rebuilding}
              autoFocus
              className="flex-1"
            >
              Rebuild now
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
              I&apos;ll rebuild later
            </Button>
            <InfoTooltip content={REBUILD_LATER_TOOLTIP} maxWidth={320} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
