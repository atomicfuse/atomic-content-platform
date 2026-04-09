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
  articles_per_week: number;
  preferred_days: string[];
  preferred_time: string;
}

export interface SiteBrief {
  audience: string;
  tone: string;
  article_types: Record<string, number>;
  topics: string[];
  seo_keywords_focus: string[];
  content_guidelines: string | string[];
  review_percentage: number;
  schedule: PublishSchedule;
  vertical?: "Tech" | "Travel" | "News" | "Sport" | "Lifestyle" | "Entertainment" | "Food & Drink" | "Animals" | "Science";
  audience_type?: "Young 18-24" | "Adult 25-44" | "Mature 45+" | "Parents" | "Professionals";
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
