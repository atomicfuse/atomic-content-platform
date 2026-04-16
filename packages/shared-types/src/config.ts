import type { TrackingConfig } from "./tracking.js";
import type { ScriptEntry, AdsConfig } from "./ads.js";
import type { AdPlaceholderHeights, InlineAdConfig } from "./monetization.js";

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

/**
 * Per-criterion weight configuration for the content quality agent.
 * Values should sum to 100. Defaults to 20 each when not configured.
 */
export interface QualityWeights {
  seo_quality?: number;
  tone_match?: number;
  content_length?: number;
  factual_accuracy?: number;
  keyword_relevance?: number;
}

// ---------------------------------------------------------------------------
// Site brief
// ---------------------------------------------------------------------------

/**
 * Publishing schedule for a site.
 */
export interface PublishSchedule {
  /**
   * Target number of articles to publish on each matching day. Takes priority
   * over `articles_per_week` when present.
   */
  articles_per_day?: number;

  /**
   * Legacy field — target number of articles per week. Still read as a
   * fallback: `articles_per_day ?? ceil(articles_per_week / preferred_days.length)`.
   * New sites write `articles_per_day` only.
   */
  articles_per_week?: number;

  /** Preferred days of the week to publish (e.g. ["Monday", "Wednesday"]). */
  preferred_days: string[];

  /** Preferred time of day to publish (e.g. "09:00"). */
  preferred_time: string;
}

/**
 * Editorial brief that drives content generation for a site.
 */
export interface SiteBrief {
  /** Target audience description. */
  audience: string;

  /** Desired writing tone (e.g. "professional", "conversational"). */
  tone: string;

  /**
   * Article type distribution as a percentage map.
   * Keys are article type names; values are target percentages (0-100).
   */
  article_types: Record<string, number>;

  /** Topic areas this site covers. */
  topics: string[];

  /** Primary SEO keywords to target. */
  seo_keywords_focus: string[];

  /** Free-form editorial guidelines for content agents. */
  content_guidelines: string | string[];

  /** Percentage of articles that require human review before publishing. */
  review_percentage: number;

  /** Publishing cadence settings. */
  schedule: PublishSchedule;

  /** Content vertical for aggregator API queries. */
  vertical?: "Tech" | "Travel" | "News" | "Sport" | "Lifestyle" | "Entertainment" | "Food & Drink" | "Animals" | "Science";

  /** Target audience type for aggregator API queries. */
  audience_type?: "Young 18-24" | "Adult 25-44" | "Mature 45+" | "Parents" | "Professionals";

  /** Content language code (ISO 639-1). Defaults to "EN". */
  language?: string;

  /** Minimum quality score (0-100) for auto-publish. Default 75. */
  quality_threshold?: number;

  /** Per-criterion weight overrides for quality scoring. Must sum to 100. */
  quality_weights?: QualityWeights;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Visual theme configuration for a site.
 */
export interface ThemeConfig {
  /** Base theme template to extend. */
  base?: "modern" | "editorial" | "bold" | "classic";

  /** Named colour overrides (e.g. { primary: "#1a73e8", background: "#fff" }). */
  colors?: Record<string, string>;

  /** URL or path to the site logo. */
  logo?: string;

  /** URL or path to the site favicon. */
  favicon?: string;

  /** Font family overrides. */
  fonts?: {
    /** Font family for headings. */
    heading?: string;
    /** Font family for body text. */
    body?: string;
  };
}

/**
 * Fully-resolved theme where every field is required.
 * Produced after merging org -> group -> site layers.
 */
export interface ResolvedThemeConfig {
  /** Base theme template. */
  base: "modern" | "editorial" | "bold" | "classic";

  /** Named colour map. */
  colors: Record<string, string>;

  /** URL or path to the site logo. */
  logo: string;

  /** URL or path to the site favicon. */
  favicon: string;

  /** Font family settings. */
  fonts: {
    heading: string;
    body: string;
  };
}

// ---------------------------------------------------------------------------
// Preview page
// ---------------------------------------------------------------------------

/**
 * Configuration for the preview/intermediate article page.
 * When enabled, clicking an article shows an excerpt with a "Continue Reading"
 * button before the full article — doubling pageviews for ad monetization.
 */
export interface PreviewPageConfig {
  /** Whether preview pages are enabled. Default: false. */
  enabled: boolean;

  /** Number of paragraphs to auto-extract if no excerpt field exists. Default: 3. */
  excerpt_paragraphs: number;

  /** Text for the "Continue Reading" CTA button. Default: "Continue Reading". */
  cta_text: string;

  /** Whether to show ad slots on the preview page. Default: true. */
  show_ads: boolean;
}

// ---------------------------------------------------------------------------
// Category pages
// ---------------------------------------------------------------------------

/**
 * Configuration for category/archive pages.
 * Generates paginated pages at /category/{topic-slug}/ for each topic.
 */
export interface CategoryConfig {
  /** Whether category pages are enabled. Default: true. */
  enabled: boolean;

