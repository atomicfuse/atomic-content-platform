"use client";

import { forwardRef, useMemo, useRef } from "react";
import {
  presetsByTier,
  pickRandomPreset,
  type PresetDefinition,
} from "@/components/wizard/themePresets";

interface ThemePresetPickerProps {
  /** Currently selected preset ID, or "custom" when colors don't match any preset. */
  value: string;
  /** Called when the user picks a preset. The string is always a real preset ID. */
  onChange: (id: string) => void;
}

/**
 * Tier-grouped preset picker with preview-band cards and a Surprise Me button.
 * Shared between the wizard (StepTheme) and the per-site editor (SiteThemeTab).
 *
 * Layout: 2 cols mobile, 3 tablet, 4 desktop. Selected state uses ring +
 * checkmark badge (color-not-only). Hover scale respects reduced-motion.
 */
export function ThemePresetPicker({ value, onChange }: ThemePresetPickerProps): React.ReactElement {
  const grouped = useMemo(() => presetsByTier(), []);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function handleSurprise(): void {
    const next = pickRandomPreset(value === "custom" ? undefined : value);
    onChange(next);
    // Scroll the freshly-picked card into view (smooth, centered).
    requestAnimationFrame(() => {
      cardRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  return (
    <div className="space-y-3">
      {/* Header row: label + Surprise Me */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Theme Preset</h3>
        <button
          type="button"
          onClick={handleSurprise}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-cyan hover:bg-cyan/10 hover:text-cyan"
          title="Pick a random preset"
        >
          <DiceIcon />
          Surprise me
        </button>
      </div>

      {/* Custom-state notice */}
      {value === "custom" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Your current colors don't match a preset. Pick one below to overwrite, or keep tweaking individual colors.
        </div>
      )}

      {/* Tiered grid */}
      <div className="space-y-5">
        {grouped.map(({ tier, presets }) => (
          <section key={tier.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {tier.label}
              </h4>
              {tier.highlight && <SparklesIcon />}
              <span className="text-[10px] text-[var(--text-muted)]">· {presets.length}</span>
              <div className="ml-1 h-px flex-1 bg-[var(--border-secondary)]" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {presets.map(({ id, preset }) => (
                <PresetCard
                  key={id}
                  ref={(el): void => {
                    cardRefs.current[id] = el;
                  }}
                  preset={preset}
                  selected={value === id}
                  onClick={(): void => onChange(id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Selecting a preset fills all colors below. Tweak individual colors to customize.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface PresetCardProps {
  preset: PresetDefinition;
  selected: boolean;
  onClick: () => void;
}

/**
 * Single preset card. Preview band shows the preset's actual color
 * relationships (bg + footer band + accent stripe for solids; the full
 * gradient for gradient presets).
 */
const PresetCard = forwardRef<HTMLButtonElement, PresetCardProps>(function PresetCard(
  { preset, selected, onClick },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={preset.subtitle}
      className={`group relative overflow-hidden rounded-md border text-left transition-all motion-safe:hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-cyan focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)] ${
        selected
          ? "border-cyan ring-2 ring-cyan/40"
          : "border-[var(--border-secondary)] hover:border-[var(--border-primary)]"
      }`}
    >
      <PresetPreviewBand preset={preset} />
      <div className="flex items-center justify-between gap-1.5 px-2 py-1.5">
        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
          {preset.name}
        </span>
        {selected && <CheckBadge />}
      </div>
    </button>
  );
});

/**
 * Compact preview band (~36px). For solid presets: page bg fills the band,
 * a 4px accent stripe sits above an 8px footer-bg band — visualizes the
 * three primary surfaces (page / accent / footer) in one element. For
 * gradient presets: the band IS the footer gradient, full bleed — closest
 * single-rect representation of what makes the preset distinct.
 */
function PresetPreviewBand({ preset }: { preset: PresetDefinition }): React.ReactElement {
  const isGradient = preset.tier === "gradient";
  const headerGradient = preset.gradients?.header_bg_gradient;
  const footerGradient = preset.gradients?.footer_bg_gradient;
  const heroGradient = preset.gradients?.hero_overlay_gradient;
  const bg = preset.colors.background;
  const footerBg = preset.colors.footer_bg;
  const accent = preset.colors.accent;
  const primary = preset.colors.primary;

  // Gradient presets: show the header gradient full-bleed — it's what the user
  // sees first on the live site, so it's the most honest preview.
  if (isGradient && (headerGradient || footerGradient || heroGradient)) {
    return (
      <div
        className="h-9 w-full"
        style={{ background: headerGradient ?? footerGradient ?? heroGradient }}
        aria-hidden="true"
      />
    );
  }

  // Solid presets: layered preview. Top = page bg, then primary (header) stripe,
  // accent stripe, footer band — reads like a tiny scrolled page section.
  return (
    <div
      className="relative h-9 w-full overflow-hidden"
      style={{ background: bg }}
      aria-hidden="true"
    >
      {/* Primary (header) band — top 4px */}
      <div
        className="absolute left-0 top-0 h-1 w-full"
        style={{ background: primary }}
      />
      {/* Accent stripe — 3px above footer band */}
      <div
        className="absolute bottom-2 left-0 h-[3px] w-full"
        style={{ background: accent }}
      />
      {/* Footer band — bottom 8px */}
      <div
        className="absolute bottom-0 left-0 h-2 w-full"
        style={{ background: footerBg }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline — dashboard convention)
// ---------------------------------------------------------------------------

function CheckBadge(): React.ReactElement {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan text-white">
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
        <path
          fillRule="evenodd"
          d="M16.704 5.296a1 1 0 010 1.414l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 011.414-1.414L8.5 12.086l6.79-6.79a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function SparklesIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 text-cyan"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6L12 3z" />
    </svg>
  );
}

function DiceIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="16" cy="8" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="8" cy="16" r="1" fill="currentColor" />
      <circle cx="16" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}
