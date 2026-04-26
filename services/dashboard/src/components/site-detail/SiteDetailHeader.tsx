import { StatusBadge } from "@/components/ui/Badge";
import { workerPreviewUrl } from "@/lib/constants";
import type { DashboardSiteEntry } from "@/types/dashboard";

interface SiteDetailHeaderProps {
  site: DashboardSiteEntry;
}

export function SiteDetailHeader({
  site,
}: SiteDetailHeaderProps): React.ReactElement {
  // Determine primary link based on site state
  // pages_subdomain is the actual *.pages.dev prefix (may differ from pages_project if CF renamed)
  const pagesHost = site.pages_subdomain ?? site.pages_project;
  let primaryHref: string;
  let primaryLabel: string;

  if (site.custom_domain) {
    primaryHref = `https://${site.custom_domain}`;
    primaryLabel = "Open Live Site";
  } else if (pagesHost && (site.status === "Ready" || site.status === "Live")) {
    primaryHref = `https://${pagesHost}.pages.dev`;
    primaryLabel = "Open Site";
  } else if (site.staging_branch && pagesHost && site.status === "Staging") {
    primaryHref = `https://${site.staging_branch.replace(/\//g, "-")}.${pagesHost}.pages.dev`;
    primaryLabel = "Open Staging";
  } else {
    primaryHref = `https://${site.domain}`;
    primaryLabel = "Open Live Site";
  }

  // Build stable staging URL from branch + pages subdomain (not the deployment-specific preview_url)
  const stagingUrl =
    site.staging_branch && pagesHost
      ? `https://${site.staging_branch.replace(/\//g, "-")}.${pagesHost}.pages.dev`
      : null;

  // Show staging link for live sites that also have a staging branch
  const showStagingLink =
    stagingUrl && (site.status === "Ready" || site.status === "Live");

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
          {pagesHost && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {pagesHost}.pages.dev
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
            title="Open this site on the multi-tenant Worker (no custom domain needed)"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 text-sm font-medium text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            Worker Preview
            {linkIcon}
          </a>
        )}
        {showStagingLink && (
          <a
            href={stagingUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            Staging
            {linkIcon}
          </a>
        )}
        <a
          href={primaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
        >
          {primaryLabel}
          {linkIcon}
        </a>
      </div>
    </div>
  );
}