  /** Number of articles per page. Default: 12. */
  per_page: number;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * A widget displayed in the sidebar.
 */
export interface SidebarWidget {
  /** Widget type. */
  type: "search" | "recent_posts" | "categories" | "newsletter" | "ad";

  /** Whether this widget is enabled. Default: true. */
  enabled?: boolean;

  /** Widget-specific options (e.g. { count: 5 } for recent_posts). */
  options?: Record<string, unknown>;
}

/**
 * Configuration for the optional homepage/page sidebar.
 */
export interface SidebarConfig {
  /** Whether the sidebar is displayed. Default: false. */
  enabled: boolean;

  /** Ordered list of widgets to render. */
  widgets: SidebarWidget[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Configuration for site search powered by Pagefind.
 */
export interface SearchConfig {
  /** Whether search is enabled. Default: false. */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/**
 * Grouped script entries by injection position.
 */
export interface ScriptsConfig {
  /** Scripts injected into the document `<head>`. */
  head: ScriptEntry[];

  /** Scripts injected immediately after the opening `<body>` tag. */
  body_start: ScriptEntry[];

  /** Scripts injected just before the closing `</body>` tag. */
  body_end: ScriptEntry[];
}

// ---------------------------------------------------------------------------
// Org config (org.yaml)
// ---------------------------------------------------------------------------

/**
 * Organisation-level configuration — the root of the config hierarchy.
 * Defines defaults inherited by all groups and sites in the network.
 */
export interface OrgConfig {
  /** Display name of the organisation. */
  organization: string;

  /** Legal entity name used in policies and footers. */
  legal_entity: string;

  /** Registered company address. */
  company_address: string;

  /** Pattern for generating per-site support emails (e.g. "support@{{domain}}"). */
  support_email_pattern: string;

  /** Default base theme for all sites. */
  default_theme?: "modern" | "editorial";

  /** Default font families for all sites. */
  default_fonts?: {
    heading: string;
    body: string;
  };

  /**
   * Default group IDs applied to sites that don't specify their own `groups:`.
   * References files at `groups/<id>.yaml`.
   */
  default_groups?: string[];

  /** Organisation-wide tracking configuration. */
  tracking: TrackingConfig;

  /** Organisation-wide script injection configuration. */
  scripts: ScriptsConfig;

  /** Organisation-wide script variable substitutions. */
  scripts_vars?: Record<string, string>;

  /** Default advertising configuration. */
  ads_config: AdsConfig;

  /**
   * Placeholder heights used at build time for CLS prevention. Required so
   * the static HTML can reserve vertical space before runtime ad injection.
   */
  ad_placeholder_heights?: AdPlaceholderHeights;

  /**
   * Organisation-wide ads.txt entries. Top-level (not inside ads_config).
   * Merged additively across all layers (org + groups + site).
   * Overrides use REPLACE semantics for ads_txt.
   */
  ads_txt?: string[];

  /** Legal page templates keyed by slug (e.g. "privacy-policy", "terms"). */
  legal: Record<string, string>;

  /** Default preview page configuration. */
  preview_page?: Partial<PreviewPageConfig>;

  /** Default category page configuration. */
  categories?: Partial<CategoryConfig>;

  /** Default sidebar configuration. */
  sidebar?: Partial<SidebarConfig>;

  /** Default search configuration. */
  search?: Partial<SearchConfig>;
}

// ---------------------------------------------------------------------------
// Group config (group.yaml)
// ---------------------------------------------------------------------------

/**
 * Group-level configuration that overrides org defaults for a cluster of sites.
 */
export interface GroupConfig {
  /** Unique identifier for this group. */
  group_id: string;

  /** Human-readable group name. */
  name: string;

  /** Group-specific ads.txt lines (merged with org-level entries). */
  ads_txt?: string[];

  /** Tracking overrides — only specified fields replace org defaults. */
  tracking?: Partial<TrackingConfig>;

  /** Script overrides — only specified positions replace org defaults. */
  scripts?: Partial<ScriptsConfig>;

  /** Group-level script variable substitutions. */
  scripts_vars?: Record<string, string>;

  /** Advertising overrides. */
  ads_config?: Partial<AdsConfig>;

  /** Theme overrides. */
  theme?: Partial<ThemeConfig>;

  /** Legal page overrides keyed by slug. */
  legal_pages_override?: Record<string, string>;

  /** Group-level preview page overrides. */
  preview_page?: Partial<PreviewPageConfig>;

  /** Group-level category page overrides. */
  categories?: Partial<CategoryConfig>;

  /** Group-level sidebar overrides. */
  sidebar?: Partial<SidebarConfig>;

  /** Group-level search overrides. */
  search?: Partial<SearchConfig>;
}

// ---------------------------------------------------------------------------
// Site config (site.yaml)
// ---------------------------------------------------------------------------

/**
 * Per-site configuration — the leaf of the config hierarchy.
 */
export interface SiteConfig {
  /** Primary domain for this site (e.g. "www.example.com"). */
  domain: string;

  /** Display name of the site. */
  site_name: string;

  /** Optional tagline shown in headers / meta tags. */
  site_tagline?: string | null;

  /**
   * @deprecated Legacy single-group field. Use `groups` array instead.
   * If only `group` is present, treated as `groups: [group]`.
   */
  group?: string;

  /**
   * Group references. Array of group IDs, merged left-to-right.
   * Each ID references `groups/<id>.yaml` in the network repo.
   */
  groups: string[];

  /**
   * @deprecated Legacy monetization profile reference. The monetization layer
   * has been replaced by the unified groups + overrides architecture.
   * If present, the id is appended to the groups array for backward compat.
   */
  monetization?: string;

  /** Whether the site is live and should be built/deployed. */
  active: boolean;

  /** Site-level tracking overrides. */
  tracking?: Partial<TrackingConfig>;

  /**
   * Variable substitutions applied to script `src` and `inline` fields.
   * Keys are placeholder names (without delimiters); values are replacements.
   */
  scripts_vars?: Record<string, string>;

  /** Editorial brief driving content generation. */
  brief: SiteBrief;

  /** Site-level theme overrides. */
  theme?: Partial<ThemeConfig>;

  /** Site-level legal page overrides. */
  legal?: Record<string, string>;

  /** Site-level advertising overrides. */
  ads_config?: Partial<AdsConfig>;

  /**
   * Site-level ads.txt entries. Top-level (not inside ads_config).
   * Additively merged with org/group entries.
   */
  ads_txt?: string[];

  /** Site-level preview page overrides. */
  preview_page?: Partial<PreviewPageConfig>;

  /** Site-level category page overrides. */
  categories?: Partial<CategoryConfig>;

  /** Site-level sidebar overrides. */
  sidebar?: Partial<SidebarConfig>;

  /** Site-level search overrides. */
  search?: Partial<SearchConfig>;
}

// ---------------------------------------------------------------------------
// Resolved (fully merged) config
// ---------------------------------------------------------------------------

/**
 * The fully-resolved site configuration produced by `resolve-config.ts`.
 * All optional/partial fields have been merged from org -> group -> site
 * and every field is guaranteed to be present.
 */
export interface ResolvedConfig {
  /** Network identifier from `network.yaml`. */
  network_id: string;

  /** Platform version from `network.yaml`. */
  platform_version: string;

  /** Organisation name. */
  organization: string;

  /** Legal entity name. */
  legal_entity: string;

  /** Registered company address. */
  company_address: string;

  /** Primary domain of the site. */
  domain: string;

  /** Display name of the site. */
  site_name: string;

  /** Site tagline (null if not set). */
  site_tagline: string | null;

  /** Primary group ID (first entry in groups array, empty string if none). */
  group: string;

  /** All group IDs this site belongs to (merged left-to-right). */
  groups: string[];

  /** Override IDs that were applied during config resolution (by priority order). */
  applied_overrides: string[];

  /** Resolved support email (from org support_email_pattern with domain). */
  support_email: string;

  /** Whether the site is active. */
  active: boolean;

  /** Fully-resolved tracking configuration. */
  tracking: TrackingConfig;

  /** Fully-resolved scripts with all placeholders replaced. */
  scripts: ScriptsConfig;

  /** Merged ads.txt lines from org + groups (additive) or override (replace). */
  ads_txt: string[];

  /** Fully-resolved advertising configuration. */
  ads_config: AdsConfig;

  /** Fully-resolved theme configuration (all fields required). */
  theme: ResolvedThemeConfig;

  /** Editorial brief for the site. */
  brief: SiteBrief;

  /** Merged legal pages. */
  legal: Record<string, string>;

  /** Placeholder heights used at build time for CLS prevention. */
  ad_placeholder_heights: AdPlaceholderHeights;

  /** Fully-resolved preview page configuration. */
  preview_page: PreviewPageConfig;

  /** Fully-resolved category page configuration. */
  categories: CategoryConfig;

  /** Fully-resolved sidebar configuration. */
  sidebar: SidebarConfig;

  /** Fully-resolved search configuration. */
  search: SearchConfig;

  /**
   * Runtime-shaped inline config JSON. Embedded into the HTML head at build
   * time (as `window.__ATL_CONFIG__`) so that ad-loader.js can render ads
   * without a CDN round-trip.
   */
  inlineAdConfig?: InlineAdConfig;
}

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/**
 * Recursively makes all properties of T optional.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends Record<string, unknown>
      ? DeepPartial<T[P]>
      : T[P];
};
