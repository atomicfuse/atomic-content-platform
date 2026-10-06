/**
 * Claude Generator — primary article generator for sourced content.
 *
 * Uses the ai.ts provider chain (Anthropic → CloudGrid gateway → OpenAI), so a
 * Claude outage degrades to the OpenAI fallback model instead of failing.
 */

import { generateContent } from "../../../lib/ai.js";
import { generateArticleWithChecks } from "./base-generator.js";
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

    return generateArticleWithChecks((retryNote) =>
      generateContent({
        systemPrompt: system,
        userPrompt: retryNote ? `${user}\n\n${retryNote}` : user,
        maxTokens: 4096,
      }),
    );
  }
}
