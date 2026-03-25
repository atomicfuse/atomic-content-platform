import type { TrackingConfig } from "./tracking.js";
import type { ScriptEntry, AdsConfig } from "./ads.js";

// ---------------------------------------------------------------------------
// Site brief
// ---------------------------------------------------------------------------

/**
 * Publishing schedule for a site.
 */
export interface PublishSchedule {
  /** Target number of articles to publish per week. */
  articles_per_week: number;

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
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Visual theme configuration for a site.
 */
export interface ThemeConfig {
  /** Base theme template to extend. */
  base?: "modern" | "editorial";

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
  base: "modern" | "editorial";

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

  /** Organisation-wide tracking configuration. */
  tracking: TrackingConfig;

  /** Organisation-wide script injection configuration. */
  scripts: ScriptsConfig;

  /** Default advertising configuration. */
  ads_config: AdsConfig;

  /** Legal page templates keyed by slug (e.g. "privacy-policy", "terms"). */
  legal: Record<string, string>;
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
  ads_txt: string[];

  /** Tracking overrides — only specified fields replace org defaults. */
  tracking?: Partial<TrackingConfig>;

  /** Script overrides — only specified positions replace org defaults. */
  scripts?: Partial<ScriptsConfig>;

  /** Advertising overrides. */
  ads_config?: Partial<AdsConfig>;

  /** Theme overrides. */
  theme?: Partial<ThemeConfig>;

  /** Legal page overrides keyed by slug. */
  legal_pages_override?: Record<string, string>;
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

  /** ID of the group this site belongs to. */
  group: string;

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

  /** Group ID this site belongs to. */
  group: string;

  /** Whether the site is active. */
  active: boolean;

  /** Fully-resolved tracking configuration. */
  tracking: TrackingConfig;

  /** Fully-resolved scripts with all placeholders replaced. */
  scripts: ScriptsConfig;

  /** Merged ads.txt lines from org + group. */
  ads_txt: string[];

  /** Fully-resolved advertising configuration. */
  ads_config: AdsConfig;

  /** Fully-resolved theme configuration (all fields required). */
  theme: ResolvedThemeConfig;

  /** Editorial brief for the site. */
  brief: SiteBrief;

  /** Merged legal pages. */
  legal: Record<string, string>;
}
