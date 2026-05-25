/**
 * An external or inline script to inject into the page.
 */
export interface ScriptEntry {
  /** Unique identifier for this script entry. */
  id: string;

  /** URL of an external script to load. Mutually exclusive with `inline`. */
  src?: string;

  /** Inline JavaScript code. Mutually exclusive with `src`. */
  inline?: string;

  /** Whether the external script should use the `async` attribute. */
  async?: boolean;
}

/**
 * Size pairs available for an ad placement, keyed by device class.
 * Each entry is a [width, height] tuple.
 */
export interface AdPlacementSizes {
  /** Desktop ad sizes (e.g. [[728, 90], [970, 250]]). */
  desktop?: number[][];

  /** Mobile ad sizes (e.g. [[320, 50], [300, 250]]). */
  mobile?: number[][];
}

/**
 * A single ad slot definition with placement and sizing rules.
 */
export interface AdPlacement {
  /** Unique identifier for this ad slot. */
  id: string;

  /**
   * Where the ad appears in the page layout.
   *
   * Article pages:
   *   "above-content"      — before article body
   *   "after-paragraph-N"  — after Nth paragraph in article body
   *   "sidebar"            — sidebar column (desktop)
   *   "sticky-bottom"      — fixed bottom of viewport
   *   "below-content"      — after main content, before footer
   *
   * Homepage:
   *   "homepage-top"       — above the article grid
   *   "homepage-mid"       — between article card rows
   *
   * Category pages:
   *   "category-top"       — above the category article list
   *
   * Shared pages (about, privacy, terms, contact, DMCA):
   *   "above-content", "sidebar", "below-content", "sticky-bottom",
   *   "after-paragraph-N" all work on shared pages too.
   */
  position: string;

  /** Available ad sizes per device class. */
  sizes: AdPlacementSizes;

  /** Which devices this placement targets. */
  device: "all" | "desktop" | "mobile";

  /** Whether visitors can dismiss this ad. Only meaningful for sticky-bottom. Default: true. */
  dismissible?: boolean;

  /**
   * Raw HTML/JS widget code to inject inside the ad slot container.
   * Users can paste ad network widget code as-is (including `<div>` and
   * `<script>` tags). Rendered server-side inside the ad slot position
   * so the widget appears in the correct layout location.
   */
  code?: string;

  /** Which page types this placement appears on. Default: ["all"]. */
  page_types?: InterstitialPageType[];

  /** Page types to exclude this placement from (overrides page_types). */
  exclude_pages?: InterstitialExcludePage[];
}

/**
 * Trigger configuration for interstitial ads.
 */
export interface InterstitialTrigger {
  /** How the interstitial is triggered. */
  type: "delay" | "scroll" | "exit_intent";

  /** Seconds to wait before showing (only for type "delay"). */
  delay_seconds?: number;

  /** Scroll depth percentage to trigger at (only for type "scroll"). */
  scroll_percent?: number;
}

/**
 * Frequency cap for interstitial ads.
 */
export interface InterstitialFrequency {
  /** Frequency cap strategy. */
  type: "once_per_session" | "once_per_day" | "custom";

  /** Max times to show per session (only for type "custom"). */
  max_per_session?: number;
}

/** Page types where interstitial ads can appear. */
export type InterstitialPageType = "all" | "article" | "category" | "homepage";

/**
 * Full interstitial ad configuration.
 * The `script_url` is the external ad-network script that handles rendering
 * the interstitial overlay. The wrapper injects it after trigger/frequency
 * checks pass.
 */
export interface InterstitialConfig {
  /** URL of the ad-network script to load. Mutually exclusive with `script_inline`. */
  script_url: string;

  /** Inline JavaScript code for the interstitial. Mutually exclusive with `script_url`. */
  script_inline?: string;

  /** When to trigger the interstitial. */
  trigger: InterstitialTrigger;

  /** How often to show the interstitial. */
  frequency: InterstitialFrequency;

  /** Which page types the interstitial appears on. */
  page_types: InterstitialPageType[];

  /** Seconds the close button is disabled (countdown). Default: 3. */
  close_delay_seconds?: number;

  /** Which devices the interstitial appears on. Default: "both". */
  device?: "both" | "desktop" | "mobile";

  /** Page types to exclude the interstitial from (overrides page_types). */
  exclude_pages?: InterstitialExcludePage[];
}

/** Page types/slugs that can be excluded from interstitial display. */
export type InterstitialExcludePage =
  | "homepage" | "articles" | "categories"
  | "about" | "contact" | "privacy" | "terms" | "dmca" | "amazon";

/**
 * Full advertising configuration for a site or group.
 *
 * Merge rules:
 * - Standard merge (org → groups → site): deep merge, but `ad_placements`
 *   uses REPLACEMENT — if child defines ad_placements, replaces parent entirely.
 * - Override merge: ENTIRE ads_config replaced if override defines it.
 */
export interface AdsConfig {
  /** Whether interstitial (full-page) ads are enabled. */
  interstitial: boolean;

  /** Interstitial ad configuration (script, trigger, frequency, page types). */
  interstitial_config?: InterstitialConfig;

  /** Layout density identifier ("standard" | "high-density"). */
  layout: string;

  /** Ordered list of ad placement definitions. */
  ad_placements: AdPlacement[];
}
