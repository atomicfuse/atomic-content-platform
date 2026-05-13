export interface CsvSiteRow {
  name: string;                    // site display name, e.g. "Travel Beauty Tips"
  domain: string;                  // e.g. "travelbeautytips.com"
  websiteCategory: string;         // e.g. "Style & Fashion"
  menuItems: string[];             // parsed from comma-separated
  iabCategories: string[];         // parsed from comma-separated
  subCategories: string[];         // parsed from comma-separated
  colorPalette: Record<string, string>; // parsed: { primary, secondary, accent, text, background }
  logoUrl: string;                 // WP URL to download
  faviconUrl: string;              // WP URL to download
  postsApiUrl: string;             // e.g. "https://domain/wp-json/wp/v2/posts?per_page=75"
  gaInfo: GaInfo;                  // parsed from comma-separated
}

export interface GaInfo {
  gaPropertyId?: string;           // numeric, e.g. "328395426"
  gaMeasurementId?: string;        // e.g. "G-HL2D8CQ0Z9"
  gtmId?: string;                  // e.g. "GT-5R65N74B"
}

export interface WpArticle {
  id: number;
  slug: string;
  date: string;
  link?: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  author: number;
  featured_media: number;
  categories: number[];
  tags: number[];
  yoast_head_json?: {
    title?: string;
    og_title?: string;
    og_description?: string;
    canonical?: string;
    twitter_card?: string;
    author?: string;
    article_published_time?: string;
    og_image?: Array<{ url?: string }>;
    twitter_misc?: Record<string, string>;
  };
}

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

export interface CategoryMapping {
  wpCategoryId: number;
  wpCategoryName: string;
  atlMenuItemName: string;
}

export type MigrationPhase =
  | "fetching"
  | "converting"
  | "generating-image"
  | "uploading-image"
  | "committing"
  | "complete"
  | "error";

export interface MigrationProgress {
  site: string;
  phase: MigrationPhase;
  totalArticles: number;
  processedArticles: number;
  currentArticleSlug?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface MigrationArticleResult {
  slug: string;
  title: string;
  status: "success" | "error";
  error?: string;
  imageGenerated: boolean;
}

export interface MigrationReport {
  site: string;
  totalArticles: number;
  successful: number;
  failed: number;
  results: MigrationArticleResult[];
  durationMs: number;
}
