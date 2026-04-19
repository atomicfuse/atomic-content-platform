/**
 * Base Generator interface and shared prompt context builder.
 *
 * All generators (Claude, OpenAI) implement the Generator interface.
 * The buildPromptContext utility extracts structured prompt input from
 * Content Aggregator v2 items — NO URL scraping.
 */

import type { ContentItem, GeneratedArticle } from "../types.js";
import type { SiteBrief } from "../../../types.js";

// ---------------------------------------------------------------------------
// Generator interface
// ---------------------------------------------------------------------------

export interface GeneratorConfig {
  siteName: string;
  brief: SiteBrief;
}

/** All generators must implement this interface. */
export interface Generator {
  /** Generator identifier for logging. */
  readonly name: string;
  /** Generate an article from a content item. */
  generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle>;
}

// ---------------------------------------------------------------------------
// Shared prompt context builder
// ---------------------------------------------------------------------------

/** Structured context extracted from a ContentItem for use in prompts. */
export interface PromptContext {
  title: string;
  description: string;
  summary: string;
  categories: string;
  tags: string;
  audienceTypes: string;
  vertical: string;
  sourceName: string;
  publishedAt: string;
  language: string;
}

/**
 * Build structured prompt context from a ContentItem.
 * Uses API-provided fields — NO URL scraping.
 */
export function buildPromptContext(item: ContentItem): PromptContext {
  return {
    title: item.title,
    description: item.description,
    summary: item.summary,
    categories: item.categories.map((c) => c.name).join(", ") || "General",
    tags: item.tags.map((t) => t.name).join(", ") || "none",
    audienceTypes: item.audience_types.map((a) => a.name).join(", ") || "General",
    vertical: item.vertical?.name ?? "General",
    sourceName: item.source.name,
    publishedAt: item.published_at,
    language: item.language,
  };
}

/**
 * Parse a JSON response from a model, handling optional markdown fences.
 */
export function parseGeneratedArticle(raw: string): GeneratedArticle {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = fenceMatch ? fenceMatch[1]! : raw;
  return JSON.parse(cleaned.trim()) as GeneratedArticle;
}
