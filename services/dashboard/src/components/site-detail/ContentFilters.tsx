"use client";

import { useMemo } from "react";

export interface ContentFilterState {
  search: string;
  status: string;   // "" = all, "published" (includes legacy "approved"), "review", "draft"
  type: string;     // "" = all, "listicle", "how-to", "review", "standard"
  generalImage: string; // "" = all, "yes", "no"
  sortBy: string;   // "date-desc" (default), "date-asc", "score-desc", "score-asc"
}

interface ContentFiltersProps {
  filters: ContentFilterState;
  onChange: (filters: ContentFilterState) => void;
  articleCount: number;
  filteredCount: number;
}

const SELECT_STYLES =
  "rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500";

const INPUT_STYLES =
  "rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm px-3 py-1.5 placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-[180px]";

export function ContentFilters({
  filters,
  onChange,
  articleCount,
  filteredCount,
}: ContentFiltersProps): React.ReactElement {
  const isFiltered = useMemo(
    () =>
      filters.search !== "" ||
      filters.status !== "" ||
      filters.type !== "" ||
      filters.generalImage !== "" ||
      filters.sortBy !== "date-desc",
    [filters]
  );

  function set(patch: Partial<ContentFilterState>): void {
    onChange({ ...filters, ...patch });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        placeholder="Search articles..."
        value={filters.search}
        onChange={(e): void => set({ search: e.target.value })}
        className={INPUT_STYLES}
      />

      <select
        value={filters.status}
        onChange={(e): void => set({ status: e.target.value })}
        className={SELECT_STYLES}
      >
        <option value="">All statuses</option>
        <option value="approved">Published</option>
        <option value="review">Review</option>
        <option value="draft">Draft</option>
      </select>

      <select
        value={filters.type}
        onChange={(e): void => set({ type: e.target.value })}
        className={SELECT_STYLES}
      >
        <option value="">All types</option>
        <option value="listicle">Listicle</option>
        <option value="how-to">How-to</option>
        <option value="review">Review</option>
        <option value="standard">Standard</option>
      </select>

      <select
        value={filters.generalImage}
        onChange={(e): void => set({ generalImage: e.target.value })}
        className={SELECT_STYLES}
      >
        <option value="">All images</option>
        <option value="yes">General image</option>
        <option value="no">Custom image</option>
      </select>

      <select
        value={filters.sortBy}
        onChange={(e): void => set({ sortBy: e.target.value })}
        className={SELECT_STYLES}
      >
        <option value="date-desc">Newest first</option>
        <option value="date-asc">Oldest first</option>
        <option value="score-desc">Highest score</option>
        <option value="score-asc">Lowest score</option>
      </select>

      {isFiltered && (
        <span className="text-sm text-[var(--text-muted)] ml-1">
          Showing {filteredCount} of {articleCount}
        </span>
      )}
    </div>
  );
}
