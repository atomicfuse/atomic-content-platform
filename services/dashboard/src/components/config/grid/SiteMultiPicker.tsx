"use client";

import type { SiteOption } from "@/types/grid";

interface SiteMultiPickerProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: SiteOption[];
}

/** Chip list of selected site domains plus a dropdown to add another. */
export function SiteMultiPicker({ label, value, onChange, options }: SiteMultiPickerProps): React.ReactElement {
  const remaining = options.filter((o) => !value.includes(o.domain));
  return (
    <div className="space-y-2">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && <span className="text-xs text-[var(--text-muted)]">None</span>}
        {value.map((d) => (
          <span
            key={d}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
          >
            {d}
            <button
              type="button"
              aria-label={`Remove ${d} from ${label}`}
              onClick={(): void => onChange(value.filter((x) => x !== d))}
              className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <select
        aria-label={`Add site to ${label}`}
        className="w-full max-w-xs rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
        value=""
        onChange={(e): void => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
      >
        <option value="">Add a site…</option>
        {remaining.map((o) => (
          <option key={o.domain} value={o.domain}>
            {o.domain} ({o.vertical || "no vertical"}, {o.status})
          </option>
        ))}
      </select>
    </div>
  );
}
