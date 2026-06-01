"use client";

import { useState, useMemo } from "react";

interface SearchableToggleListItem {
  id: string;
  label: string;
  sublabel?: string;
  group?: string;
}

interface SearchableToggleListProps {
  items: SearchableToggleListItem[];
  selected: string[];
  onToggle: (id: string) => void;
  searchPlaceholder?: string;
  maxVisible?: number;
  /** When provided, shows a group filter dropdown (e.g. company filter) with Select All / Deselect All */
  groupFilterLabel?: string;
  /** List of group options for the dropdown (e.g. ["ATL", "NGC"]) */
  groupOptions?: string[];
  /** Label for items with no group value */
  noGroupLabel?: string;
}

export function SearchableToggleList({
  items,
  selected,
  onToggle,
  searchPlaceholder = "Search...",
  maxVisible = 5,
  groupFilterLabel,
  groupOptions,
  noGroupLabel = "No Company",
}: SearchableToggleListProps): React.ReactElement {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");

  const filtered = useMemo(() => {
    let result = items;
    if (groupFilter) {
      result = result.filter((item) =>
        groupFilter === "__none__" ? !item.group : item.group === groupFilter,
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [items, search, groupFilter]);

  const filteredUnselectedCount = filtered.filter((item) => !selected.includes(item.id)).length;
  const filteredSelectedCount = filtered.filter((item) => selected.includes(item.id)).length;

  function selectAllFiltered(): void {
    for (const item of filtered) {
      if (!selected.includes(item.id)) {
        onToggle(item.id);
      }
    }
  }

  function deselectAllFiltered(): void {
    for (const item of filtered) {
      if (selected.includes(item.id)) {
        onToggle(item.id);
      }
    }
  }

  // ~44px per item, so maxVisible * 44 = max height
  const maxHeight = maxVisible * 44;

  return (
    <div className="space-y-2">
      {groupFilterLabel && groupOptions && groupOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={groupFilter}
            onChange={(e): void => setGroupFilter(e.target.value)}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
          >
            <option value="">{groupFilterLabel}: All</option>
            {groupOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
            <option value="__none__">{noGroupLabel}</option>
          </select>
          {(groupFilter || search.trim()) && filtered.length > 0 && (
            <div className="flex items-center gap-1.5">
              {filteredUnselectedCount > 0 && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-xs px-2 py-1 rounded border border-cyan/30 text-cyan hover:bg-cyan/10 transition-colors"
                >
                  Select all ({filteredUnselectedCount})
                </button>
              )}
              {filteredSelectedCount > 0 && (
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="text-xs px-2 py-1 rounded border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 transition-colors"
                >
                  Deselect all ({filteredSelectedCount})
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={(e): void => setSearch(e.target.value)}
        placeholder={searchPlaceholder}
        className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
      />
      <div
        className="space-y-1 overflow-y-auto"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-2 text-center">
            No matches
          </p>
        ) : (
          filtered.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={(): void => onToggle(item.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {item.sublabel}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
