/**
 * OpenAI Generator — general/evergreen article generation.
 *
 * Uses the openai SDK with GPT-4o-mini model.
 * 10-20x cheaper than Claude for non-news content.
 */

import OpenAI from "openai";
import { buildPromptContext, parseGeneratedArticle } from "./base-generator.js";
import type { Generator, GeneratorConfig } from "./base-generator.js";
import type { ContentItem, GeneratedArticle } from "../types.js";
import { buildGeneralSystemPrompt, buildGeneralUserPrompt } from "../prompts/general-article.js";

const MODEL = "gpt-4o-mini";

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for general article generation");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export class OpenAIGenerator implements Generator {
  readonly name = "openai";

  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const ctx = buildPromptContext(item);
    const systemPrompt = buildGeneralSystemPrompt(config.siteName, config.brief);
    const userPrompt = buildGeneralUserPrompt(ctx);

    console.log(`[openai-gen] Generating general article: "${item.title}"`);

    const client = getClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) {
      throw new Error("Empty response from OpenAI");
    }

    return parseGeneratedArticle(rawText);
  }
}
