"use client";

import type { CategoryItem } from "@/lib/reference-data";

interface BlockedCategoriesPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Aggregator taxonomy: tier-1s (parent_id null) and subcategories. */
  categories: CategoryItem[];
}

const checkboxClass = "h-4 w-4 rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50";

/**
 * Aggregator categories whose stories never show on this Grid site. A story is hidden when ANY of its
 * categories is blocked, so blocking a tier-1 hides everything under it. Stored by name; names no
 * longer in the taxonomy stay visible (checked) so they can be cleared.
 */
export function BlockedCategoriesPicker({ value, onChange, categories }: BlockedCategoriesPickerProps): React.ReactElement {
  const toggle = (name: string, on: boolean): void => onChange(on ? [...value, name] : value.filter((v) => v !== name));
  const tier1 = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(categories.map((c) => c.name));
  const orphans = value.filter((v) => !known.has(v));

  const box = (name: string): React.ReactElement => (
    <label className="inline-flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
      <input type="checkbox" checked={value.includes(name)} onChange={(e): void => toggle(name, e.target.checked)} className={checkboxClass} />
      {name}
    </label>
  );

  return (
    <div className="space-y-2" role="group" aria-label="Blocked categories">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Blocked categories
      </span>
      <p className="text-xs text-[var(--text-muted)]">
        Aggregator stories in any of these categories never appear on this site. Blocking a main category also blocks its subcategories.
      </p>
      {tier1.length === 0 && orphans.length === 0 && (
        <span className="text-xs text-[var(--text-muted)]">No categories available.</span>
      )}
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {tier1.map((t) => {
          const subs = categories.filter((c) => c.parent_id === t.id).sort((a, b) => a.name.localeCompare(b.name));
          const subBlocked = subs.filter((s) => value.includes(s.name)).length;
          return (
            <div key={t.id} className="space-y-1">
              {box(t.name)}
              {subs.length > 0 && (
                <details className="pl-6">
                  <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
                    {subs.length} subcategories{subBlocked ? ` · ${subBlocked} blocked` : ""}
                  </summary>
                  <div className="mt-1 flex flex-col gap-1">
                    {subs.map((s) => <div key={s.id}>{box(s.name)}</div>)}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        {orphans.map((name) => <div key={name}>{box(name)}</div>)}
      </div>
    </div>
  );
}
