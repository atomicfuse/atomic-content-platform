/**
 * Resolves the header/footer background colours a generated logo should be
 * designed against, based on the site's template.
 *
 * Modern sites paint their header with `theme.colors.primary` — the logo must
 * contrast against that. Grid sites paint their header with `theme.colors.surface`
 * (see site-worker `grid.css`: `.g-header { background: var(--g-surface) }`), so a
 * logo generated against `primary` would be invisible against the actual Grid
 * header. Footer background is the same for both templates.
 */
export function logoBackgroundFor(
  template: "modern" | "grid" | undefined,
  colors: Record<string, string> | undefined,
): { header: string; footer: string | undefined } {
  const header =
    template === "grid"
      ? (colors?.surface ?? "#ffffff")
      : (colors?.primary ?? "#1a1a2e");
  return { header, footer: colors?.footer_bg };
}
