/**
 * Grid template types — mirrors packages/shared-types/src/grid.ts.
 * The dashboard does not depend on @atomic-platform/shared-types; keep both in sync.
 */
export type GridStoryMode = "excerpt" | "ai_summary";
export interface GridTopicFields { label: string; slug?: string; verticals: string[] }
export interface GridPinFields { site: string; slug: string; until?: string | null }
export interface GridFields {
  topics?: GridTopicFields[];
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
  pinned?: GridPinFields[];
}
export const GRID_CARD_OPTIONS = {
  style: ["bordered", "shadow", "flat"],
  corners: ["square", "small", "rounded"],
  image_ratio: ["4:3", "16:9", "1:1"],
  image_position: ["top", "left"],
  density: ["comfortable", "compact"],
  source_position: ["below", "badge"],
} as const;
export interface GridCardFields {
  style?: (typeof GRID_CARD_OPTIONS.style)[number];
  corners?: (typeof GRID_CARD_OPTIONS.corners)[number];
  image_ratio?: (typeof GRID_CARD_OPTIONS.image_ratio)[number];
  image_position?: (typeof GRID_CARD_OPTIONS.image_position)[number];
  density?: (typeof GRID_CARD_OPTIONS.density)[number];
  source_position?: (typeof GRID_CARD_OPTIONS.source_position)[number];
}
export const GRID_CARD_DEFAULTS: Required<GridCardFields> = {
  style: "bordered", corners: "rounded", image_ratio: "4:3", image_position: "top", density: "comfortable", source_position: "below",
};
/** Colour keys only the Grid template reads (never part of themePresets ColorState). */
export const GRID_ONLY_COLOR_KEYS = ["card_bg", "card_border", "pill_border", "pill_active_bg", "pill_active_text", "search_bg"] as const;
/** Grid colour editor layout: [key, label, inherits-from label | null]. Spec "Theming → Colours". */
export const GRID_COLOR_GROUPS: ReadonlyArray<{ title: string; fields: ReadonlyArray<readonly [string, string, string | null]> }> = [
  { title: "Page & cards", fields: [["background", "Page background", null], ["surface", "Surface", null], ["card_bg", "Card background", "Surface"], ["border", "Borders", null], ["card_border", "Card border", "Borders"]] },
  { title: "Text", fields: [["text", "Body text", null], ["muted", "Meta text (source, age)", null], ["heading", "Headlines", null]] },
  { title: "Accent & links", fields: [["accent", "Accent (active pill, button)", null], ["link", "Links", null], ["link_hover", "Link hover", null]] },
  { title: "Pills & search", fields: [["nav_link", "Pill text", null], ["nav_link_hover", "Pill hover", null], ["pill_border", "Pill border", "Borders"], ["pill_active_bg", "Active pill background", "transparent"], ["pill_active_text", "Active pill text", "Accent"], ["search_bg", "Search bar", "Surface"]] },
  { title: "Story text", fields: [["prose_heading", "Story headings", null], ["prose_body", "Story body", null]] },
  { title: "Footer", fields: [["footer_bg", "Footer background", null], ["footer_text", "Footer text", null], ["footer_link", "Footer links", null], ["footer_link_hover", "Footer link hover", null]] },
];
export type GridSummaryStatus = "none" | "generated" | "edited" | "stale";
export interface GridPoolItem { site: string; slug: string; title: string; publishDate: string; featuredImage?: string; description?: string; pills: string[]; pinned: boolean; summary?: { status: GridSummaryStatus; generatedAt?: string } }
export interface GridSourceStatus { siteId: string; included: boolean; reason?: "self" | "grid_site" | "not_live" | "dev1_account" | "excluded" | "no_matching_vertical" | "missing_index"; pills: string[] }
export interface GridInactivePin extends GridPinFields { reason: "expired" | "not_source" | "not_published" }
export interface GridPoolResponse { siteId: string; generatedAt: string; storyMode: GridStoryMode; perSiteLimit: number; directoryGeneratedAt: string | null; sources: GridSourceStatus[]; items: GridPoolItem[]; inactivePins: GridInactivePin[] }
/** A site option for pickers (from /api/sites/list). */
export interface SiteOption { domain: string; status: string; vertical: string }
