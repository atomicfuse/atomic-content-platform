"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSiteEntry, SiteStatus, Company, Vertical } from "@/types/dashboard";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { deleteSiteEntry } from "@/actions/sites";
import { Filters } from "./Filters";

interface SitesTableProps {
  sites: DashboardSiteEntry[];
}

function ColumnHeader({ label, tooltip }: { label: string; tooltip: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="inline-flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={(e): void => { e.stopPropagation(); setOpen(true); }}
          className="relative group/tip cursor-help"
        >
          <svg className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-60 hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" d="M12 16h.01M12 8v4" />
          </svg>
          <span className="invisible group-hover/tip:visible fixed z-50 w-56 px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-lg shadow-lg mt-5 -ml-24">
            {tooltip}
          </span>
        </button>
      </span>
      <Modal open={open} onClose={(): void => setOpen(false)} title={label} size="sm">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{tooltip}</p>
      </Modal>
    </>
  );
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const days = Math.floor(diff / 86400000);
  const months = Math.floor(days / 30);

  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function SitesTable({ sites }: SitesTableProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<Company | "">("");
  const [verticalFilter, setVerticalFilter] = useState<Vertical | "">("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "">("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleteSteps, setDeleteSteps] = useState<Array<{ label: string; success: boolean; error?: string }> | null>(null);

  // Get the site entry for the delete target so we can show what will be cleaned up
  const deleteTargetSite = deleteTarget ? sites.find((s) => s.domain === deleteTarget) : null;

  function openDeleteModal(e: React.MouseEvent, domain: string): void {
    e.stopPropagation();
    setDeleteTarget(domain);
    setDeleteSteps(null);
  }

  function confirmDelete(): void {
    if (!deleteTarget) return;
    const domain = deleteTarget;
    startTransition(async () => {
      try {
        const result = await deleteSiteEntry(domain);
        setDeleteSteps(result.steps);
        const allSuccess = result.steps.every((s) => s.success);
        if (allSuccess) {
          toast(`Deleted ${domain}`, "success");
        } else {
          toast(`Deleted ${domain} with some warnings`, "info");
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : "Failed to delete", "error");
      }
    });
  }

  function closeDeleteModal(): void {
    setDeleteTarget(null);
    setDeleteSteps(null);
  }

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      if (search && !site.domain.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (companyFilter && site.company !== companyFilter) return false;
      if (verticalFilter && site.vertical !== verticalFilter) return false;
      if (statusFilter && site.status !== statusFilter) return false;
      return true;
    });
  }, [sites, search, companyFilter, verticalFilter, statusFilter]);

  function handleRowClick(site: DashboardSiteEntry): void {
    switch (site.status) {
      case "New":
        router.push(`/wizard?domain=${encodeURIComponent(site.domain)}`);
        break;
      case "Staging":
        router.push(`/sites/${encodeURIComponent(site.domain)}?tab=staging`);
        break;
      case "Preview":
        router.push(`/sites/${encodeURIComponent(site.domain)}?tab=preview`);
        break;
      case "Ready":
        router.push(`/sites/${encodeURIComponent(site.domain)}`);
        break;
      case "Live":
        router.push(`/sites/${encodeURIComponent(site.domain)}`);
        break;
      case "WordPress":
        // Tooltip handled inline
        break;
    }
  }

  return (
    <div className="space-y-4">
      <Filters
        search={search}
        company={companyFilter}
        vertical={verticalFilter}
        status={statusFilter}
        onSearchChange={setSearch}
        onCompanyChange={setCompanyFilter}
        onVerticalChange={setVerticalFilter}
        onStatusChange={setStatusFilter}
      />

      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-secondary)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Website
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Company
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Vertical
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Site ID" tooltip="Auto-generated unique ID assigned when a domain is added via Sync. Stored in dashboard-index.yaml." />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Exclusivity" tooltip="Exclusivity configuration and state for the site as captured in ad config setup." />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="OB EPID" tooltip="Outbrain EPID value configured for the site as part of ad config setup." />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="GA Info" tooltip="Google Analytics configuration data associated with the site (e.g., property or measurement identifiers)." />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Last Updated" tooltip="Timestamp of the most recent change to this site entry in the dashboard index." />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="CF APO" tooltip="Cloudflare APO (Automatic Platform Optimization) enablement status for the site." />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Fixed Ad" tooltip="Fixed ad placement configuration and status for the site as defined in ad config setup." />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSites.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    {sites.length === 0
                      ? "No sites yet. Click \"Sync Domains\" to import from Cloudflare."
                      : "No sites match your filters."}
                  </td>
                </tr>
              )}
              {filteredSites.map((site) => (
                <tr
                  key={site.domain}
                  onClick={(): void => handleRowClick(site)}
                  className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors group relative"
                >
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {site.custom_domain ?? site.domain}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {site.company}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {site.vertical}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={site.status} />
                    {site.status === "WordPress" && (
                      <span className="invisible group-hover:visible absolute z-10 ml-2 px-2 py-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border-primary)] rounded-md shadow-lg whitespace-nowrap">
                        Migration coming soon
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                    {site.site_id || "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {site.exclusivity ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {site.ob_epid ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] font-mono text-xs">
                    {site.ga_info ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {formatRelativeDate(site.last_updated)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {site.cf_apo ? (
                      <span className="text-green-400">&#10003;</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {site.fixed_ad ? (
                      <span className="text-green-400">&#10003;</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e): void => openDeleteModal(e, site.domain)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title={`Delete ${site.domain}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={closeDeleteModal}
        title={deleteSteps ? "Delete Complete" : "Delete Site"}
        size="sm"
      >
        <div className="space-y-4">
          {/* Pre-delete confirmation */}
          {!deleteSteps && (
            <>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[var(--text-primary)] font-medium">
                    Are you sure you want to delete <strong>{deleteTarget}</strong>?
                  </p>
                  <p className="text-sm text-[var(--text-muted)] mt-2">
                    This will permanently remove:
                  </p>
                  <ul className="text-sm text-[var(--text-muted)] mt-1 space-y-1.5">
                    {deleteTargetSite?.staging_branch && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        Staging branch: <span className="font-mono text-xs">{deleteTargetSite.staging_branch}</span>
                      </li>
                    )}
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      Site files from Git (site.yaml, articles, assets)
                    </li>
                    {deleteTargetSite?.pages_project && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        CF Pages project: <span className="font-mono text-xs">{deleteTargetSite.pages_project}</span>
                      </li>
                    )}
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      Dashboard entry (moved to trash)
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
                <Button variant="ghost" onClick={closeDeleteModal}>
                  Cancel
                </Button>
                <Button
                  onClick={confirmDelete}
                  loading={isPending}
                  className="!bg-red-500 hover:!bg-red-600 !text-white"
                >
                  Delete Site
                </Button>
              </div>
            </>
          )}

          {/* Post-delete results */}
          {deleteSteps && (
            <>
              <div className="space-y-2">
                {deleteSteps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-sm">
                    {step.success ? (
                      <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    )}
                    <div>
                      <span className={step.success ? "text-[var(--text-secondary)]" : "text-red-400"}>
                        {step.label}
                      </span>
                      {step.error && (
                        <p className="text-xs text-red-400/70 mt-0.5">{step.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
                <Button onClick={closeDeleteModal}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
