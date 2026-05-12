import { stringify as yamlStringify } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArticleMdInput {
  title: string;
  description: string;
  slug: string;
  publishDate: string;
  author: string;
  tags: string[];
  markdownBody: string;
  featuredImage?: string;
  wpOriginalId: number;
  sourceUrl: string;
  seo: {
    canonical?: string;
    og_title?: string;
    og_description?: string;
    og_image?: string;
    twitter_card?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORDS_PER_MINUTE = 200;

/**
 * Strip all HTML tags from a string, leaving only text content.
 * Collapses whitespace and trims.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Estimate reading time in minutes (rounded up) at 200 wpm.
 */
export function estimateReadingTime(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Assemble a complete article `.md` file (YAML frontmatter + body)
 * that matches the platform's existing article format.
 */
export function buildArticleMd(input: ArticleMdInput): string {
  const readingTime = estimateReadingTime(input.markdownBody);

  const frontmatter: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    type: "standard",
    status: "published",
    publishDate: input.publishDate,
    author: input.author,
    tags: input.tags,
    slug: input.slug,
    reading_time: readingTime,
    source_url: input.sourceUrl,
    imported_from: "wordpress",
    wp_original_id: input.wpOriginalId,
  };

  if (input.featuredImage) {
    frontmatter.featuredImage = input.featuredImage;
  }

  // Build SEO block — only include fields that have values
  const seo: Record<string, string> = {};
  if (input.seo.canonical) seo.canonical = input.seo.canonical;
  if (input.seo.og_title) seo.og_title = input.seo.og_title;
  if (input.seo.og_description) seo.og_description = input.seo.og_description;
  if (input.seo.og_image) seo.og_image = input.seo.og_image;
  if (input.seo.twitter_card) seo.twitter_card = input.seo.twitter_card;

  if (Object.keys(seo).length > 0) {
    frontmatter.seo = seo;
  }

  const yamlBlock = yamlStringify(frontmatter, {
    lineWidth: 0, // no line wrapping
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  }).trimEnd();

  return `---\n${yamlBlock}\n---\n\n${input.markdownBody}\n`;
}
