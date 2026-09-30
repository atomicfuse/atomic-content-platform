"use client";

import { useState, useMemo, useTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { DashboardSiteEntry, SiteStatus, Company, Vertical } from "@/types/dashboard";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { deleteSiteEntry, updateSiteEntry } from "@/actions/sites";
import { COMPANIES } from "@/lib/constants";
import { Filters } from "./Filters";
import { ColumnChooser } from "./ColumnChooser";
import {
  filterSites,
  type CompanyFilterValue,
  type GroupFilterValue,
} from "@/lib/site-filters";
import { buildSitesCsvForColumns, sitesCsvFilename } from "@/lib/csv";
import {
  SITE_COLUMNS,
  DEFAULT_VISIBLE_COLUMN_IDS,
  loadVisibleColumnIds,
  saveVisibleColumnIds,
  hasLiveColumn,
  formatSchedule,
  type SiteColumnDef,
  type LiveConfigEntry,
} from "@/lib/site-columns";
import { isPublishEligible } from "@/lib/pending-changes";
import { BULK_PUBLISH_BUSY_MESSAGE, useBulkPublishBusy } from "@/lib/bulk-publish-activity";

// Loaded on first open only: it pulls in the publish server action.
const BulkPublishModal = dynamic(
  () => import("./BulkPublishModal").then((m) => m.BulkPublishModal),
  { ssr: false },
);

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
  const [bulkPublishOpen, setBulkPublishOpen] = useState(false);
  const publishEligibleCount = useMemo(() => sites.filter(isPublishEligible).length, [sites]);
  const bulkPublishBusy = useBulkPublishBusy();
  const [companyFilter, setCompanyFilter] = useState<CompanyFilterValue | "">("");
  const [verticalFilter, setVerticalFilter] = useState<Vertical | "">("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "">("");
  const [groupFilter, setGroupFilter] = useState<GroupFilterValue>("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [websiteSort, setWebsiteSort] = useState<"asc" | "desc" | null>(null);
  const [articlesSort, setArticlesSort] = useState<"asc" | "desc" | null>(null);
  const [lastArticlesSort, setLastArticlesSort] = useState<"asc" | "desc" | null>(null);
  const [createdSort, setCreatedSort] = useState<"asc" | "desc" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleteSteps, setDeleteSteps] = useState<Array<{ label: string; success: boolean; error?: string }> | null>(null);
  const [articleCounts, setArticleCounts] = useState<Record<string, number>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [latestArticles, setLatestArticles] = useState<Record<string, string>>({});
  const [latestLoaded, setLatestLoaded] = useState(false);
  const [siteGroups, setSiteGroups] = useState<Record<string, string[]>>({});
  const [availableGroups, setAvailableGroups] = useState<Array<{ id: string; name?: string }>>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  // Column visibility — starts at the documented defaults (matches today's
  // table exactly for SSR + first client render) and is replaced by the
  // saved preference, if any, once mounted. See src/lib/site-columns.ts.
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(DEFAULT_VISIBLE_COLUMN_IDS);
  const [liveConfig, setLiveConfig] = useState<Record<string, LiveConfigEntry>>({});
  const [liveConfigLoaded, setLiveConfigLoaded] = useState(false);
  const liveConfigRequested = useRef(false);

  useEffect(() => {
    setVisibleColumnIds(loadVisibleColumnIds());
  }, []);

  // Fetch /api/sites/live-config only once at least one "live" column is
  // visible, and only once per mount thereafter — never re-fetched just
  // because a live column is toggled off and back on.
  useEffect(() => {
    if (!hasLiveColumn(visibleColumnIds) || liveConfigRequested.current) return;
    liveConfigRequested.current = true;
    fetch("/api/sites/live-config")
      .then((r) => r.json())
      .then((data: Record<string, LiveConfigEntry>) => setLiveConfig(data))
      .catch(() => { /* leave liveConfig empty — cells fall back to "—" */ })
      .finally(() => setLiveConfigLoaded(true));
  }, [visibleColumnIds]);

  const visibleColumns = useMemo(
    () => SITE_COLUMNS.filter((c) => visibleColumnIds.includes(c.id)),
    [visibleColumnIds],
  );

  // A hidden column can't stay "sorted" — snap back to the default (no) sort
  // for any sort key whose column is no longer visible.
  useEffect(() => {
    if (!visibleColumnIds.includes("articles") && articlesSort !== null) setArticlesSort(null);
    if (!visibleColumnIds.includes("lastArticles") && lastArticlesSort !== null) setLastArticlesSort(null);
    if (!visibleColumnIds.includes("created") && createdSort !== null) setCreatedSort(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumnIds]);

  function handleColumnToggle(id: string, checked: boolean): void {
    setVisibleColumnIds((prev) => {
      const next = checked ? [...prev, id] : prev.filter((existing) => existing !== id);
      saveVisibleColumnIds(next);
      return next;
    });
  }

  function handleColumnReset(): void {
    setVisibleColumnIds(DEFAULT_VISIBLE_COLUMN_IDS);
    saveVisibleColumnIds(DEFAULT_VISIBLE_COLUMN_IDS);
  }

  function renderColumnHeader(column: SiteColumnDef): React.ReactNode {
    switch (column.id) {
      case "company":
        return "Company";
      case "group":
        return "Group";
      case "category":
        return "Category";
      case "status":
        return "Status";
      case "articles":
        return (
          <button
            type="button"
            onClick={(): void => { setWebsiteSort(null); setLastArticlesSort(null); setCreatedSort(null); setArticlesSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
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
        );
      case "lastArticles":
        return (
          <button
            type="button"
            onClick={(): void => { setWebsiteSort(null); setArticlesSort(null); setCreatedSort(null); setLastArticlesSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
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
        );
      case "siteId":
        return <ColumnHeader label="Site ID" tooltip="Auto-generated unique ID assigned when a domain is added via Sync. Stored in dashboard-index.yaml." />;
      case "created":
        return (
          <button
            type="button"
            onClick={(): void => { setWebsiteSort(null); setArticlesSort(null); setLastArticlesSort(null); setCreatedSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
            className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            Created
            <svg className={`w-3.5 h-3.5 transition-opacity ${createdSort ? "opacity-100" : "opacity-40"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {createdSort === "desc" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              )}
            </svg>
          </button>
        );
      case "lastUpdated":
        return <ColumnHeader label="Last Updated" tooltip="Timestamp of the most recent change to this site entry in the dashboard index." />;
      case "customDomain":
        return "Custom domain";
      default:
        // Live-config columns (Template, GA4, Facebook Pixel, GTM, Google
        // Ads, Schedule, Last sync) show their own column tooltip.
        return column.tooltip
          ? <ColumnHeader label={column.label} tooltip={column.tooltip} />
          : column.label;
    }
  }

  function headerClassName(id: string): string {
    const base = "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]";
    return id === "articles" ? `text-right ${base}` : `text-left ${base}`;
  }

  function cellClassName(id: string): string {
    switch (id) {
      case "articles":
        return "px-4 py-3 text-right text-[var(--text-secondary)] font-mono text-xs tabular-nums";
      case "articlesPerDay":
        return "px-4 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap tabular-nums";
      case "status":
        return "px-4 py-3";
      case "siteId":
        return "px-4 py-3 text-[var(--text-muted)] font-mono text-xs";
      case "lastArticles":
      case "created":
      case "lastSync":
        return "px-4 py-3 text-[var(--text-muted)] text-xs";
      case "lastUpdated":
        return "px-4 py-3 text-[var(--text-muted)]";
      case "ga4":
      case "facebookPixel":
      case "gtm":
      case "googleAds":
        return "px-4 py-3 text-[var(--text-muted)] font-mono text-xs";
      case "template":
      case "customDomain":
        return "px-4 py-3 text-[var(--text-secondary)] text-xs";
      default:
        return "px-4 py-3 text-[var(--text-secondary)]";
    }
  }

  function renderColumnCell(column: SiteColumnDef, site: DashboardSiteEntry): React.ReactNode {
    switch (column.id) {
      case "company":
        return (
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
        );
      case "group":
        return (
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
        );
      case "category":
        return site.vertical;
      case "status":
        return <StatusBadge status={site.status} />;
      case "articles":
        return countsLoaded
          ? (articleCounts[site.domain] ?? "—")
          : <span className="inline-block w-4 h-3 rounded bg-[var(--bg-elevated)] animate-pulse" />;
      case "lastArticles":
        return latestLoaded
          ? (latestArticles[site.domain] ? formatRelativeDate(latestArticles[site.domain]) : "—")
          : <span className="inline-block w-12 h-3 rounded bg-[var(--bg-elevated)] animate-pulse" />;
      case "siteId":
        return site.site_id || "—";
      case "created":
        return formatRelativeDate(site.created_at ?? "");
      case "lastUpdated":
        return formatRelativeDate(site.last_updated);
      case "customDomain":
        return site.custom_domain ?? "—";
      default: {
        // Live-config columns — "…" while the one-time fetch is in flight,
        // "—" once loaded but the value is missing/null.
        if (!liveConfigLoaded) return "…";
        const entry = liveConfig[site.domain];
        switch (column.id) {
          case "template": {
            const template = entry?.template ?? null;
            if (template === "grid") return "Grid";
            if (template === "modern") return "Modern";
            return "—";
          }
          case "ga4":
            return entry?.ga4 ?? "—";
          case "facebookPixel":
            return entry?.facebook_pixel ?? "—";
          case "gtm":
            return entry?.gtm ?? "—";
          case "googleAds":
            return entry?.google_ads ?? "—";
          case "articlesPerDay":
            return formatSchedule(entry?.articles_per_day ?? null, entry?.publish_days ?? null) || "—";
          case "lastSync":
            return entry?.last_synced_at ? formatRelativeDate(entry.last_synced_at) : "—";
          default:
            return "—";
        }
      }
    }
  }

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
      .catch(() => { /* leave empty */ })
      .finally(() => setGroupsLoaded(true));
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
    const filtered = filterSites(
      sites,
      {
        search,
        company: companyFilter,
        vertical: verticalFilter,
        status: statusFilter,
        group: groupFilter,
      },
      siteGroups,
    );
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
    if (createdSort) {
      filtered.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return createdSort === "asc" ? aTime - bTime : bTime - aTime;
      });
    }
    return filtered;
  }, [sites, search, companyFilter, verticalFilter, statusFilter, groupFilter, siteGroups, websiteSort, articlesSort, articleCounts, countsLoaded, lastArticlesSort, latestArticles, latestLoaded, createdSort]);

  const siteVerticals = useMemo(() => sites.map((s) => s.vertical), [sites]);

  // While /api/sites/groups hasn't resolved yet, `siteGroups` is still `{}`,
  // which makes every site look ungrouped — a specific group id would (wrongly)
  // match nothing, and NO_GROUP would (wrongly) match everything. Any group
  // filter is unreliable until groups have loaded, regardless of what
  // `filteredSites` currently computes to.
  const groupFilterPending = Boolean(groupFilter) && !groupsLoaded;

  const needsLiveConfigForExport = hasLiveColumn(visibleColumnIds);
  const exportWaitingOnLiveConfig = needsLiveConfigForExport && !liveConfigLoaded;

  function handleExportCsv(): void {
    const csv = buildSitesCsvForColumns(filteredSites, visibleColumns, {
      siteGroups,
      articleCounts,
      latestArticles,
      liveConfig,
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sitesCsvFilename();
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(filteredSites.length / pageSize));
  const paginatedSites = filteredSites.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const goToPage = useCallback((page: number): void => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  function handleRowClick(site: DashboardSiteEntry): void {
    if (site.status === "Staging") {
      router.push(`/sites/${encodeURIComponent(site.domain)}?tab=staging`);
    } else {
      router.push(`/sites/${encodeURIComponent(site.domain)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Filters
          search={search}
          company={companyFilter}
          vertical={verticalFilter}
          status={statusFilter}
          group={groupFilter}
          siteVerticals={siteVerticals}
          groupOptions={availableGroups}
          groupsLoading={!groupsLoaded}
          onSearchChange={setSearch}
          onCompanyChange={setCompanyFilter}
          onVerticalChange={setVerticalFilter}
          onStatusChange={setStatusFilter}
          onGroupChange={setGroupFilter}
        />
        <div className="flex items-center gap-2">
          <ColumnChooser
            columns={SITE_COLUMNS}
            visibleIds={visibleColumnIds}
            onToggle={handleColumnToggle}
            onReset={handleColumnReset}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleExportCsv}
            disabled={filteredSites.length === 0 || groupFilterPending || exportWaitingOnLiveConfig}
            title={
              exportWaitingOnLiveConfig
                ? "Waiting for live site data to finish loading…"
                : "Export the currently filtered sites as CSV"
            }
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={(): void => setBulkPublishOpen(true)}
            disabled={publishEligibleCount === 0 || bulkPublishBusy}
            title={
              bulkPublishBusy
                ? BULK_PUBLISH_BUSY_MESSAGE
                : "Find sites with unpublished staging changes and publish them"
            }
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            Publish changes
          </Button>
        </div>
      </div>

      {bulkPublishOpen && (
        <BulkPublishModal
          open={bulkPublishOpen}
          onClose={(): void => setBulkPublishOpen(false)}
          eligibleCount={publishEligibleCount}
          onPublished={(): void => router.refresh()}
        />
      )}

      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
        <div className="overflow-auto max-h-[80vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-surface)]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <button
                    type="button"
                    onClick={(): void => { setArticlesSort(null); setLastArticlesSort(null); setCreatedSort(null); setWebsiteSort((prev) => prev === "asc" ? "desc" : prev === "desc" ? null : "asc"); }}
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
                {visibleColumns.map((column) => (
                  <th key={column.id} className={headerClassName(column.id)}>
                    {renderColumnHeader(column)}
                  </th>
                ))}
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {groupFilterPending && (
                <tr>
                  <td
                    colSpan={2 + visibleColumns.length}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    Loading groups…
                  </td>
                </tr>
              )}
              {!groupFilterPending && filteredSites.length === 0 && (
                <tr>
                  <td
                    colSpan={2 + visibleColumns.length}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    {sites.length === 0
                      ? "No sites yet. Click \"Sync Domains\" to import from Cloudflare."
                      : "No sites match your filters."}
                  </td>
                </tr>
              )}
              {!groupFilterPending && paginatedSites.map((site) => (
                <tr
                  key={site.domain}
                  onClick={(): void => handleRowClick(site)}
                  className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors group relative"
                >
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                    {site.custom_domain ?? site.domain}
                  </td>
                  {visibleColumns.map((column) => (
                    <td key={column.id} className={cellClassName(column.id)}>
                      {renderColumnCell(column, site)}
                    </td>
                  ))}
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
        {!groupFilterPending && filteredSites.length > PAGE_SIZE_OPTIONS[0] && (
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
