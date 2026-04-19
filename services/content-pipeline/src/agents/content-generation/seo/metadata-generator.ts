/**
 * SEO Metadata Generator — produces meta title, description, schema.org JSON-LD,
 * Open Graph tags, and reading time for generated articles.
 *
 * Falls back to algorithmic generation if AI fails.
 */

import type { ContentItem, GeneratedArticle, SEOMetadata } from "../types.js";

/**
 * Generate SEO metadata algorithmically (no AI call needed).
 * This is reliable and fast — always succeeds.
 */
export function generateSEOMetadata(
  article: GeneratedArticle,
  item: ContentItem,
  isFactual: boolean,
  imageUrl?: string,
): SEOMetadata {
  const metaTitle = truncate(article.title, 60);
  const metaDescription = truncate(article.description, 160);
  const readingTime = estimateReadingTime(article.body);
  const slug = article.slug;

  const schemaType = isFactual ? "NewsArticle" : "Article";
  const schemaOrg: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    headline: metaTitle,
    description: metaDescription,
    author: {
      "@type": "Organization",
      name: "Editorial Team",
    },
    datePublished: new Date().toISOString(),
    articleSection: item.vertical?.name ?? "General",
    keywords: article.tags.join(", "),
    wordCount: countWords(article.body),
    timeRequired: `PT${readingTime}M`,
  };

  if (imageUrl) {
    schemaOrg.image = imageUrl;
  }

  if (item.source.name) {
    schemaOrg.sourceOrganization = {
      "@type": "Organization",
      name: item.source.name,
    };
  }

  const ogTags: SEOMetadata["ogTags"] = {
    "og:title": metaTitle,
    "og:description": metaDescription,
    "og:type": "article",
  };

  if (imageUrl) {
    ogTags["og:image"] = imageUrl;
  }

  return {
    metaTitle,
    metaDescription,
    slug,
    readingTime,
    schemaOrg,
    ogTags,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  // Cut at last space before maxLength
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLength * 0.6
    ? truncated.slice(0, lastSpace) + "..."
    : truncated.slice(0, maxLength - 3) + "...";
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Estimate reading time in minutes (avg 250 words/minute). */
function estimateReadingTime(text: string): number {
  return Math.max(1, Math.ceil(countWords(text) / 250));
}
