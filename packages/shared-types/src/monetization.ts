/**
 * Override and ad-placeholder types.
 *
 * The former MonetizationConfig / MonetizationJson interfaces have been
 * replaced by the unified groups + overrides architecture. Groups now carry
 * all config (tracking, scripts, ads, theme, legal) and overrides provide
 * targeted exceptions with per-field merge mode control.
 */

import type { TrackingConfig } from "./tracking.js";
import type { AdsConfig } from "./ads.js";
import type { ScriptsConfig, ThemeConfig, DeepPartial } from "./config.js";

// ---------------------------------------------------------------------------
// Merge mode types
// ---------------------------------------------------------------------------

/** Merge modes for tracking, scripts_vars, theme, legal fields. */
export type SimpleMergeMode = "merge" | "replace";

/** Merge modes for the scripts field. */
export type ScriptsMergeMode = "merge_by_id" | "replace";

/** Merge modes for the ads_config field. */
export type AdsConfigMergeMode = "add" | "replace" | "merge_placements";

/** Merge modes for the ads_txt field. */
export type AdsTxtMergeMode = "add" | "replace";

/** Union of all merge modes. */
export type MergeMode =
  | SimpleMergeMode
  | ScriptsMergeMode
  | AdsConfigMergeMode
  | AdsTxtMergeMode;

/**
 * Placeholder heights used for CLS (Cumulative Layout Shift) prevention at
 * build time. The static HTML reserves vertical space at these positions so
 * that runtime ad injection does not cause layout shift.
 */
export interface AdPlaceholderHeights {
  "above-content": number;
  "after-paragraph": number;
  sidebar: number;
  "sticky-bottom": number;
}

/**
 * A targeted config override with per-field merge mode control.
 * Stored at `overrides/config/<id>.yaml` in the network repo.
 *
 * Override resolution:
 * - Each field can declare a `_mode` that controls how it combines with the
 *   group merge chain. When `_mode` is absent, the field's default mode is used.
 * - Fields NOT defined in the override pass through from the group chain.
 * - When multiple overrides target a site, they apply in priority order
 *   (lowest first, highest last = highest wins).
 *
 * Default modes:
 *   tracking     → merge          (deep merge, only specified keys change)
 *   scripts      → merge_by_id    (merge by script id, like group chain)
 *   scripts_vars → merge          (shallow merge, keys combined)
 *   ads_config   → replace        (full replacement)
 *   ads_txt      → add            (additive, entries appended)
 *   theme        → merge          (deep merge colors/fonts)
 *   legal        → merge          (shallow merge keys)
 *
 * Targeting: a site is affected if it appears in `targets.sites` OR belongs
 * to any group listed in `targets.groups` (union, not intersection).
 */
export interface OverrideConfig {
  /** Unique identifier, matches the filename (kebab-case). */
  override_id: string;

  /** Human-readable name shown in the dashboard. */
  name: string;

  /** Priority for ordering — higher number = applied later = wins conflicts. */
  priority: number;

  /** Which sites/groups this override targets. */
  targets: {
    /** All sites in these groups receive this override. */
    groups?: string[];
    /** These specific sites receive this override. */
    sites?: string[];
  };

  /**
   * Override tracking fields.
   * Default mode: `merge` — only specified keys replace parent values.
   * Use `_mode: "replace"` to wipe the group chain's tracking entirely.
   */
  tracking?: Partial<TrackingConfig> & { _mode?: SimpleMergeMode };

  /**
   * Override scripts.
   * Default mode: `merge_by_id` — merge by script id (same id = replace, new id = append).
   * Use `_mode: "append"` to add without replacing existing scripts.
   * Use `_mode: "replace"` to wipe the group chain's scripts entirely.
   */
  scripts?: Partial<ScriptsConfig> & { _mode?: ScriptsMergeMode };

  /**
   * Override script variable substitutions.
   * Default mode: `merge` — keys are merged with existing vars.
   * Use `_mode: "replace"` to wipe the group chain's vars entirely.
   */
  scripts_vars?: Record<string, string> & { _mode?: SimpleMergeMode };

  /**
   * Override ad configuration.
   * Default mode: `replace` — replaces entire ads_config.
   * Use `_mode: "merge_placements"` to add/update individual placements by id.
   */
  ads_config?: Partial<AdsConfig> & { _mode?: AdsConfigMergeMode };

  /**
   * Override ads.txt entries.
   * Default mode: `add` — entries appended to the accumulated list.
   * Use `_mode: "replace"` to wipe the group chain's entries entirely.
   *
   * When the value is a plain array (no _mode), it's treated as `add`.
   * When the value is an object with `_mode` and `_values`, the mode is used.
   */
  ads_txt?: string[] | { _mode: AdsTxtMergeMode; _values: string[] };

  /**
   * Override theme fields.
   * Default mode: `merge` — deep merge colors/fonts/etc.
   * Use `_mode: "replace"` to wipe the group chain's theme entirely.
   */
  theme?: DeepPartial<ThemeConfig> & { _mode?: SimpleMergeMode };

  /**
   * Override legal page content.
   * Default mode: `merge` — keys are merged with existing legal vars.
   * Use `_mode: "replace"` to wipe the group chain's legal entirely.
   */
  legal?: Record<string, string> & { _mode?: SimpleMergeMode };

  /** Override legal page paths. */
  legal_pages_override?: Record<string, string>;
}

/**
 * The inline config JSON embedded in the HTML at build time as
 * `window.__ATL_CONFIG__`. Read by ad-loader.js at runtime to inject
 * ad containers without a CDN round-trip.
 */
export interface InlineAdConfig {
  /** Site domain this config belongs to. */
  domain: string;

  /** Group IDs this site uses. */
  groups: string[];

  /** Override IDs that were applied during resolution. */
  applied_overrides: string[];

  /** Fully-resolved tracking config. */
  tracking: TrackingConfig;

  /** Fully-resolved scripts config. */
  scripts: ScriptsConfig;

  /** Fully-resolved ads config. */
  ads_config: AdsConfig;

  /** ISO-8601 timestamp of when this config was generated. */
  generated_at: string;
}
