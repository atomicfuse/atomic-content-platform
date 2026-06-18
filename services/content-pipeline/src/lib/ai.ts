/**
 * AI client wrapper for content generation.
 *
 * In production (CloudGrid): uses @cloudgrid-io/ai SDK — no API keys needed.
 * Locally: falls back to the Anthropic SDK using ANTHROPIC_API_KEY.
 */

import Anthropic from "@anthropic-ai/sdk";
import { estimateTokens } from "../costs/estimate.js";
import type { TokenUsage } from "../costs/usage.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

export type { TokenUsage } from "../costs/usage.js";

export interface GenerateArticleParams {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

let useCloudGrid: boolean | null = null;

/**
 * Generate text content — tries CloudGrid AI Gateway first,
 * falls back to Anthropic SDK for local development.
 */
export async function generateContent(
  params: GenerateArticleParams,
): Promise<{ text: string; usage: TokenUsage }> {
  // Try CloudGrid first (only in production / when gateway is available)
  if (useCloudGrid !== false) {
    try {
      const cloudgrid = await import("@cloudgrid-io/ai");
      const result = await cloudgrid.ai.chat(
        [{ role: "user", content: params.userPrompt }],
        {
          model: params.model ?? "claude-sonnet",
          maxTokens: params.maxTokens ?? 4096,
          system: params.systemPrompt,
        },
      );
      useCloudGrid = true;
      const text = (result as { text: string }).text;
      // Gateway doesn't return usage — estimate from prompt + output text.
      const usage: TokenUsage = {
        inputTokens: estimateTokens(params.systemPrompt + params.userPrompt),
        outputTokens: estimateTokens(text),
        estimated: true,
      };
      return { text, usage };
    } catch (err) {
      if (useCloudGrid === true) {
        // Was working before — rethrow with details
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`CloudGrid AI Gateway error: ${detail}`);
      }
      // First attempt failed — fall back to Anthropic SDK
      useCloudGrid = false;
      console.log("[ai] CloudGrid AI Gateway unavailable — using Anthropic SDK");
    }
  }

  // Local fallback: Anthropic SDK
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for local development (CloudGrid AI Gateway unavailable)",
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Anthropic response");
  }
  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimated: false,
  };
  return { text: textBlock.text, usage };
}
