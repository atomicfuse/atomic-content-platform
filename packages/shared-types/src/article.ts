/**
 * Allowed article format types.
 */
export type ArticleType = "listicle" | "how-to" | "review" | "standard";

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
}
