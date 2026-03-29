import { StatusBadge } from "@/components/ui/Badge";
import type { DashboardSiteEntry } from "@/types/dashboard";

interface SiteDetailHeaderProps {
  site: DashboardSiteEntry;
}

export function SiteDetailHeader({
  site,
}: SiteDetailHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between pb-6 border-b border-[var(--border-secondary)]">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{site.domain}</h1>
            <StatusBadge status={site.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-[var(--text-secondary)]">
            <span>{site.company}</span>
            <span>&middot;</span>
            <span>{site.vertical}</span>
          </div>
        </div>
      </div>
      <a
        href={`https://${site.domain}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        Open Live Site
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}
