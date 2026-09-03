"use client";

import { useState, useMemo } from "react";
import type { OpsRow } from "@/lib/ops-helpers";
import { OpsTableRow } from "./OpsTableRow";

interface OpsTableProps {
  rows: OpsRow[];
}

type SortKey = "site" | "status" | "failed7d" | "imgFail" | "uptime" | "sync" | "review" | "ssl" | "tracking" | "domain";
type SortDir = "asc" | "desc";

interface ColumnDef {
  label: string;
  key: SortKey;
}

const COLUMNS: ColumnDef[] = [
  { label: "Site", key: "site" },
  { label: "Status", key: "status" },
  { label: "Failed 7d", key: "failed7d" },
  { label: "Img Fail", key: "imgFail" },
  { label: "Uptime", key: "uptime" },
  { label: "Sync", key: "sync" },
  { label: "Review", key: "review" },
  { label: "SSL", key: "ssl" },
  { label: "Tracking", key: "tracking" },
  { label: "Domain", key: "domain" },
];

const PAGE_SIZES = [10, 25, 50, 100];

function trackingScore(row: OpsRow): number {
  if (row.tracking.state === "n/a" || row.tracking.state === "unknown") return 0;
  return (row.tracking.ga4 ? 4 : 0) + (row.tracking.gtm ? 2 : 0) + (row.tracking.pixel ? 1 : 0);
}

function getSortValue(row: OpsRow, key: SortKey): string | number {
  switch (key) {
    case "site": return (row.customDomain ?? row.domain).toLowerCase();
    case "status": return row.status;
    case "failed7d": return row.failedArticles7d;
    case "imgFail": return row.imageGenFailed7d;
    case "uptime": return row.uptime.state === "n/a" ? -1 : row.uptime.ok ? 1 : 0;
    case "sync": return row.sync.ok === null ? -1 : row.sync.ok ? 1 : 0;
    case "review": return row.reviewCount;
    case "ssl": return row.ssl.state === "n/a" ? -1 : row.ssl.status === "active" ? 1 : 0;
    case "tracking": return trackingScore(row);
    case "domain": return row.domainExpiry.daysLeft ?? 9999;
  }
}

export function OpsTable({ rows }: OpsTableProps): React.ReactElement {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      let cmp: number;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedRows.length / pageSize);
  const pageRows = useMemo(
    () => sortedRows.slice(page * pageSize, (page + 1) * pageSize),
    [sortedRows, page, pageSize],
  );

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  function toggleRow(domain: string): void {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  return (
    <div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-card">
        <div className="overflow-auto max-h-[80vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-table-header border-b border-divider">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3.5 py-2.5 text-left text-[9px] uppercase tracking-wider text-secondary font-semibold cursor-pointer select-none hover:text-heading transition-colors"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <span className="inline-flex flex-col leading-none text-[7px]">
                      <span className={sortKey === col.key && sortDir === "asc" ? "text-primary" : "opacity-30"}>▲</span>
                      <span className={sortKey === col.key && sortDir === "desc" ? "text-primary" : "opacity-30"}>▼</span>
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <OpsTableRow
                key={row.domain}
                row={row}
                expanded={expandedRows.has(row.domain)}
                onToggle={() => toggleRow(row.domain)}
              />
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={10} className="px-3.5 py-8 text-center text-secondary">No sites match the current filters.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center mt-3 text-secondary text-xs">
        <div>
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedRows.length)} of {sortedRows.length} sites
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="ml-2 bg-card border border-card-border rounded px-1.5 py-0.5 text-xs"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2.5 py-1 border border-card-border rounded-md disabled:opacity-40">← Prev</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`px-2.5 py-1 rounded-md ${i === page ? "bg-primary text-white" : "border border-card-border"}`}
            >
              {i + 1}
            </button>
          ))}
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} className="px-2.5 py-1 border border-card-border rounded-md disabled:opacity-40">Next →</button>
        </div>
      </div>
    </div>
  );
}
