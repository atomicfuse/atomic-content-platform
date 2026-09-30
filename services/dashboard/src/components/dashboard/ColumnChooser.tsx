"use client";

import { useEffect, useRef, useState } from "react";
import type { SiteColumnDef } from "@/lib/site-columns";

interface ColumnChooserProps {
  /** Chooser-eligible columns (excludes Website/Actions), in display order. */
  columns: SiteColumnDef[];
  visibleIds: string[];
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}

/**
 * "Columns" toolbar button + popover for the Sites table: a checkbox per
 * optional column, plus "Reset to default". Visibility itself lives in
 * `SitesTable` (backed by `localStorage` via `src/lib/site-columns.ts`) —
 * this component is purely the menu chrome.
 */
export function ColumnChooser({
  columns,
  visibleIds,
  onToggle,
  onReset,
}: ColumnChooserProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = new Set(visibleIds);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return (): void => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(): void => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M4.5 9h15M4.5 15h15" />
        </svg>
        Columns
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose visible columns"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] shadow-xl overflow-hidden"
        >
          <div className="max-h-80 overflow-y-auto py-1.5">
            {columns.map((column) => {
              const checked = visible.has(column.id);
              return (
                <label
                  key={column.id}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(): void => onToggle(column.id, !checked)}
                    className="h-4 w-4 rounded border-[var(--border-primary)] accent-[var(--accent-primary)] cursor-pointer"
                  />
                  <span className="flex-1">{column.label}</span>
                  {column.tooltip && (
                    <span title={column.tooltip} className="text-[var(--text-muted)] cursor-help">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M12 16h.01M12 8v4" />
                      </svg>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="border-t border-[var(--border-secondary)] px-3.5 py-2">
            <button
              type="button"
              onClick={onReset}
              className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
