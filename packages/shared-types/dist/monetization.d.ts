/**
 * Monetization layer types — separates ad operations from editorial/content
 * concerns. A monetization profile defines tracking, scripts, ad placements,
 * and ads.txt entries. Sites reference a profile via `monetization: <id>` in
 * their site.yaml.
 *
 * Merge order: org → monetization → group → site.
 */
import type { TrackingConfig } from "./tracking.js";
import type { AdsConfig } from "./ads.js";
import type { ScriptsConfig } from "./config.js";
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
 * A standalone monetization profile, stored at `monetization/<id>.yaml` in the
 * network repo. Multiple sites can share one profile. Profiles hold everything
 * related to making money (ads, tracking, scripts) but nothing about the
 * site's identity, theme, or editorial brief.
 */
export interface MonetizationConfig {
    /** Unique identifier, matches the filename (kebab-case). */
    monetization_id: string;
    /** Human-readable name shown in the dashboard. */
    name: string;
    /** Ad provider identifier (e.g. "network-alpha", "taboola", "adsense"). */
    provider: string;
    /** Profile-level tracking overrides — layer between org and group. */
    tracking?: Partial<TrackingConfig>;
    /** Profile-level scripts — merged by `id` into the resolved script list. */
    scripts?: Partial<ScriptsConfig>;
    /** Profile-level script variable substitutions. */
    scripts_vars?: Record<string, string>;
    /** Profile-level ad configuration (placements, interstitial, layout). */
    ads_config?: Partial<AdsConfig>;
    /** Profile-level ads.txt entries. Accumulated with other layers. */
    ads_txt?: string[];
}
/**
 * The JSON document served from CDN at `https://cdn.<network>/m/<domain>.json`.
 * Consumed by `ad-loader.js` at runtime to inject ad containers dynamically
 * without rebuilding the site.
 *
 * Produced by resolving: org → monetization → site (the group layer is skipped
 * because groups don't typically touch monetization fields).
 */
export interface MonetizationJson {
    /** Site domain this JSON belongs to. */
    domain: string;
    /** Monetization profile id used for this site. */
    monetization_id: string;
    /** Fully-resolved tracking config. */
    tracking: TrackingConfig;
    /** Fully-resolved scripts config. */
    scripts: ScriptsConfig;
    /** Fully-resolved ads config (contains ad_placements for runtime injection). */
    ads_config: AdsConfig;
    /** ISO-8601 timestamp of when this JSON was generated. */
    generated_at: string;
}
//# sourceMappingURL=monetization.d.ts.map