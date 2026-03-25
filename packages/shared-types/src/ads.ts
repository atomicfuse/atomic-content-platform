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
   * Common values: "above-content", "after-paragraph-3", "sidebar", "sticky-bottom".
   */
  position: string;

  /** Available ad sizes per device class. */
  sizes: AdPlacementSizes;

  /** Which devices this placement targets. */
  device: "all" | "desktop" | "mobile";
}

/**
 * Full advertising configuration for a site or group.
 */
export interface AdsConfig {
  /** Name or identifier of the primary ad network / advertiser. */
  primary_advertiser?: string;

  /** Whether interstitial (full-page) ads are enabled. */
  interstitial: boolean;

  /** Layout strategy identifier (e.g. "standard", "aggressive"). */
  layout: string;

  /** Number of in-content ad slots to insert between paragraphs. */
  in_content_slots?: number;

  /** Whether to show sidebar ad placements. */
  sidebar?: boolean;

  /** Ordered list of ad placement definitions. */
  ad_placements: AdPlacement[];

  /** Lines to include in the site's ads.txt file. */
  ads_txt: string[];
}
