/**
 * OpenAI Generator — fallback article generator.
 *
 * Runs only when the Claude generator fails outright. Uses the cheap OpenAI
 * model configured for the ai.ts chain (default gpt-6-luna).
 */

import { generateWithOpenAI } from "../../../lib/ai.js";
import { generateArticleWithChecks } from "./base-generator.js";
import type { Generator, GeneratorConfig } from "./base-generator.js";
import type { ContentItem, GeneratedArticle } from "../types.js";
import { buildArticlePrompts } from "../prompts/build-prompts.js";

export class OpenAIGenerator implements Generator {
  readonly name = "openai";

  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const { system, user, genre } = buildArticlePrompts({
      siteName: config.siteName,
      brief: config.brief,
      mode: "sourced",
      item,
      isFactual: config.isFactual ?? false,
    });

    console.log(`[openai-gen] Generating ${genre} article: "${item.title}"`);

    return generateArticleWithChecks((retryNote) =>
      generateWithOpenAI({
        systemPrompt: system,
        userPrompt: retryNote ? `${user}\n\n${retryNote}` : user,
        maxTokens: 4096,
      }),
    );
  }
}
