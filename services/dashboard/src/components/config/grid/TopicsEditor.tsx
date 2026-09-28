"use client";

import type { GridTopicFields } from "@/types/grid";

interface TopicsEditorProps {
  value: GridTopicFields[];
  onChange: (next: GridTopicFields[]) => void;
  verticals: string[];
}

const inputClass =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors";

const iconButtonClass =
  "rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

/**
 * Ordered pill editor for the Grid template's topic navigation. Each pill has
 * a label (+ optional slug) and pulls in articles from Live network sites
 * whose vertical matches one of the selected verticals.
 */
export function TopicsEditor({ value, onChange, verticals }: TopicsEditorProps): React.ReactElement {
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
            <div className="space-y-1.5" role="group" aria-label={`Verticals for ${name}`}>
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Verticals
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {verticals.length === 0 && (
                  <span className="text-xs text-[var(--text-muted)]">No verticals configured yet.</span>
                )}
                {verticals.map((v) => (
                  <label key={v} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={topic.verticals.includes(v)}
                      onChange={(e): void =>
                        update(i, {
                          verticals: e.target.checked
                            ? [...topic.verticals, v]
                            : topic.verticals.filter((x) => x !== v),
                        })
                      }
                      className="h-4 w-4 rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50"
                    />
                    {v}
                  </label>
                ))}
              </div>
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
