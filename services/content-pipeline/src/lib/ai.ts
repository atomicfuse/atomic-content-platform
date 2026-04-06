/**
 * AI client wrapper for content generation via CloudGrid AI Gateway.
 *
 * Uses @cloudgrid-io/ai SDK — no API keys needed. The platform handles
 * auth, routing, and metering via AI_GATEWAY_URL (auto-injected).
 */

import { ai, type AIResponse } from "@cloudgrid-io/ai";

const DEFAULT_MODEL = "claude-sonnet";

export interface GenerateArticleParams {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Generate text content via CloudGrid AI Gateway.
 */
export async function generateContent(
  params: GenerateArticleParams,
): Promise<string> {
  const result = await ai.chat(
    [{ role: "user", content: params.userPrompt }],
    {
      model: params.model ?? DEFAULT_MODEL,
      maxTokens: params.maxTokens ?? 4096,
      system: params.systemPrompt,
    },
  ) as AIResponse;

  return result.text;
}
