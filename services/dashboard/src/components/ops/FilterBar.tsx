"use client";

import type React from "react";
import type { SiteStatus } from "@/types/dashboard";

interface FilterBarProps {
  verticals: string[];
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: SiteStatus | "All";
  onStatusChange: (value: SiteStatus | "All") => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  onReset: () => void;
}

const STATUSES: (SiteStatus | "All")[] = ["All", "Live", "Staging", "Preview", "Ready", "New", "WordPress"];

export function FilterBar({
  verticals,
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
  onReset,
}: FilterBarProps): React.ReactElement {
  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        placeholder="Search sites..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-primary-text placeholder:text-secondary"
      />
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value as SiteStatus | "All")}
        className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-secondary"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>
        ))}
      </select>
      <select
        value={categoryFilter}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-secondary"
      >
        <option value="">All categories</option>
        {verticals.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <button
        onClick={onReset}
        className="text-sm text-primary font-medium px-3 py-1.5 cursor-pointer"
      >
        Reset filters
      </button>
    </div>
  );
}
