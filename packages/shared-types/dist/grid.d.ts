/** Story text mode for a Grid site's story pages (network stories). */
export type GridStoryMode = "excerpt" | "ai_summary";
/** Story text mode for Content Aggregator (external) stories. */
export type GridExternalStoryMode = "what_it_covers" | "ai_summary";
/** A topic pill as written in config. */
export interface GridTopic {
    label: string;
    /** Optional URL slug; derived from label when absent. */
    slug?: string;
    /** Vertical names (dashboard-index `vertical`) whose sites feed this pill. */
    verticals: string[];
    /** Content Aggregator bundle ids whose stories feed this pill. */
    bundles?: string[];
}
/** A topic pill after normalisation (slug always present, unique). */
export interface ResolvedGridTopic {
    label: string;
    slug: string;
    verticals: string[];
    bundles: string[];
}
/** A story pinned to the top of a Grid feed. */
export interface GridPin {
    site: string;
    slug: string;
    /** Inclusive expiry date, YYYY-MM-DD. */
    until?: string | null;
}
/** `grid` config section as written in org/group/override/site YAML. */
export interface GridConfig {
    topics?: GridTopic[];
    include_sites?: string[];
    exclude_sites?: string[];
    per_site_limit?: number;
    max_age_days?: number | null;
    story_mode?: GridStoryMode;
    excerpt_paragraphs?: number;
    feed_ad_every?: number;
    page_size?: number;
    show_intro?: boolean;
    outbound_utm?: boolean;
    pinned?: GridPin[];
    external_story_mode?: GridExternalStoryMode;
    /** Aggregator source names never shown on this site (case-insensitive). */
    blocked_sources?: string[];
    per_bundle_limit?: number;
}
/** Fully-resolved `grid` section (every field present). */
export interface ResolvedGridConfig {
    topics: ResolvedGridTopic[];
    include_sites: string[];
    exclude_sites: string[];
    per_site_limit: number;
    max_age_days: number | null;
    story_mode: GridStoryMode;
    excerpt_paragraphs: number;
    feed_ad_every: number;
    page_size: number;
    show_intro: boolean;
    outbound_utm: boolean;
    pinned: GridPin[];
    external_story_mode: GridExternalStoryMode;
    blocked_sources: string[];
    per_bundle_limit: number;
}
/** Allowed values for each card-look option (single source for validation + dashboard). */
export declare const GRID_CARD_OPTIONS: {
    readonly style: readonly ["bordered", "shadow", "flat"];
    readonly corners: readonly ["square", "small", "rounded"];
    readonly image_ratio: readonly ["4:3", "16:9", "1:1"];
    readonly image_position: readonly ["top", "left"];
    readonly density: readonly ["comfortable", "compact"];
    readonly source_position: readonly ["below", "badge"];
};
/** `theme.card` as written in YAML. Read only by the Grid template. */
export interface GridCardConfig {
    style?: (typeof GRID_CARD_OPTIONS.style)[number];
    corners?: (typeof GRID_CARD_OPTIONS.corners)[number];
    image_ratio?: (typeof GRID_CARD_OPTIONS.image_ratio)[number];
    image_position?: (typeof GRID_CARD_OPTIONS.image_position)[number];
    density?: (typeof GRID_CARD_OPTIONS.density)[number];
    source_position?: (typeof GRID_CARD_OPTIONS.source_position)[number];
}
/** Fully-resolved card look. */
export type ResolvedGridCardConfig = Required<GridCardConfig>;
/** Seed-time and runtime defaults for `grid`. */
export declare const GRID_DEFAULTS: ResolvedGridConfig;
/** Seed-time and runtime defaults for `theme.card` (dazzr-like). */
export declare const GRID_CARD_DEFAULTS: ResolvedGridCardConfig;
/** One site in the `network-directory` KV key. */
export interface NetworkDirectorySite {
    siteId: string;
    hostname: string;
    name: string;
    favicon: string | null;
    vertical: string;
    status: string;
    isGrid: boolean;
    account: "assets" | "dev1";
}
/** Value of the `network-directory` KV key (written by scripts/seed-grid.ts). */
export interface NetworkDirectory {
    generatedAt: string;
    sites: NetworkDirectorySite[];
}
/** Value of `grid-summary:<siteId>:<slug>` (written by scripts/seed-grid.ts). */
export interface GridSummaryRecord {
    /** Sanitised HTML rendered from the summary markdown at sync time. */
    html: string;
    bodyHash: string;
    generatedAt: string;
    model: string;
    edited: boolean;
    sourceChanged: boolean;
    /** Shown on the story page regardless of the site's story mode. */
    pinned?: boolean;
}
/** Summary state shown in the dashboard Stories tab. */
export type GridSummaryStatus = "none" | "generated" | "edited" | "stale";
/** Why a directory site is not a source. */
export type GridExclusionReason = "self" | "grid_site" | "not_live" | "dev1_account" | "excluded" | "no_matching_vertical" | "missing_index";
/** One row of source resolution, returned by GET /api/pool. */
export interface GridSourceStatus {
    siteId: string;
    included: boolean;
    reason?: GridExclusionReason;
    /** Pill slugs this site feeds (empty = "All" only). */
    pills: string[];
}
/** One story in a Grid pool. */
export interface GridPoolItem {
    site: string;
    slug: string;
    title: string;
    publishDate: string;
    featuredImage?: string;
    description?: string;
    pills: string[];
    pinned: boolean;
    /** Absent on network stories; "external" for Content Aggregator stories. */
    kind?: "network" | "external";
    /** Publisher name for external stories. */
    sourceName?: string;
    /** Present only when /api/pool is called with `summaries=1`. */
    summary?: {
        status: GridSummaryStatus;
        generatedAt?: string;
        pinned?: boolean;
    };
}
/** A configured pin that is not currently shown. */
export interface GridInactivePin extends GridPin {
    reason: "expired" | "not_source" | "not_published";
}
/** Response of GET /api/pool on a Grid site. */
export interface GridPoolResponse {
    siteId: string;
    generatedAt: string;
    storyMode: GridStoryMode;
    perSiteLimit: number;
    directoryGeneratedAt: string | null;
    sources: GridSourceStatus[];
    items: GridPoolItem[];
    inactivePins: GridInactivePin[];
}
/** One Content Aggregator story (`grid-ext-item:<id>`, written by scripts/seed-grid.ts, permanent). */
export interface ExternalStoryRecord {
    id: string;
    slug: string;
    title: string;
    description: string;
    imageUrl: string;
    /** Publisher URL ("Read full story"). */
    url: string;
    sourceName: string;
    author: string | null;
    publishedAt: string;
    categories: string[];
    tags: string[];
    whatItCovers: string;
    whyItMatters: string;
    syncedAt: string;
}
/** Feed fields of an external story (one entry of `grid-ext-index:<bundleId>`). */
export interface ExternalIndexEntry {
    id: string;
    slug: string;
    title: string;
    description: string;
    imageUrl: string;
    sourceName: string;
    publishedAt: string;
}
/** Value of `grid-ext-index:<bundleId>` — newest first, max 300 (written by scripts/seed-grid.ts). */
export interface ExternalBundleIndex {
    bundleId: string;
    name: string;
    updatedAt: string;
    items: ExternalIndexEntry[];
}
//# sourceMappingURL=grid.d.ts.map