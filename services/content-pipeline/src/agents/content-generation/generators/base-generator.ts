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
 *
 * Models sometimes wrap JSON in fences, add preamble text, or return
 * truncated responses. This function tries multiple strategies before
 * giving up, and logs the raw response on failure for debugging.
 */
export function parseGeneratedArticle(raw: string): GeneratedArticle {
  // Strategy 1: extract from markdown fences (greedy — grab the LAST complete fence)
  const fenceMatches = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fenceMatches.length > 0) {
    // Try each fence match, preferring the longest one (most likely the full JSON)
    const sorted = fenceMatches
      .map((m) => m[1]!.trim())
      .filter((s) => s.length > 0)
      .sort((a, b) => b.length - a.length);

    for (const candidate of sorted) {
      try {
        return JSON.parse(candidate) as GeneratedArticle;
      } catch {
        // Try next fence
      }
    }
  }

  // Strategy 2: find the first { ... } block that looks like the full JSON object
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(raw.slice(braceStart, braceEnd + 1)) as GeneratedArticle;
    } catch {
      // Fall through
    }
  }

  // Strategy 3: try the raw string as-is
  try {
    return JSON.parse(raw.trim()) as GeneratedArticle;
  } catch {
    // Final failure — log truncated response for debugging
    const preview = raw.length > 500
      ? `${raw.slice(0, 250)}…[${raw.length} chars]…${raw.slice(-250)}`
      : raw;
    throw new Error(
      `Failed to parse generated article as JSON. Response preview: ${preview}`,
    );
  }
}
