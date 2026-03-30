export type SiteStatus = "New" | "Preview" | "Ready" | "Live" | "WordPress";
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
  type: "article_published" | "build_failed" | "article_flagged" | "site_created" | "monetization_activated";
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
  reviewerNotes?: string;
}

export interface WizardFormData {
  domain: string;
  siteName: string;
  siteTagline: string;
  company: Company;
  vertical: Vertical;
  themeBase: "modern" | "editorial" | "bold" | "classic";
  audience: string;
  tone: string;
  topics: string[];
  articlesPerWeek: number;
  preferredDays: string[];
  contentGuidelines: string;
}
