"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { syncInBatches } from "@/lib/rebuild-batches";
import type { BatchTotals } from "@/lib/rebuild-batches";

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

/** Sites per /api/sites/rebuild request — keeps each request well under the ~60 s gateway limit. */
const STAGING_BATCH_SIZE = 5;

const REBUILD_NOW_TOOLTIP = (
  <span className="block space-y-1">
    <span className="block">Refreshes the staging preview of every affected site.</span>
    <span className="block">Each site syncs independently and takes about 1 minute.</span>
  </span>
);

const REBUILD_LATER_TOOLTIP = (
  <span className="block space-y-1">
    <span className="block">Live sites still update automatically from this commit.</span>
    <span className="block">Staging previews pick up the change on the next push to each site&apos;s staging branch
      (an article publish, a site config edit, or &quot;Sync now&quot; on the site page).</span>
  </span>
);

interface RebuildResponse {
  results?: Array<{ ok: boolean }>;
}

/** Triggers the staging sync for one batch of sites. */
async function syncStagingBatch(domains: string[], reason: string): Promise<BatchTotals> {
  const res = await fetch("/api/sites/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domains, reason }),
  });
  if (!res.ok) throw new Error(`Staging sync failed: HTTP ${res.status}`);
  const data = (await res.json()) as RebuildResponse;
  const ok = (data.results ?? []).filter((r) => r.ok).length;
  return { ok, failed: domains.length - ok };
}

// Note: every caller saves org/group/override files on main, and a main push
// re-syncs every published site to production by itself (sync-kv.yml). Only the
// staging KV needs a per-site trigger, so there is no production step here.
export function RebuildConfirmModal({
  open,
  onClose,
  affectedSites,
  changeLabel,
}: RebuildConfirmModalProps): React.ReactElement {
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  const count = affectedSites.length;

  async function handleRebuild(): Promise<void> {
    if (count === 0) {
      toast("No sites to rebuild", "info");
      onClose();
      return;
    }
    setRebuilding(true);
    setProgress(0);
    const { ok, failed } = await syncInBatches(
      affectedSites.map((s) => s.domain),
      STAGING_BATCH_SIZE,
      (batch) => syncStagingBatch(batch, changeLabel),
      (done) => setProgress(done),
    );
    setRebuilding(false);
    if (failed > 0) {
      toast(`Staging sync triggered for ${ok} of ${count} site(s); ${failed} failed. Live sites still update from the commit.`, "error");
    } else {
      toast(`Staging sync triggered for ${count} site(s) — previews update in ~1 minute`, "success");
    }
    onClose();
  }

  function handleSkip(): void {
    toast("Saved to git. Live sites update automatically; staging previews on their next sync.", "info");
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
    <Modal open={open} onClose={onClose} title="Changes saved — sync staging previews?" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Your changes are saved to git. Live sites update automatically from this commit in a few minutes.
          Sync now to refresh the staging previews too.
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
              {rebuilding ? `Syncing staging… ${progress}/${count}` : "Sync now"}
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
