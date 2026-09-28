"use client";

import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { GRID_COLOR_GROUPS } from "@/types/grid";

interface GridThemeFieldsProps {
  colors: Record<string, string>;
  /** null = remove the key (inherit the fallback shown in the helper text). */
  onChange: (key: string, value: string | null) => void;
}

/**
 * Colour editor for Grid-template sites — only the keys the Grid template
 * actually renders (spec "Theming → Colours"), grouped the way a Grid page
 * reads top to bottom: page & cards, text, accent & links, pills & search,
 * story text, footer.
 *
 * Rendered inside SiteThemeTab's Grid-mode branch, loaded via `next/dynamic`
 * so it stays out of the initial bundle for sites still on the Modern
 * template (per CLAUDE.md heavy-component convention).
 */
export function GridThemeFields({ colors, onChange }: GridThemeFieldsProps): React.ReactElement {
  return (
    <div className="space-y-5">
      {GRID_COLOR_GROUPS.map((group) => (
        <section key={group.title}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {group.title}
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.fields.map(([key, label, inherits]) => (
              <div key={key} className="space-y-1">
                <ColorPickerField
                  label={label}
                  value={colors[key] ?? ""}
                  onChange={(v): void => onChange(key, v)}
                  helperText={inherits ? `Inherits ${inherits} when empty` : undefined}
                />
                {inherits && colors[key] && (
                  <button
                    type="button"
                    className="text-xs font-medium text-cyan hover:underline"
                    aria-label={`Use default for ${label}`}
                    onClick={(): void => onChange(key, null)}
                  >
                    Use default
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
