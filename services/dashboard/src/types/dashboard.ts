export type SiteStatus = "New" | "Staging" | "Preview" | "Ready" | "Live" | "WordPress";
export type Company = "ATL" | "NGC";
export type Vertical = string;

export interface DashboardSiteEntry {
  domain: string;
  company: Company;
  vertical: Vertical;
  status: SiteStatus;
  site_id: string;
  exclusivity: string | null;
  ob_epid: string | null;
  ga_info: string | null;
  cf_apo: boolean;
  fixed_ad: boolean;
  last_updated: string;
  created_at: string;
  /** Cloudflare Pages project name for API calls (e.g. "coolnews-dev"). */
  pages_project: string | null;
  /** Cloudflare Pages *.pages.dev subdomain prefix (may differ from pages_project if CF renamed it). */
  pages_subdomain: string | null;
  /** Cloudflare zone ID for API operations. */
  zone_id: string | null;
  /** Git branch used for staging (e.g., "staging/coolnews-dev-v2"). */
  staging_branch: string | null;
  /** Current staging preview URL. */
  preview_url: string | null;
  /** Saved preview deployment URLs for review. */
  saved_previews: Array<{ url: string; label: string; saved_at: string }> | null;
  /** Custom domain attached to the Pages project. */
  custom_domain: string | null;
  /**
   * Worker-related fields populated post-migration (Phase 6+). Optional —
   * absent on sites that haven't been touched by the Pages → Workers
   * migration yet. Set in `dashboard-index.yaml` by the Phase-6 work and
   * by the dashboard's own site-creation flow once that's updated.
   */
  worker?: string;
  worker_kv_staging?: string;
  worker_kv_prod?: string;
  /** True while the site has no custom domain bound to the Worker. */
  worker_pending_dns?: boolean;
}

export interface DeletedSiteEntry extends DashboardSiteEntry {
  /** ISO 8601 timestamp of when the site was moved to trash. */
  deleted_at: string;
}

export interface DashboardIndex {
  sites: DashboardSiteEntry[];
  deleted?: DeletedSiteEntry[];
}

export interface ActivityEvent {
  id: string;
  type: "article_published" | "build_failed" | "article_flagged" | "site_created" | "override_activated";
  description: string;
  timestamp: string;
  domain?: string;
}

export interface DashboardStats {
  totalSites: number;
  articlesThisWeek: number;
  pendingReview: number;
  failedBuilds: number;
}

export interface ArticleEntry {
  slug: string;
  title: string;
  type: string;
  status: string;
  publishDate: string;
  score?: number;
  scoreBreakdown?: {
    seo_quality: number;
    tone_match: number;
    content_length: number;
    factual_accuracy: number;
    keyword_relevance: number;
  };
  qualityNote?: string;
  reviewerNotes?: string;
}

export interface WizardFormData {
  domain: string;
  pagesProjectName: string;
  siteName: string;
  siteTagline: string;
  company: Company;
  /** Vertical display name. */
  vertical: Vertical;
  /** Vertical ID from the Content Aggregator API. */
  verticalId: string;
  /** Group IDs this site belongs to (merged left-to-right). */
  groups: string[];
  themeBase: "modern" | "editorial" | "bold" | "classic";
  /** Audience display names. */
  audiences: string[];
  /** Audience type IDs from the Content Aggregator API. */
  audienceIds: string[];
  /** Selected categories from Niche Targeting step: { id, name, iabCode }. */
  selectedCategories: Array<{ id: string; name: string; iabCode: string }>;
  /** Selected tags from Niche Targeting step: { id, name }. */
  selectedTags: Array<{ id: string; name: string }>;
  /** IAB vertical code (denormalized from vertical object). */
  iabVerticalCode: string;
  /** Existing bundle ID (set when user picks an existing bundle instead of creating new). */
  bundleId: string;
  tone: string;
  topics: string[];
  articlesPerDay: number;
  preferredDays: string[];
  contentGuidelines: string;
  /** Brand primary color (hex). */
  primaryColor: string;
  /** Brand accent color (hex). */
  accentColor: string;
  /** Google Font family for headings. */
  fontHeading: string;
  /** Google Font family for body text. */
  fontBody: string;
  /** Script variable overrides for this site. */
  scriptsVars: Record<string, string>;
  /** Base64-encoded logo uploaded by user (skips AI generation). */
  logoBase64?: string;
  /** Base64-encoded favicon uploaded by user. */
  faviconBase64?: string;
}
