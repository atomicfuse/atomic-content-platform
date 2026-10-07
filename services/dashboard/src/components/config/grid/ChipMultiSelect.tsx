"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** One selectable option. `group` puts it under a heading in the list (e.g. its main category). */
export interface ChipOption {
  value: string;
  label: string;
  /** Extra text shown after the label (e.g. an item count). */
  hint?: string;
  group?: string;
}

interface ChipMultiSelectProps {
  /** Accessible name for the control (also used for the search box). */
  label: string;
  /** Text of the add button, e.g. "Add vertical". */
  addLabel: string;
  value: string[];
  options: ChipOption[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is selected. */
  emptyText?: string;
  /** Accessible name of the add button when several controls share `addLabel` (e.g. "Add vertical to Celebs"). */
  addAriaLabel?: string;
}

const chipClass =
  "inline-flex items-center gap-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--text-primary)]";

/**
 * Compact multi-select: selected values as removable chips, everything else behind a searchable
 * "+ Add" list. Replaces walls of checkboxes for long option lists (verticals, bundles, categories).
 * Values no longer in `options` stay visible as "(missing)" chips so they can be removed.
 */
export function ChipMultiSelect({
  label, addLabel, value, options, onChange, emptyText = "None", addAriaLabel,
}: ChipMultiSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) =>
      !value.includes(o.value)
      && (!q || o.label.toLowerCase().includes(q) || (o.group ?? "").toLowerCase().includes(q)));
  }, [options, value, query]);

  // Close when clicking outside the control.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return (): void => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(): void {
    setOpen(false);
    setQuery("");
  }

  let lastGroup: string | undefined;
  return (
    <div ref={rootRef} className="relative" onKeyDown={(e): void => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <span className="text-xs text-[var(--text-muted)]">{emptyText}</span>}
        {value.map((v) => {
          const opt = byValue.get(v);
          const text = opt ? `${opt.label}${opt.hint ? ` · ${opt.hint}` : ""}` : `${v} (missing)`;
          return (
            <span key={v} className={`${chipClass} ${opt ? "" : "border-dashed text-[var(--text-muted)]"}`}>
              {text}
              <button
                type="button"
                aria-label={`Remove ${text.replace(" (missing)", "")}`}
                onClick={(): void => onChange(value.filter((x) => x !== v))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-red-400 transition-colors"
              >
                &times;
              </button>
            </span>
          );
        })}
        <button
          type="button"
          aria-label={addAriaLabel ?? addLabel}
          aria-expanded={open}
          onClick={(): void => (open ? close() : setOpen(true))}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-primary)] px-2.5 py-0.5 text-xs font-medium text-cyan hover:border-cyan hover:bg-cyan/5 transition-colors"
        >
          + {addLabel}
        </button>
      </div>

      {open && (
        <div className="absolute left-0 z-20 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
          <input
            type="search"
            autoFocus
            aria-label={`Search ${label}`}
            placeholder="Search…"
            value={query}
            onChange={(e): void => setQuery(e.target.value)}
            className="w-full rounded-t-lg border-b border-[var(--border-secondary)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {available.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">{query ? "No matches" : "Everything is selected"}</p>
            )}
            {available.map((o) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {heading && (
                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{heading}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={(): void => onChange([...value, o.value])}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors ${o.group ? "pl-5" : ""}`}
                  >
                    <span>{o.label}</span>
                    {o.hint && <span className="text-xs text-[var(--text-muted)]">{o.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
