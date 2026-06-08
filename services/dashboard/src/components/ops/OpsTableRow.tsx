"use client";

import type { OpsRow } from "@/lib/ops-helpers";
import { SiteDetailPanel } from "./SiteDetailPanel";

interface OpsTableRowProps {
  row: OpsRow;
  expanded: boolean;
  onToggle: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  Live: "bg-success-light text-success border-success-border",
  Staging: "bg-warning-light text-warning border-warning-border",
  Preview: "bg-primary-light text-primary border-primary-border",
  Ready: "bg-primary-light text-primary border-primary-border",
  New: "bg-card text-secondary border-card-border",
  WordPress: "bg-warning-light text-warning border-warning-border",
};

export function OpsTableRow({ row, expanded, onToggle }: OpsTableRowProps): React.ReactElement {
  const tierBg = row.tier === 0 ? "bg-error-light" : "";

  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer hover:bg-primary-light/30 ${tierBg} border-b border-divider`}>
        <td className="px-3.5 py-2.5 text-heading font-semibold text-sm">{row.customDomain ?? row.domain}</td>
        <td className="px-3.5 py-2.5">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[row.status] ?? ""}`}>{row.status}</span>
        </td>
        <td className={`px-3.5 py-2.5 font-bold ${row.failedArticles7d > 3 ? "text-error" : row.failedArticles7d === 0 ? "text-muted" : "text-secondary"}`}>{row.failedArticles7d}</td>
        <td className={`px-3.5 py-2.5 ${row.imageGenFailed7d > 0 ? "text-warning font-semibold" : "text-muted"}`}>{row.imageGenFailed7d}</td>
        <td className="px-3.5 py-2.5">
          {row.uptime.state === "n/a" ? <span className="text-muted">n/a</span> : <span className={row.uptime.ok ? "text-success" : "text-error"}>● {row.uptime.ok ? "Up" : "Down"}</span>}
        </td>
        <td className="px-3.5 py-2.5">
          <span className={row.sync.ok ? "text-success" : "text-error"}>● {row.sync.ok ? "OK" : "Fail"}</span>
        </td>
        <td className={`px-3.5 py-2.5 ${row.reviewCount > 15 ? "text-primary font-bold" : row.reviewCount === 0 ? "text-muted" : "text-secondary"}`}>{row.reviewCount}</td>
        <td className="px-3.5 py-2.5">
          {row.ssl.state === "n/a" ? <span className="text-muted">n/a</span> : <span className={row.ssl.status === "active" ? "text-success" : "text-error"}>{row.ssl.status === "active" ? "✓" : "✗"}</span>}
        </td>
        <td className="px-3.5 py-2.5 text-[9px]">
          {row.tracking.state === "n/a" || row.tracking.state === "unknown"
            ? <span className="text-muted">—</span>
            : <>
                <span className={row.tracking.ga4 ? "text-success font-medium" : "text-muted"}>GA</span>
                {" · "}
                <span className={row.tracking.gtm ? "text-success font-medium" : "text-muted"}>GTM</span>
                {" · "}
                <span className={row.tracking.pixel ? "text-success font-medium" : "text-muted"}>Px</span>
              </>
          }
        </td>
        <td className={`px-3.5 py-2.5 ${row.domainExpiry.daysLeft != null && row.domainExpiry.daysLeft < 30 ? "text-error font-medium" : row.domainExpiry.daysLeft != null && row.domainExpiry.daysLeft < 60 ? "text-warning font-medium" : "text-primary-text"}`}>
          {row.domainExpiry.daysLeft != null ? `${row.domainExpiry.daysLeft}d` : "—"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="p-0">
            <SiteDetailPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}
