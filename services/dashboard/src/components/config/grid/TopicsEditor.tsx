"use client";

import type { BundleOption, GridTopicFields } from "@/types/grid";
import { ChipMultiSelect } from "./ChipMultiSelect";

interface TopicsEditorProps {
  value: GridTopicFields[];
  onChange: (next: GridTopicFields[]) => void;
  verticals: string[];
  /** Content Aggregator bundles available to attach to pills. */
  bundles?: BundleOption[];
}

const inputClass =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors";

const iconButtonClass =
  "rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

/**
 * Ordered pill editor for the Grid template's topic navigation. Each pill has
 * a label (+ optional slug) and pulls in stories from Live network sites in the
 * selected verticals and from the selected Content Aggregator bundles.
 */
export function TopicsEditor({ value, onChange, verticals, bundles = [] }: TopicsEditorProps): React.ReactElement {
  const update = (i: number, patch: Partial<GridTopicFields>): void =>
    onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const move = (i: number, dir: -1 | 1): void => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + dir, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">No topic pills yet. The Grid nav will show just &quot;Latest&quot;.</p>
      )}
      {value.map((topic, i) => {
        const name = topic.label || `topic ${i + 1}`;
        return (
          <fieldset
            key={i}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3 space-y-3"
          >
            <legend className="sr-only">{name}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm text-[var(--text-primary)]">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Label
                </span>
                <input
                  className={inputClass}
                  value={topic.label}
                  placeholder="e.g. Health"
                  onChange={(e): void => update(i, { label: e.target.value })}
                />
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm text-[var(--text-primary)]">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Slug (optional)
                </span>
                <input
                  className={inputClass}
                  value={topic.slug ?? ""}
                  placeholder="auto from label"
                  onChange={(e): void =>
                    update(i, e.target.value ? { slug: e.target.value } : { slug: undefined })
                  }
                />
              </label>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={(): void => move(i, -1)}
                  className={iconButtonClass}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${name} down`}
                  disabled={i === value.length - 1}
                  onClick={(): void => move(i, 1)}
                  className={iconButtonClass}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={(): void => onChange(value.filter((_, j) => j !== i))}
                  className="rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  &times;
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[6.5rem_1fr] sm:items-start">
              <span className="pt-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Verticals</span>
              <ChipMultiSelect
                label={`Verticals for ${name}`}
                addLabel="Add vertical"
                addAriaLabel={`Add vertical to ${name}`}
                emptyText="No verticals"
                value={topic.verticals}
                options={verticals.map((v) => ({ value: v, label: v }))}
                onChange={(next): void => update(i, { verticals: next })}
              />
              <span className="pt-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Bundles</span>
              <ChipMultiSelect
                label={`Bundles for ${name}`}
                addLabel="Add bundle"
                addAriaLabel={`Add bundle to ${name}`}
                emptyText="No aggregator bundles"
                value={topic.bundles ?? []}
                options={bundles.map((b) => ({ value: b.id, label: b.name, hint: String(b.count) }))}
                onChange={(next): void => update(i, { bundles: next.length ? next : undefined })}
              />
            </div>
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={(): void => onChange([...value, { label: "", verticals: [] }])}
        className="inline-flex items-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        Add topic
      </button>
    </div>
  );
}

