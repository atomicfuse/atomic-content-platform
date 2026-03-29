"use client";

import type { DashboardSiteEntry } from "@/types/dashboard";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface ReadySitePanelProps {
  site: DashboardSiteEntry;
  open: boolean;
  onClose: () => void;
}

export function ReadySitePanel({
  site,
  open,
  onClose,
}: ReadySitePanelProps): React.ReactElement | null {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-[var(--bg-surface)] border-l border-[var(--border-primary)] shadow-2xl overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{site.domain}</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Status */}
          <StatusBadge status={site.status} />

          {/* Info grid */}
          <div className="space-y-3">
            <InfoRow label="Company" value={site.company} />
            <InfoRow label="Vertical" value={site.vertical} />
            <InfoRow label="Site ID" value={site.site_id || "—"} />
            <InfoRow label="Exclusivity" value={site.exclusivity ?? "—"} />
            <InfoRow label="GA Info" value={site.ga_info ?? "—"} />
            <InfoRow
              label="Cloudflare APO"
              value={site.cf_apo ? "Enabled" : "Disabled"}
            />
          </div>

          {/* Actions */}
          <div className="space-y-3 pt-4 border-t border-[var(--border-secondary)]">
            <Button className="w-full" disabled>
              Start Monetization (Coming Soon)
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={(): void => {
                window.open(`https://${site.domain}`, "_blank");
              }}
            >
              Open Live Site &nearr;
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-primary)] font-medium">{value}</span>
    </div>
  );
}
