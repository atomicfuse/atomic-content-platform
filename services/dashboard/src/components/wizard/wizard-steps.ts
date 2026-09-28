/** New-site wizard step lists, chosen by template in `app/wizard/page.tsx`. */

/** Modern: the full content-agent flow. */
export const MODERN_STEPS = [
  "Create Site",
  "Content Brief",
  "Topic Filters",
  "Groups",
  "Theme",
  "Preview",
  "Review",
] as const;

/** Grid: no article generation, so the content steps are replaced by the feed setup. */
export const GRID_STEPS = ["Create Site", "Grid Feed", "Groups", "Theme", "Preview", "Review"] as const;

export type WizardStepName = (typeof MODERN_STEPS)[number] | (typeof GRID_STEPS)[number];

/** The step list for a wizard template (Modern when unset). */
export function wizardStepsFor(template: "modern" | "grid" | undefined): readonly WizardStepName[] {
  return template === "grid" ? GRID_STEPS : MODERN_STEPS;
}
