import { stringify as yamlStringify } from "yaml";
import type { QualityScoreBreakdown } from "../../types.js";

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
  videos?: Array<{ id: string; url: string; position: string }>;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
  articleStatus?: "approved" | "review";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORDS_PER_MINUTE = 200;

/**
 * Strip all HTML tags from a string, decode HTML entities, and collapse whitespace.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex as string, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026")
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
    status: input.articleStatus ?? "approved",
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

  if (input.videos && input.videos.length > 0) {
    frontmatter.videos = input.videos;
  }

  if (input.quality_score !== undefined) {
    frontmatter.quality_score = input.quality_score;
  }
  if (input.score_breakdown) {
    frontmatter.score_breakdown = input.score_breakdown;
  }
  if (input.quality_note) {
    frontmatter.quality_note = input.quality_note;
  }

  const yamlBlock = yamlStringify(frontmatter, {
    lineWidth: 0, // no line wrapping
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  }).trimEnd();

  return `---\n${yamlBlock}\n---\n\n${input.markdownBody}\n`;
}
