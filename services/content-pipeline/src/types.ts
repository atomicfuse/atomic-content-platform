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

export type ArticleVideoPosition =
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

export interface ArticleVideo {
  id: string;
  url: string;
  position: ArticleVideoPosition;
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
  videos?: ArticleVideo[];
  /** Per-topic membership list (per-topic-filter model). First entry is the
   *  primary topic; subsequent entries are secondary topics whose filters also
   *  matched this article. Absent on legacy-site articles. */
  topics?: string[];
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
  /** Free-form image generation guidelines for content agents. */
  image_guidelines?: string | string[];
  review_percentage: number;
  schedule: PublishSchedule;
  vertical?: string;
  /** Content Aggregator vertical ID — preferred over name for API queries. */
  vertical_id?: string;
  /** Content Aggregator category IDs — all categories the site targets. */
  category_ids?: string[];
  /** Content Aggregator tag IDs — all tags the site targets. */
  tag_ids?: string[];
  /** @deprecated Use bundle_ids instead. Read-shim migrates this on load. */
  bundle_id?: string;
  /** Content Aggregator bundle IDs — articles are fetched from the union of these bundles, deduped. */
  bundle_ids?: string[];
  /** Free-text site theme (1–2 lines). Drives AI proposals in the per-topic model.
   *  Required on sites that have `topics_v2` set. */
  theme?: string;
  /** Per-topic filters — the new editorial model. Presence of this field
   *  switches the site to the per-topic path everywhere (UI, content fetch).
   *  Absence means the site uses the legacy `bundle_ids` model.
   *  Migration is opt-in per site; the two shapes never need to coexist on the
   *  same site (a `topics_v2` save strips `bundle_ids` and the legacy niche
   *  fields). */
  topics_v2?: TopicV2[];
  audience_type?: string;
  /** Content Aggregator audience type IDs — preferred over name for API queries. */
  audience_type_ids?: string[];
  /** @deprecated Single audience type ID — use audience_type_ids instead. */
  audience_type_id?: string;
  language?: string;
  quality_threshold?: number;
  quality_weights?: QualityWeights;
}

/** One topic (menu section) in the per-topic model.
 *  Carries its own filter (where to source content from) and its own schedule
 *  (when + how much to publish). */
export interface TopicV2 {
  /** Display name of the topic. Also used as the menu item label on the site
   *  and as a membership key in article frontmatter. Unique per site (case-insensitive). */
  name: string;
  /** Optional 1-line description that helps the AI propose better filters.
   *  Not shown anywhere on the live site. */
  description?: string;
  /** Where this topic pulls its content from. */
  source: TopicV2Source;
  /** Publishing cadence for this topic. */
  schedule: TopicV2Schedule;
}

/** A topic's filter source — either raw categories+tags (default) or a pointer
 *  to a shared aggregator bundle (power-user path). */
export type TopicV2Source =
  | { type: "filter"; category_ids: string[]; tag_ids: string[] }
  | { type: "bundle"; bundle_id: string };

export interface TopicV2Schedule {
  /** Target articles per calendar week. */
  articles_per_week: number;
  /** Days of the week (full names: "Monday"..."Sunday") on which this topic
   *  is eligible to publish. Empty array = never publish. */
  preferred_days: string[];
}

export interface SiteConfig {
  domain: string;
  site_name: string;
  site_tagline?: string | null;
  group: string;
  active: boolean;
  brief: SiteBrief;
  /** Default author name for generated articles. */
  author?: string;
  [key: string]: unknown;
}
