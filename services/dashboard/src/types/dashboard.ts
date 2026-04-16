export type SiteStatus = "New" | "Staging" | "Preview" | "Ready" | "Live" | "WordPress";
export type Company = "ATL" | "NGC";
export type Vertical =
  | "Lifestyle"
  | "Travel"
  | "Entertainment"
  | "Animals"
  | "Science"
  | "Food & Drink"
  | "News"
  | "Conspiracy"
  | "Other";

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
  /** Cloudflare Pages project name (e.g. "coolnews-dev"). */
  pages_project: string | null;
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
  vertical: Vertical;
  /** Group IDs this site belongs to (merged left-to-right). */
  groups: string[];
  themeBase: "modern" | "editorial" | "bold" | "classic";
  audience: string;
  tone: string;
  topics: string[];
  articlesPerDay: number;
  preferredDays: string[];
  contentGuidelines: string;
  /** Script variable overrides for this site. */
  scriptsVars: Record<string, string>;
}
