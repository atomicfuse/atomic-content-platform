import { StatusBadge } from "@/components/ui/Badge";
import { workerPreviewUrl } from "@/lib/constants";
import type { DashboardSiteEntry } from "@/types/dashboard";

interface SiteDetailHeaderProps {
  site: DashboardSiteEntry;
}

export function SiteDetailHeader({
  site,
}: SiteDetailHeaderProps): React.ReactElement {
  // Post-Phase-7 layout. Three possible affordances, each ungated by
  // each other:
  //   - Live Site:    custom_domain → that hostname, served by the prod Worker.
  //   - Worker Preview: any site_id → the staging Worker via `?_atl_site=`.
  //                   Always available for seeded sites; serves staging KV
  //                   (i.e., the latest commit on `staging/<domain>`).
  //
  // The legacy `*.pages.dev` URLs (Open Site / Open Staging) are gone:
  // Phase-8b deleted the Pages projects, so those domains no longer
  // resolve.
  const liveUrl = site.custom_domain ? `https://${site.custom_domain}` : null;
  const workerUrl = site.domain ? workerPreviewUrl(site.domain) : null;

  // Worker preview — works for any seeded site, no custom domain needed.
  // The Worker honours `?_atl_site=<siteId>` on workers.dev hostnames;
  // KV is the authority on production custom domains. The siteId here
  // is the network-repo directory slug, which the dashboard stores in
  // the `domain` field (NOT `site_id` — that's an unrelated numeric id).
  const workerUrl = site.domain ? workerPreviewUrl(site.domain) : null;

  const linkIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );

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
          {site.custom_domain && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {site.custom_domain}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {workerUrl && (
          <a
            href={workerUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this site on the staging Worker (no DNS needed; serves the latest staging-branch commit)"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 text-sm font-medium text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            Worker Preview
            {linkIcon}
          </a>
        )}
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            Open Live Site
            {linkIcon}
          </a>
        )}
      </div>
    </div>
  );
}
