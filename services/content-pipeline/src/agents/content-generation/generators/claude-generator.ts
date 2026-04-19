/**
 * Claude Generator — news/factual article generation.
 *
 * Uses the existing ai.ts wrapper (@cloudgrid-io/ai → @anthropic-ai/sdk fallback).
 * Model: claude-sonnet via CloudGrid AI Gateway.
 */

import { generateContent } from "../../../lib/ai.js";
import { buildPromptContext, parseGeneratedArticle } from "./base-generator.js";
import type { Generator, GeneratorConfig } from "./base-generator.js";
import type { ContentItem, GeneratedArticle } from "../types.js";
import { buildNewsSystemPrompt, buildNewsUserPrompt } from "../prompts/news-article.js";

export class ClaudeGenerator implements Generator {
  readonly name = "claude";

  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const ctx = buildPromptContext(item);
    const systemPrompt = buildNewsSystemPrompt(config.siteName, config.brief);
    const userPrompt = buildNewsUserPrompt(ctx);

    console.log(`[claude-gen] Generating factual article: "${item.title}"`);

    const rawResponse = await generateContent({
      systemPrompt,
      userPrompt,
      // ai.ts maps "claude-sonnet" for CloudGrid, DEFAULT_MODEL for Anthropic SDK
      maxTokens: 4096,
    });

    return parseGeneratedArticle(rawResponse);
  }
}
