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
    /** URL of the ad-network script to load. */
    script_url: string;
    /** When to trigger the interstitial. */
    trigger: InterstitialTrigger;
    /** How often to show the interstitial. */
    frequency: InterstitialFrequency;
    /** Which page types the interstitial appears on. */
    page_types: InterstitialPageType[];
}
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
//# sourceMappingURL=ads.d.ts.map