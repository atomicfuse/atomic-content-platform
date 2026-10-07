"use client";

interface BlockedSourcesPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Aggregator source names (from /api/aggregator/sources). */
  options: string[];
}

/** Checkbox list of Content Aggregator sources never shown on this Grid site. Blocked names no longer offered stay visible. */
export function BlockedSourcesPicker({ value, onChange, options }: BlockedSourcesPickerProps): React.ReactElement {
  const names = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    <div className="space-y-2" role="group" aria-label="Blocked sources">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Blocked sources
      </span>
      <p className="text-xs text-[var(--text-muted)]">Stories from these aggregator sources never appear on this site.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {names.length === 0 && <span className="text-xs text-[var(--text-muted)]">No sources available.</span>}
        {names.map((n) => (
          <label key={n} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={value.includes(n)}
              onChange={(e): void => onChange(e.target.checked ? [...value, n] : value.filter((x) => x !== n))}
              className="h-4 w-4 rounded border-[var(--border-primary)] text-cyan focus:ring-cyan/50"
            />
            {n}
          </label>
        ))}
      </div>
    </div>
  );
}
