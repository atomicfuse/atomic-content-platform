/**
 * Default text-model ids. Kept apart from ai.ts so modules (and tests that mock
 * ai.ts) can reference them for cost recording without importing the clients.
 */

/** Default Claude model (override with CLAUDE_MODEL). */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** Default last-resort OpenAI model (override with OPENAI_FALLBACK_MODEL). */
export const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-6-luna";
