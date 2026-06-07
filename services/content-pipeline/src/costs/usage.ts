/**
 * Shared token-usage shape surfaced from the LLM call layer.
 *
 * `estimated` is true when the provider did not return usage (CloudGrid AI
 * Gateway path) and the counts come from `estimateTokens`; false when the
 * provider reported exact counts (Anthropic / OpenAI SDK).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}
