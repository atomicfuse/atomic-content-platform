"use client";

import { useState, useMemo, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DashboardSiteEntry, SiteStatus, Company, Vertical } from "@/types/dashboard";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { deleteSiteEntry, updateSiteEntry } from "@/actions/sites";
import { COMPANIES } from "@/lib/constants";
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
  const normalized = dateStr.length <= 13 ? `${dateStr}:00:00Z` : dateStr;
  const then = new Date(normalized).getTime();
  if (isNaN(then)) return "—";
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [websiteSort, setWebsiteSort] = useState<"asc" | "desc" | null>(null);
  const [articlesSort, setArticlesSort] = useState<"asc" | "desc" | null>(null);
  const [lastArticlesSort, setLastArticlesSort] = useState<"asc" | "desc" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleteSteps, setDeleteSteps] = useState<Array<{ label: string; success: boolean; error?: string }> | null>(null);
  const [articleCounts, setArticleCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [latestArticles, setLatestArticles] = useState<Record<string, string>>({});
  const [latestLoaded, setLatestLoaded] = useState(false);
  const [siteGroups, setSiteGroups] = useState<Record<string, string[]>>({});
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name?: string }>>([]);

  useEffect(() => {
    fetch("/api/sites/article-counts")
      .then((r) => r.json())
      .then((data: Record<string, number>) => {
        setArticleCounts(data);
        setCountsLoaded(true);
      })
      .catch(() => setCountsLoaded(true));
    fetch("/api/sites/latest-articles")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        setLatestArticles(data);
        setLatestLoaded(true);
      })
      .catch(() => setLatestLoaded(true));
  }, []);

  useEffect(() => {
    fetch("/api/sites/groups")
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => setSiteGroups(data))
      .catch(() => { /* leave empty */ });
    fetch("/api/groups")
      .then(async (r) => (r.ok ? ((await r.json()) as Array<{ id: string; name?: string }>) : []))
      .then(setAvailableGroups)
      .catch(() => setAvailableGroups([]));
  }, []);

  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

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
    setCurrentPage(1);
    const filtered = sites.filter((site) => {
      if (search && !site.domain.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (companyFilter && site.company !== companyFilter) return false;
      if (verticalFilter && site.vertical !== verticalFilter) return false;
      if (statusFilter && site.status !== statusFilter) return false;
      return true;
    });
    if (websiteSort) {
      filtered.sort((a, b) => {
        const aName = (a.custom_domain ?? a.domain).toLowerCase();
        const bName = (b.custom_domain ?? b.domain).toLowerCase();
        return websiteSort === "asc"
          ? aName.localeCompare(bName)
          : bName.localeCompare(aName);
      });
    }
    if (articlesSort && countsLoaded) {
      filtered.sort((a, b) => {
        const aCount = articleCounts[a.domain] ?? 0;
        const bCount = articleCounts[b.domain] ?? 0;
        return articlesSort === "asc" ? aCount - bCount : bCount - aCount;
      });
    }
    if (lastArticlesSort && latestLoaded) {
      filtered.sort((a, b) => {
        const aRaw = latestArticles[a.domain] ?? "";
        const bRaw = latestArticles[b.domain] ?? "";
        const aNorm = aRaw.length <= 13 ? `${aRaw}:00:00Z` : aRaw;
        const bNorm = bRaw.length <= 13 ? `${bRaw}:00:00Z` : bRaw;
        const aTime = aRaw ? new Date(aNorm).getTime() : 0;
        const bTime = bRaw ? new Date(bNorm).getTime() : 0;
        return lastArticlesSort === "asc" ? aTime - bTime : bTime - aTime;
      });
    }
    return filtered;
  }, [sites, search, companyFilter, verticalFilter, statusFilter, websiteSort, articlesSort, articleCounts, countsLoaded, lastArticlesSort, latestArticles, latestLoaded]);

  const totalPages = Math.max(1, Math.ceil(filteredSites.length / pageSize));
  const paginatedSites = filteredSites.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const goToPage = useCallback((page: number): void => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

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
        <div className="overflow-auto max-h-[80vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-surface)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={(): void => { setArticlesSort(null); setLastArticlesSort(null); setWebsiteSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
                  >
                    Website
                    <svg className={`w-3.5 h-3.5 transition-opacity ${websiteSort ? "opacity-100" : "opacity-40"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {websiteSort === "desc" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      )}
                    </svg>
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Company
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Group
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Category
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Status
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={(): void => { setWebsiteSort(null); setLastArticlesSort(null); setArticlesSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors cursor-pointer ml-auto"
                  >
                    Articles
                    <svg className={`w-3.5 h-3.5 transition-opacity ${articlesSort ? "opacity-100" : "opacity-40"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {articlesSort === "desc" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      )}
                    </svg>
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={(): void => { setWebsiteSort(null); setArticlesSort(null); setLastArticlesSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
                  >
                    Last Articles
                    <svg className={`w-3.5 h-3.5 transition-opacity ${lastArticlesSort ? "opacity-100" : "opacity-40"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {lastArticlesSort === "desc" ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      )}
                    </svg>
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Site ID" tooltip="Auto-generated unique ID assigned when a domain is added via Sync. Stored in dashboard-index.yaml." />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <ColumnHeader label="Last Updated" tooltip="Timestamp of the most recent change to this site entry in the dashboard index." />
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
                    colSpan={10}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    {sites.length === 0
                      ? "No sites yet. Click \"Sync Domains\" to import from Cloudflare."
                      : "No sites match your filters."}
                  </td>
                </tr>
              )}
              {paginatedSites.map((site) => (
                <tr
                  key={site.domain}
                  onClick={(): void => handleRowClick(site)}
                  className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors group relative"
                >
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {site.custom_domain ?? site.domain}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    <InlineCompanySelect
                      domain={site.domain}
                      value={site.company}
                      onSaved={(newCompany): void => {
                        site.company = newCompany;
                        toast(`Company updated for ${site.domain}`, "success");
                        router.refresh();
                      }}
                      onError={(msg): void => { toast(msg, "error"); }}
                    />
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    <InlineGroupSelect
                      domain={site.domain}
                      value={siteGroups[site.domain] ?? []}
                      options={availableGroups}
                      onSaved={(newGroups): void => {
                        setSiteGroups((prev) => ({ ...prev, [site.domain]: newGroups }));
                        toast(`Group updated for ${site.domain}`, "success");
                      }}
                      onError={(msg): void => { toast(msg, "error"); }}
                    />
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {site.vertical}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={site.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-mono text-xs tabular-nums">
                    {countsLoaded
                      ? (articleCounts[site.domain] ?? "—")
                      : <span className="inline-block w-4 h-3 rounded bg-[var(--bg-elevated)] animate-pulse" />
                    }
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {latestLoaded
                      ? (latestArticles[site.domain] ? formatRelativeDate(latestArticles[site.domain]) : "—")
                      : <span className="inline-block w-12 h-3 rounded bg-[var(--bg-elevated)] animate-pulse" />
                    }
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                    {site.site_id || "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {formatRelativeDate(site.last_updated)}
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

        {/* Pagination */}
        {filteredSites.length > PAGE_SIZE_OPTIONS[0] && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-secondary)]">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                Show
                <select
                  value={pageSize}
                  onChange={(e): void => {
                    const newSize = Number(e.target.value);
                    setPageSize(newSize);
                    setCurrentPage(1);
                  }}
                  className="bg-[var(--bg-elevated)] border border-[var(--border-secondary)] rounded-md px-1.5 py-0.5 text-xs text-[var(--text-secondary)] cursor-pointer"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                rows
              </label>
              <span className="text-xs text-[var(--text-muted)]">
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredSites.length)} of {filteredSites.length}
              </span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(): void => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-2 py-1 text-xs rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={(): void => goToPage(page)}
                    className={`min-w-[28px] px-1.5 py-1 text-xs rounded-md transition-colors ${
                      page === currentPage
                        ? "bg-[var(--accent-primary)] text-white font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={(): void => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 text-xs rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={closeDeleteModal}
        title={deleteSteps ? "Move to Trash Complete" : "Move to Trash"}
        size="sm"
      >
        <div className="space-y-4">
          {/* Pre-delete confirmation */}
          {!deleteSteps && (
            <>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[var(--text-primary)] font-medium">
                    Move <strong>{deleteTarget}</strong> to trash?
                  </p>
                  <p className="text-sm text-[var(--text-muted)] mt-2">
                    This will:
                  </p>
                  <ul className="text-sm text-[var(--text-muted)] mt-1 space-y-1.5">
                    {deleteTargetSite?.custom_domain && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        Disconnect domain: <span className="font-mono text-xs">{deleteTargetSite.custom_domain}</span>
                      </li>
                    )}
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      Remove published files from Git main
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      Take domain offline (remove from KV)
                    </li>
                  </ul>
                  <p className="text-sm text-green-400/80 mt-3">
                    Staging branch and images are preserved. You can restore from trash.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
                <Button variant="ghost" onClick={closeDeleteModal}>
                  Cancel
                </Button>
                <Button
                  onClick={confirmDelete}
                  loading={isPending}
                  className="!bg-amber-600 hover:!bg-amber-700 !text-white"
                >
                  Move to Trash
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

/* ------------------------------------------------------------------ */
/* Inline Company Selector                                             */
/* ------------------------------------------------------------------ */

function InlineCompanySelect({
  domain,
  value,
  onSaved,
  onError,
}: {
  domain: string;
  value: Company | null;
  onSaved: (newCompany: Company | null) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Optimistic display — updated immediately on selection, before server round-trip.
  const [optimistic, setOptimistic] = useState<Company | null | undefined>(undefined);

  const display = optimistic !== undefined ? optimistic : (value || null);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>): Promise<void> {
    e.stopPropagation();
    const newValue = (e.target.value || null) as Company | null;
    if (newValue === (value || null)) {
      setEditing(false);
      return;
    }
    // Show new value immediately.
    setOptimistic(newValue);
    setEditing(false);
    setSaving(true);
    try {
      await updateSiteEntry(domain, { company: newValue });
      onSaved(newValue);
    } catch (err) {
      // Revert optimistic update on failure.
      setOptimistic(undefined);
      onError(err instanceof Error ? err.message : "Failed to update company");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <select
        autoFocus
        value={(display ?? "")}
        onChange={(e): void => { void handleChange(e); }}
        onBlur={(): void => setEditing(false)}
        onClick={(e): void => e.stopPropagation()}
        disabled={saving}
        className="px-1.5 py-0.5 rounded border border-cyan/50 bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none cursor-pointer"
      >
        <option value="">No Company</option>
        {COMPANIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={(e): void => { e.stopPropagation(); setEditing(true); }}
      className={`hover:text-cyan transition-colors cursor-pointer ${saving ? "opacity-50" : ""}`}
      title="Click to change company"
      disabled={saving}
    >
      {display || <span className="text-[var(--text-muted)]">&mdash;</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Inline Group Selector                                               */
/* ------------------------------------------------------------------ */

function InlineGroupSelect({
  domain,
  value,
  options,
  onSaved,
  onError,
}: {
  domain: string;
  value: string[];
  options: Array<{ id: string; name?: string }>;
  onSaved: (newGroups: string[]) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Optimistic display — updated immediately on selection, before server round-trip.
  const [optimistic, setOptimistic] = useState<string[] | undefined>(undefined);

  const display = optimistic !== undefined ? optimistic : value;
  const labelFor = (id: string): string => options.find((o) => o.id === id)?.name ?? id;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>): Promise<void> {
    e.stopPropagation();
    const selected = e.target.value;
    const newGroups = selected ? [selected] : [];
    const currentJoined = value.join(",");
    const newJoined = newGroups.join(",");
    if (currentJoined === newJoined) {
      setEditing(false);
      return;
    }
    setOptimistic(newGroups);
    setEditing(false);
    setSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: { groups: newGroups },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status !== "ok") throw new Error(data.message ?? "Failed to update group");
      onSaved(newGroups);
    } catch (err) {
      setOptimistic(undefined);
      onError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <select
        autoFocus
        value={display[0] ?? ""}
        onChange={(e): void => { void handleChange(e); }}
        onBlur={(): void => setEditing(false)}
        onClick={(e): void => e.stopPropagation()}
        disabled={saving}
        className="px-1.5 py-0.5 rounded border border-cyan/50 bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none cursor-pointer"
      >
        <option value="">No Group</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>{g.name ?? g.id}</option>
        ))}
      </select>
    );
  }

  const displayText = display.length === 0
    ? null
    : display.map(labelFor).join(", ");

  return (
    <button
      type="button"
      onClick={(e): void => { e.stopPropagation(); setEditing(true); }}
      className={`hover:text-cyan transition-colors cursor-pointer ${saving ? "opacity-50" : ""}`}
      title="Click to change group"
      disabled={saving}
    >
      {displayText ?? <span className="text-[var(--text-muted)]">&mdash;</span>}
    </button>
  );
}
