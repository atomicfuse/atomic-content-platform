/**
 * Shared types inlined from @atomic-platform/shared-types
 * for standalone CloudGrid deployment.
 */

export type ArticleType = "listicle" | "how-to" | "review" | "standard";

export interface QualityScoreBreakdown {
  seo_quality: number;
  tone_match: number;
  content_length: number;
  factual_accuracy: number;
  keyword_relevance: number;
}

export interface ArticleFrontmatter {
  title: string;
  description: string;
  type: ArticleType;
  status: "draft" | "review" | "published";
  publishDate: Date | string;
  author: string;
  tags: string[];
  featuredImage?: string;
  reviewer_notes: string;
  slug: string;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
}

export interface QualityWeights {
  seo_quality?: number;
  tone_match?: number;
  content_length?: number;
  factual_accuracy?: number;
  keyword_relevance?: number;
}

export interface PublishSchedule {
  /** Articles to publish on each matching day. Takes priority when present. */
  articles_per_day?: number;
  /** Legacy: articles per week. Fallback when articles_per_day is absent. */
  articles_per_week?: number;
  preferred_days: string[];
  preferred_time: string;
}

export interface SiteBrief {
  /** Display audience string (joined from audiences array or legacy single value). */
  audience: string;
  /** Array of audience names — preferred over singular audience. */
  audiences?: string[];
  tone: string;
  article_types: Record<string, number>;
  topics: string[];
  seo_keywords_focus: string[];
  content_guidelines: string | string[];
  review_percentage: number;
  schedule: PublishSchedule;
  vertical?: string;
  /** Content Aggregator vertical ID — preferred over name for API queries. */
  vertical_id?: string;
  audience_type?: string;
  /** Content Aggregator audience type IDs — preferred over name for API queries. */
  audience_type_ids?: string[];
  /** @deprecated Single audience type ID — use audience_type_ids instead. */
  audience_type_id?: string;
  language?: string;
  quality_threshold?: number;
  quality_weights?: QualityWeights;
}

export interface SiteConfig {
  domain: string;
  site_name: string;
  site_tagline?: string | null;
  group: string;
  active: boolean;
  brief: SiteBrief;
  [key: string]: unknown;
}
