"use client";

export type SiteTemplate = "modern" | "grid";

interface TemplateSelectorProps {
  value: SiteTemplate;
  onChange: (next: SiteTemplate) => void;
  /** Optional content rendered below the radio-card group (e.g. contextual hint copy). */
  hint?: React.ReactNode;
}

/**
 * Radio-card picker for the site template (Modern magazine layout vs. Grid
 * network card feed). Shared between `SiteThemeTab` (existing sites) and
 * `StepTheme` (new-site wizard) — keep both call sites' look and a11y
 * (role="radiogroup" / role="radio" + aria-checked) identical.
 */
export function TemplateSelector({ value, onChange, hint }: TemplateSelectorProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">Template</h3>
      <div role="radiogroup" aria-label="Site template" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === "modern"}
          onClick={(): void => onChange("modern")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            value === "modern"
              ? "border-cyan bg-cyan/10"
              : "border-[var(--border-secondary)] hover:border-[var(--border-primary)]"
          }`}
        >
          <p className="text-sm font-semibold text-[var(--text-primary)]">Modern</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Magazine layout: hero, must-reads, sections.
          </p>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "grid"}
          onClick={(): void => onChange("grid")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            value === "grid"
              ? "border-cyan bg-cyan/10"
              : "border-[var(--border-secondary)] hover:border-[var(--border-primary)]"
          }`}
        >
          <p className="text-sm font-semibold text-[var(--text-primary)]">Grid</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Card-grid news feed of stories from other network sites.
          </p>
        </button>
      </div>
      {hint}
    </div>
  );
}
