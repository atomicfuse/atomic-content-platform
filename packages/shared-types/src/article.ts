/**
 * Allowed article format types.
 */
export type ArticleType = "listicle" | "how-to" | "review" | "standard";

/**
 * Per-criterion breakdown of an article's quality score.
 */
export interface QualityScoreBreakdown {
  /** SEO quality — title, description, keyword usage, heading structure. */
  seo_quality: number;
  /** How well the writing matches the site's stated tone and audience. */
  tone_match: number;
  /** Whether the article meets the target word count (~1000 words). */
  content_length: number;
  /** No obvious hallucinations, contradictions, or fabricated claims. */
  factual_accuracy: number;
  /** Coverage of the site's target topics and SEO keywords. */
  keyword_relevance: number;
}

/**
 * Front-matter metadata for an article markdown file.
 */
export interface ArticleFrontmatter {
  /** Article headline / title. */
  title: string;

  /** Short meta-description for SEO and previews. */
  description: string;

  /** Content format of the article. */
  type: ArticleType;

  /** Editorial workflow status. */
  status: "draft" | "review" | "published";

  /** Scheduled or actual publish date. */
  publishDate: Date | string;

  /** Display name of the article author. */
  author: string;

  /** Taxonomy tags for categorisation and filtering. */
  tags: string[];

  /** URL or path to the hero / featured image. */
  featuredImage?: string;

  /** Notes left by a human or AI reviewer. */
  reviewer_notes: string;

  /** URL-safe slug used in the article permalink. */
  slug: string;

  /** Overall quality score 0-100, set by the quality agent. */
  quality_score?: number;

  /** Per-criterion breakdown of the quality score. */
  score_breakdown?: QualityScoreBreakdown;

  /** Brief note from the quality agent explaining the score. */
  quality_note?: string;
}
