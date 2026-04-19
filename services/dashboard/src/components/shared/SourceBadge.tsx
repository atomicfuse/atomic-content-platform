"use client";

/**
 * SourceBadge — a small inline label that tells the user where a config
 * value originates from in the merge chain (org → groups → override → site).
 * Used throughout dashboard forms to make inheritance explicit.
 */

export type SourceLayer = "org" | "group" | "override" | "site" | "custom";

interface SourceBadgeProps {
  source: SourceLayer;
  /** Optional id/name for the layer (e.g. group id, override id). */
  label?: string;
  className?: string;
}

const STYLES: Record<SourceLayer, { bg: string; text: string; ring: string; default: string }> = {
  org: {
    bg: "bg-cyan/10",
    text: "text-cyan",
    ring: "ring-cyan/20",
    default: "From org",
  },
  group: {
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    ring: "ring-violet-500/20",
    default: "From group",
  },
  override: {
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    ring: "ring-amber-500/20",
    default: "From override",
  },
  site: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    ring: "ring-emerald-500/20",
    default: "Site override",
  },
  custom: {
    bg: "bg-[var(--bg-elevated)]",
    text: "text-[var(--text-secondary)]",
    ring: "ring-[var(--border-primary)]",
    default: "Custom",
  },
};

export function SourceBadge({
  source,
  label,
  className = "",
}: SourceBadgeProps): React.ReactElement {
  const style = STYLES[source];
  const text = label ? `${style.default}: ${label}` : style.default;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${style.bg} ${style.text} ${style.ring} ${className}`}
    >
      {text}
    </span>
  );
}
