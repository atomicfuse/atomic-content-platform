/**
 * AI client wrapper for content generation via Claude API.
 *
 * Provides typed helpers for generating articles, revising content,
 * and building prompts from site briefs and templates.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface AIConfig {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export function createAIClient(config: AIConfig): Anthropic {
  return new Anthropic({ apiKey: config.apiKey });
}

export interface GenerateArticleParams {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Generate text content via Claude.
 */
export async function generateContent(
  client: Anthropic,
  params: GenerateArticleParams,
): Promise<string> {
  const response = await client.messages.create({
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in AI response");
  }

  return textBlock.text;
}
