/**
 * Save helpers for the site Config tab.
 *
 * The tab only sends sections that changed since load, so untouched sections
 * never shadow values inherited from org/group/override layers.
 */

/** Config tab sections that are saved to site.yaml. */
export const SAVED_SECTIONS = ["tracking", "scripts", "scripts_vars", "ads_config", "ads_txt", "legal", "consent"] as const;

export type SavedSection = (typeof SAVED_SECTIONS)[number];

/** JSON snapshot of each saved section, taken on load and after a successful save. */
export type SectionSnapshots = Partial<Record<SavedSection, string>>;

/** Snapshots every saved section of the form value. */
export function snapshotSections(form: Partial<Record<SavedSection, unknown>>): SectionSnapshots {
  const out: SectionSnapshots = {};
  for (const key of SAVED_SECTIONS) out[key] = JSON.stringify(form[key]);
  return out;
}

/** Returns only the sections whose value differs from its snapshot. */
export function collectChangedSections(
  form: Partial<Record<SavedSection, unknown>>,
  initial: SectionSnapshots,
): Partial<Record<SavedSection, unknown>> {
  const changed: Partial<Record<SavedSection, unknown>> = {};
  for (const key of SAVED_SECTIONS) {
    if (JSON.stringify(form[key]) === initial[key]) continue;
    // A consent section reset to "inherit" is undefined, which JSON drops — send null so the
    // save route removes the site's block.
    changed[key] = key === "consent" && form[key] === undefined ? null : form[key];
  }
  return changed;
}

/**
 * Writes `ads_txt` / `legal` from a save request into the parsed site.yaml.
 * An empty value removes the key, so org/group entries keep applying
 * (ads.txt is additive and legal deep-merges at seed time).
 */
export function applyAdsTxtAndLegal(
  site: Record<string, unknown>,
  updates: { ads_txt?: string[]; legal?: Record<string, string> },
): void {
  if (updates.ads_txt !== undefined) {
    const lines = [...new Set(updates.ads_txt.map((l) => l.trim()).filter(Boolean))];
    if (lines.length > 0) site.ads_txt = lines;
    else delete site.ads_txt;
  }
  if (updates.legal !== undefined) {
    const legal = Object.fromEntries(
      Object.entries(updates.legal).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
    );
    if (Object.keys(legal).length > 0) site.legal = legal;
    else delete site.legal;
  }
}

/**
 * Writes the `consent` block from a save request into the parsed site.yaml.
 * Absent = untouched; null or an empty object removes the block (the site inherits).
 */
export function applyConsent(
  site: Record<string, unknown>,
  updates: { consent?: Record<string, unknown> | null },
): void {
  if (updates.consent === undefined) return;
  if (updates.consent === null || Object.keys(updates.consent).length === 0) {
    delete site.consent;
    return;
  }
  site.consent = updates.consent;
}
