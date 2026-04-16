/**
 * Override and ad-placeholder types.
 *
 * The former MonetizationConfig / MonetizationJson interfaces have been
 * replaced by the unified groups + overrides architecture. Groups now carry
 * all config (tracking, scripts, ads, theme, legal) and overrides provide
 * targeted exceptions with REPLACE semantics.
 */
import type { TrackingConfig } from "./tracking.js";
import type { AdsConfig } from "./ads.js";
import type { ScriptsConfig, ThemeConfig, DeepPartial } from "./config.js";
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
 * A targeted config override with REPLACE semantics.
 * Stored at `overrides/config/<id>.yaml` in the network repo.
 *
 * Override resolution:
 * - If an override defines a field (e.g. ads_config), it COMPLETELY REPLACES
 *   that field from the group merge chain.
 * - Fields NOT defined in the override pass through from the group chain.
 * - When multiple overrides target a site, they apply in priority order
 *   (lowest first, highest last = highest wins).
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
    /** Override tracking fields (REPLACE semantics at field level within tracking). */
    tracking?: Partial<TrackingConfig>;
    /** Override scripts (REPLACE semantics — replaces entire head/body_start/body_end arrays). */
    scripts?: Partial<ScriptsConfig>;
    /** Override script variable substitutions. */
    scripts_vars?: Record<string, string>;
    /** Override ad configuration (REPLACE semantics — replaces entire ads_config). */
    ads_config?: Partial<AdsConfig>;
    /** Override ads.txt entries (REPLACE semantics — replaces, not additive). */
    ads_txt?: string[];
    /** Override theme fields. */
    theme?: DeepPartial<ThemeConfig>;
    /** Override legal page content. */
    legal?: Record<string, string>;
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
//# sourceMappingURL=monetization.d.ts.map