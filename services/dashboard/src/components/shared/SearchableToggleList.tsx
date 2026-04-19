"use client";

import { useState, useMemo } from "react";

interface SearchableToggleListItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface SearchableToggleListProps {
  items: SearchableToggleListItem[];
  selected: string[];
  onToggle: (id: string) => void;
  searchPlaceholder?: string;
  maxVisible?: number;
}

export function SearchableToggleList({
  items,
  selected,
  onToggle,
  searchPlaceholder = "Search...",
  maxVisible = 5,
}: SearchableToggleListProps): React.ReactElement {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [items, search]);

  // ~44px per item, so maxVisible * 44 = max height
  const maxHeight = maxVisible * 44;

  return (
    <div className="space-y-2">
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
