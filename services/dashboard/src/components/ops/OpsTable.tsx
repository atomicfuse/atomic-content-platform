"use client";

import { useState, useMemo } from "react";
import type { OpsRow } from "@/lib/ops-helpers";
import { OpsTableRow } from "./OpsTableRow";

interface OpsTableProps {
  rows: OpsRow[];
}

const COLUMNS = ["Site", "Status", "Failed 7d", "Img Fail", "Uptime", "Sync", "Review", "SSL", "Tracking", "Domain"];
const PAGE_SIZES = [10, 25, 50, 100];

export function OpsTable({ rows }: OpsTableProps): React.ReactElement {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const totalPages = Math.ceil(rows.length / pageSize);
  const pageRows = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize],
  );

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
                <th key={col} className="px-3.5 py-2.5 text-left text-[9px] uppercase tracking-wider text-secondary font-semibold">{col}</th>
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
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length} sites
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
