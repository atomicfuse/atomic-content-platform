/**
 * Types for the Content Generation v2 pipeline.
 *
 * Matches the Content Aggregator v2 API response shapes and defines
 * internal types for the dual-model generation pipeline.
 */

import type { TokenUsage } from "../../costs/usage.js";

// ---------------------------------------------------------------------------
// Content Aggregator v2 API types
// ---------------------------------------------------------------------------

/** A single enriched content item from the Content Aggregator v2 API. */
export interface ContentItem {
  id: string;
  url: string;
  title: string;
  description: string;
  /** Structured brief: "What happened… Why it matters… Content opportunity…" */
  summary: string;
  thumbnail: { url: string } | null;
  content_type: string;
  /** @deprecated Dropped from API response 2026-04-29 — always null for new items. */
  vertical: { name: string } | null;
  categories: Array<{ name: string }>;
  tags: Array<{ name: string }>;
  audience_types: Array<{ name: string }>;
  source: { name: string };
  published_at: string;
  language: string;
  /** Aggregator category IDs attached to this item (present on enriched responses). */
  category_ids?: string[];
  /** Aggregator tag IDs attached to this item (present on enriched responses). */
  tag_ids?: string[];
}

/** Response shape from GET /api/content. */
export interface ContentApiResponse {
  items: ContentItem[];
  total_count: number;
  total_returned: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Aggregator settings from GET /api/settings. */
export interface AggregatorSettings {
  classification: {
    factual_tags: string[];
  };
  enrichment: {
    batch_size: number;
  };
}

// ---------------------------------------------------------------------------
// Router types
// ---------------------------------------------------------------------------

export type GeneratorType = "claude" | "openai";

export interface RouterDecision {
  isFactual: boolean;
  reason: string;
  generator: GeneratorType;
}

// ---------------------------------------------------------------------------
// Generator output types
// ---------------------------------------------------------------------------

/** Raw output from a generator (Claude or OpenAI). */
export interface GeneratedArticle {
  title: string;
  slug: string;
  description: string;
  type: string;
  tags: string[];
  body: string;
  /** Token usage for the generation call, when available. */
  usage?: TokenUsage;
}

/** Generated or analyzed image asset. */
export interface ImageAsset {
  /** Raw image data (PNG). */
  data: Buffer;
  /** Relative path within the site, e.g. "assets/images/my-slug.png". */
  assetPath: string;
  /** Alt text for accessibility + SEO. */
  altText: string;
}

/** SEO metadata for an article. */
export interface SEOMetadata {
  metaTitle: string;
  metaDescription: string;
  slug: string;
  readingTime: number;
  schemaOrg: Record<string, unknown>;
  ogTags: {
    "og:title": string;
    "og:description": string;
    "og:type": string;
    "og:image"?: string;
  };
}

/** Complete output package for a single generated article. */
export interface ArticlePackage {
  article: GeneratedArticle;
  heroImage: ImageAsset | null;
  seo: SEOMetadata;
  sourceItemId: string;
  sourceItemUrl: string;
  generatedBy: GeneratorType;
  generatedAt: Date;
  /** Whether this was a factual (news) or general article. */
  isFactual: boolean;
}
