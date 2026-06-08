"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { DashboardSiteEntry, SiteStatus } from "@/types/dashboard";
import {
  mergeOpsRows,
  sortByTier,
  cardPredicate,
  computeCostStrip,
  type OpsRow,
  type CardId,
  type StatsInput,
  type ChecksInput,
  type AttentionInput,
} from "@/lib/ops-helpers";
import { FilterCards } from "./FilterCards";
import { CostStrip } from "./CostStrip";
import { FilterBar } from "./FilterBar";
import { OpsTable } from "./OpsTable";

interface R2Data {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

interface CostSite {
  siteDomain: string;
  windows: {
    todayUsd: number;
    thisWeekUsd: number;
    last30dUsd: number;
    allTimeTokens: { input: number; output: number };
    avgPerArticle7dUsd: number;
    created7d: number;
  };
}

interface OpsDashboardProps {
  initialIndex: DashboardSiteEntry[];
  initialStats: { sites: StatsInput[] };
  initialChecks: { sites: ChecksInput[] };
  initialCosts: { sites: CostSite[] };
  initialAttention: { sites: AttentionInput[] };
  initialR2: R2Data;
}

const POLL_INTERVAL = 60_000;
/** Consider data stale after 30s — only re-fetch on mount if older. */
const STALE_THRESHOLD = 30_000;

const EMPTY_R2: R2Data = { totalBytes: 0, totalImages: 0, capacityPct: 0, lastUpdated: null };

/* ------------------------------------------------------------------ */
/*  Module-level cache — survives unmount/remount across navigations   */
/* ------------------------------------------------------------------ */
interface DataCache {
  stats: { sites: StatsInput[] };
  checks: { sites: ChecksInput[] };
  costs: { sites: CostSite[] };
  attention: { sites: AttentionInput[] };
  r2: R2Data;
  lastRefreshed: number;
}
let _cache: DataCache | null = null;

function safeR2(raw: R2Data): R2Data {
  return {
    totalBytes: raw?.totalBytes ?? 0,
    totalImages: raw?.totalImages ?? 0,
    capacityPct: raw?.capacityPct ?? 0,
    lastUpdated: raw?.lastUpdated ?? null,
  };
}

export default function OpsDashboard({
  initialIndex,
  initialStats,
  initialChecks,
  initialCosts,
  initialAttention,
  initialR2,
}: OpsDashboardProps): React.ReactElement {
  // Prefer module cache (survives navigation) over server-provided initial data
  const [stats, setStats] = useState(_cache?.stats ?? initialStats);
  const [checks, setChecks] = useState(_cache?.checks ?? initialChecks);
  const [costs, setCosts] = useState(_cache?.costs ?? initialCosts);
  const [attention, setAttention] = useState(_cache?.attention ?? initialAttention);
  const [r2, setR2] = useState(_cache?.r2 ?? safeR2(initialR2));
  const [lastRefreshed, setLastRefreshed] = useState(_cache?.lastRefreshed ?? Date.now());
  const [failCount, setFailCount] = useState(0);

  const [activeCard, setActiveCard] = useState<CardId | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "All">("All");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Polling — persists results to module cache so data survives navigation
  const poll = useCallback(async () => {
    try {
      const [sResp, chResp, coResp, aResp, rResp] = await Promise.all([
        fetch("/api/site-stats").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/site-checks").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/site-costs").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/attention").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/r2-usage").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (sResp) setStats(sResp as typeof initialStats);
      if (chResp) setChecks(chResp as typeof initialChecks);
      if (coResp) setCosts(coResp as typeof initialCosts);
      if (aResp) setAttention(aResp as typeof initialAttention);
      if (rResp) setR2(safeR2(rResp as R2Data));
      const now = Date.now();
      setLastRefreshed(now);
      setFailCount(0);
      // Persist to module cache
      _cache = {
        stats: sResp ?? _cache?.stats ?? initialStats,
        checks: chResp ?? _cache?.checks ?? initialChecks,
        costs: coResp ?? _cache?.costs ?? initialCosts,
        attention: aResp ?? _cache?.attention ?? initialAttention,
        r2: rResp ? safeR2(rResp as R2Data) : (_cache?.r2 ?? safeR2(initialR2)),
        lastRefreshed: now,
      };
    } catch {
      setFailCount((c) => c + 1);
    }
  }, [initialStats, initialChecks, initialCosts, initialAttention, initialR2]);

  useEffect(() => {
    // Only poll immediately if cached data is stale or missing
    const age = Date.now() - (_cache?.lastRefreshed ?? 0);
    if (age > STALE_THRESHOLD) poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  // Index → filter to real sites
  const indexSites = useMemo(
    () => initialIndex.filter((s) => s.staging_branch !== null || s.pages_project !== null),
    [initialIndex],
  );

  // Merge
  const allRows = useMemo(
    () =>
      sortByTier(
        mergeOpsRows(
          indexSites.map((s) => ({
            domain: s.domain,
            status: s.status as SiteStatus,
            custom_domain: s.custom_domain,
            vertical: s.vertical ?? "",
          })),
          stats.sites ?? [],
          checks.sites ?? [],
          attention.sites ?? [],
        ),
      ),
    [indexSites, stats, checks, attention],
  );

  // Cost strip
  const costStripData = useMemo(() => {
    const costInputs = (costs.sites ?? []).map((c) => c.windows);
    const schedules = allRows.map((r) =>
      r.schedule
        ? { articlesPerDay: r.schedule.articlesPerDay, preferredDays: r.schedule.preferredDays }
        : null,
    );
    return computeCostStrip(costInputs, r2, schedules);
  }, [costs, r2, allRows]);

  // Verticals for filter dropdown
  const verticals = useMemo(
    () => [...new Set(indexSites.map((s) => s.vertical).filter(Boolean))].sort(),
    [indexSites],
  );

  // Filter
  const filteredRows = useMemo(() => {
    let rows: OpsRow[] = allRows;
    if (activeCard) rows = rows.filter(cardPredicate(activeCard));
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter(
        (r) => r.domain.toLowerCase().includes(q) || (r.customDomain?.toLowerCase().includes(q) ?? false),
      );
    }
    if (statusFilter !== "All") rows = rows.filter((r) => r.status === statusFilter);
    if (categoryFilter) rows = rows.filter((r) => r.vertical === categoryFilter);
    return rows;
  }, [allRows, activeCard, debouncedSearch, statusFilter, categoryFilter]);

  const secondsAgo = Math.round((Date.now() - lastRefreshed) / 1000);

  function handleCardClick(card: CardId): void {
    setActiveCard((prev) => (prev === card ? null : card));
  }

  function handleReset(): void {
    setSearch("");
    setStatusFilter("All");
    setCategoryFilter("");
    setActiveCard(null);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-heading">Content Network</h1>
          <p className="text-secondary text-xs">
            Last refreshed: {secondsAgo}s ago · Auto-refresh: 60s
            {failCount >= 3 && <span className="text-warning ml-2">· Connection issues</span>}
          </p>
        </div>
        <button
          onClick={poll}
          className="px-3.5 py-1.5 bg-card border border-primary-border rounded-lg text-primary text-xs font-medium cursor-pointer"
        >
          ↻ Refresh now
        </button>
      </div>

      <FilterCards rows={allRows} activeCard={activeCard} onCardClick={handleCardClick} />
      <CostStrip data={costStripData} />
      <FilterBar
        verticals={verticals}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        onReset={handleReset}
      />
      <OpsTable rows={filteredRows} />
    </div>
  );
}
