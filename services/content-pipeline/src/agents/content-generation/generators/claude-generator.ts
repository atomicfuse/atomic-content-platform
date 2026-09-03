/**
 * Claude Generator — news/factual article generation.
 *
 * Uses the existing ai.ts wrapper (@cloudgrid-io/ai → @anthropic-ai/sdk fallback).
 * Model: claude-sonnet via CloudGrid AI Gateway.
 */

import { generateContent } from "../../../lib/ai.js";
import { parseGeneratedArticle } from "./base-generator.js";
import type { Generator, GeneratorConfig } from "./base-generator.js";
import type { ContentItem, GeneratedArticle } from "../types.js";
import { buildArticlePrompts } from "../prompts/build-prompts.js";

export class ClaudeGenerator implements Generator {
  readonly name = "claude";

  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const { system, user, genre } = buildArticlePrompts({
      siteName: config.siteName,
      brief: config.brief,
      mode: "sourced",
      item,
      isFactual: config.isFactual ?? true,
    });

    console.log(`[claude-gen] Generating ${genre} article: "${item.title}"`);

    const { text, usage } = await generateContent({
      systemPrompt: system,
      userPrompt: user,
      // ai.ts maps "claude-sonnet" for CloudGrid, DEFAULT_MODEL for Anthropic SDK
      maxTokens: 4096,
    });

    const article = parseGeneratedArticle(text);
    return { ...article, usage };
  }
}
