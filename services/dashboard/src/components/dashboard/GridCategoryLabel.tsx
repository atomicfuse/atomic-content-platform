import { MULTI_CATEGORY } from "@/lib/grid-config";

interface GridCategoryLabelProps {
  /** Verticals the Grid site's topic pills use (see `gridCategoryChips`). */
  chips: readonly string[];
  /** Chips shown before collapsing the rest into "+N". */
  max?: number;
}

/** "Multi-category" plus one small chip per vertical a Grid site's pills draw from. */
export function GridCategoryLabel({ chips, max = 3 }: GridCategoryLabelProps): React.ReactElement {
  const shown = chips.slice(0, max);
  const hidden = chips.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={chips.join(", ") || undefined}>
      <span>{MULTI_CATEGORY}</span>
      {shown.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-[var(--border-secondary)] px-1.5 py-px text-[11px] leading-4 text-[var(--text-muted)]"
        >
          {chip}
        </span>
      ))}
      {hidden > 0 && <span className="text-[11px] text-[var(--text-muted)]">+{hidden}</span>}
    </span>
  );
}
