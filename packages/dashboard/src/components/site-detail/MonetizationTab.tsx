import type { DashboardSiteEntry } from "@/types/dashboard";
import { Button } from "@/components/ui/Button";

interface MonetizationTabProps {
  site: DashboardSiteEntry;
}

export function MonetizationTab({
  site,
}: MonetizationTabProps): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Monetization Details</h3>
        <Button variant="secondary" size="sm" disabled>
          Edit Monetization (Coming Soon)
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="Site ID" value={site.site_id || "—"} />
        <InfoCard label="Exclusivity" value={site.exclusivity ?? "—"} />
        <InfoCard label="OB EPID" value={site.ob_epid ?? "—"} />
        <InfoCard label="GA Info" value={site.ga_info ?? "—"} />
        <InfoCard
          label="Cloudflare APO"
          value={site.cf_apo ? "Enabled" : "Disabled"}
          highlight={site.cf_apo}
        />
        <InfoCard
          label="Fixed Ad Insert"
          value={site.fixed_ad ? "Enabled" : "Disabled"}
          highlight={site.fixed_ad}
        />
      </div>

      {site.status !== "Live" && (
        <div className="p-4 rounded-lg bg-cyan/5 border border-cyan/20">
          <p className="text-sm text-cyan">
            Monetization can be configured once the site goes live. Complete the
            site creation flow first.
          </p>
        </div>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}): React.ReactElement {
  return (
    <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={`text-sm font-medium mt-1 ${
          highlight ? "text-green-400" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
