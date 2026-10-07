/**
 * AI client wrapper for content generation — a per-call provider chain.
 *
 * Every call tries, in order, and returns the first success:
 *   1. Anthropic SDK (ANTHROPIC_API_KEY) — pins the exact Claude model and
 *      returns real token usage. Skipped when no key is configured.
 *   2. CloudGrid AI Gateway (@cloudgrid-io/runtime; RUNTIME_GATEWAY_URL is platform-injected) — alias model.
 *   3. OpenAI (OPENAI_API_KEY) — cheap last resort so a Claude outage never
 *      stops generation.
 * There is no sticky state: a failure only affects the call it happened in.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { estimateTokens } from "../costs/estimate.js";
import type { TokenUsage } from "../costs/usage.js";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_FALLBACK_MODEL } from "./models.js";

export type { TokenUsage } from "../costs/usage.js";
/** The gateway only understands its own alias, not pinned model ids. */
const GATEWAY_MODEL_ALIAS = "claude-sonnet";
/**
 * Sonnet 5.5 thinks adaptively before answering; thinking tokens count against
 * max_tokens, so small caps meant for the answer alone would truncate it.
 */
const MIN_CLAUDE_MAX_TOKENS = 16_000;
const DEFAULT_MAX_TOKENS = 4096;

export type AiProvider = "anthropic" | "cloudgrid" | "openai";

export interface GenerateArticleParams {
  systemPrompt: string;
  userPrompt: string;
  /** Claude model override for this call (Anthropic + gateway steps). */
  model?: string;
  maxTokens?: number;
}

export interface GenerateContentResult {
  text: string;
  usage: TokenUsage;
  /** Model that actually produced the text — use it for cost recording. */
  model: string;
  provider: AiProvider;
}

type ProviderCall = (params: GenerateArticleParams) => Promise<GenerateContentResult>;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Claude model for this call: explicit param, then CLAUDE_MODEL, then the default. */
function claudeModel(params: GenerateArticleParams): string {
  return params.model ?? envValue("CLAUDE_MODEL") ?? DEFAULT_CLAUDE_MODEL;
}

/** Reasoning-family OpenAI models take max_completion_tokens instead of max_tokens. */
function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

async function callAnthropic(params: GenerateArticleParams): Promise<GenerateContentResult> {
  const model = claudeModel(params);
  const client = new Anthropic({ apiKey: envValue("ANTHROPIC_API_KEY") });
  const response = await client.messages.create({
    model,
    max_tokens: Math.max(params.maxTokens ?? DEFAULT_MAX_TOKENS, MIN_CLAUDE_MAX_TOKENS),
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    output_config: { effort: "medium" },
  } as Anthropic.MessageCreateParamsNonStreaming);

  // A truncated or refused answer is unusable — let the next provider try.
  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    throw new Error(`stopped early (${response.stop_reason})`);
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text" || !textBlock.text.trim()) {
    throw new Error("no text in response");
  }
  return {
    text: textBlock.text,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, estimated: false },
    model,
    provider: "anthropic",
  };
}

async function callGateway(params: GenerateArticleParams): Promise<GenerateContentResult> {
  const { runtime } = await import("@cloudgrid-io/runtime");
  const result = await runtime.ai.chat({
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    model: params.model ?? GATEWAY_MODEL_ALIAS,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
  });
  const { text, model, usage } = result as { text?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!text?.trim()) throw new Error("no text in response");
  const real = typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number";
  return {
    text,
    // The runtime gateway reports usage; estimate only if a response lacks it.
    usage: real
      ? { inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number, estimated: false }
      : { inputTokens: estimateTokens(params.systemPrompt + params.userPrompt), outputTokens: estimateTokens(text), estimated: true },
    model: model ?? GATEWAY_MODEL_ALIAS,
    provider: "cloudgrid",
  };
}

/**
 * One OpenAI chat completion. Exported so the OpenAI article generator and the
 * chain's last resort share the same request shape.
 */
export async function generateWithOpenAI(
  params: Omit<GenerateArticleParams, "model">,
  model: string = envValue("OPENAI_FALLBACK_MODEL") ?? DEFAULT_OPENAI_FALLBACK_MODEL,
): Promise<GenerateContentResult> {
  const apiKey = envValue("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey });
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    ...(isOpenAIReasoningModel(model)
      ? { max_completion_tokens: Math.max(maxTokens, MIN_CLAUDE_MAX_TOKENS), reasoning_effort: "low" as const }
      : { max_tokens: maxTokens }),
  });
  const text = response.choices[0]?.message?.content;
  if (!text?.trim()) throw new Error("no text in response");
  return {
    text,
    usage: response.usage
      ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, estimated: false }
      : {
          inputTokens: estimateTokens(params.systemPrompt + params.userPrompt),
          outputTokens: estimateTokens(text),
          estimated: true,
        },
    model,
    provider: "openai",
  };
}

function providerChain(): Array<[AiProvider, ProviderCall]> {
  const chain: Array<[AiProvider, ProviderCall]> = [];
  if (envValue("ANTHROPIC_API_KEY")) chain.push(["anthropic", callAnthropic]);
  chain.push(["cloudgrid", callGateway]);
  if (envValue("OPENAI_API_KEY")) chain.push(["openai", (p) => generateWithOpenAI(p)]);
  return chain;
}

/**
 * Generate text with the provider chain (Anthropic → CloudGrid gateway → OpenAI).
 * Throws only when every provider failed, naming each provider's error.
 */
export async function generateContent(params: GenerateArticleParams): Promise<GenerateContentResult> {
  const failures: string[] = [];
  for (const [provider, call] of providerChain()) {
    try {
      const result = await call(params);
      if (failures.length > 0) {
        console.warn(`[ai] served by ${provider} (${result.model}) after: ${failures.join(" | ")}`);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] ${provider} failed: ${message}`);
      failures.push(`${provider}: ${message}`);
    }
  }
  throw new Error(`All AI providers failed — ${failures.join(" | ")}`);
}
