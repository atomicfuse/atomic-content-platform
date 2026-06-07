// Static price table (USD per million tokens for text models; per-image for image models).
// Sourced from public Anthropic / OpenAI / Google pricing, June 2026.

type TextPrice = { kind: "text"; input: number; output: number };
type ImagePrice = { kind: "image"; perImage: number };
type Price = TextPrice | ImagePrice;

/** Canonical model id → price entry */
const PRICES: Record<string, Price> = {
  // Anthropic Claude Opus 4.x — $5 / $25 per MTok
  "claude-opus-4-7": { kind: "text", input: 5.0, output: 25.0 },

  // Anthropic Claude Sonnet 4.x — $3 / $15 per MTok
  "claude-sonnet-4-6": { kind: "text", input: 3.0, output: 15.0 },

  // OpenAI GPT-4o Mini — $0.15 / $0.60 per MTok
  "gpt-4o-mini": { kind: "text", input: 0.15, output: 0.6 },

  // Google Gemini 2.5 Flash Image — $0.039 per image
  "gemini-2.5-flash-image": { kind: "image", perImage: 0.039 },
};

/** Aliases that resolve to a canonical PRICES key */
const ALIASES: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
};

/** Set of unknown model ids we have already warned about (warn-once per process) */
const warnedModels = new Set<string>();

/**
 * Normalise a model identifier to the canonical key used in PRICES.
 * Aliases (gateway alias, dated snapshot ids) are collapsed to the
 * canonical id. Unknown ids are returned as-is.
 */
export function normalizeModelId(model: string): string {
  return ALIASES[model] ?? model;
}

export interface CostResult {
  costUsd: number;
  known: boolean;
}

/**
 * Calculate the USD cost for one generation call.
 *
 * For text models: (inputTokens / 1e6) * inputPrice + (outputTokens / 1e6) * outputPrice
 * For image models: images * perImagePrice
 * Unknown model → { costUsd: 0, known: false } with a one-time console.warn.
 */
export function costFor(
  model: string,
  usage: { inputTokens: number; outputTokens: number; images: number },
): CostResult {
  const canonical = normalizeModelId(model);
  const price = PRICES[canonical];

  if (price === undefined) {
    if (!warnedModels.has(canonical)) {
      warnedModels.add(canonical);
      console.warn(
        `[costFor] Unknown model "${model}" (canonical: "${canonical}") — cost tracked as $0. ` +
          `Add it to the PRICES table in costs/pricing.ts.`,
      );
    }
    return { costUsd: 0, known: false };
  }

  let costUsd: number;
  if (price.kind === "text") {
    costUsd =
      (usage.inputTokens / 1e6) * price.input +
      (usage.outputTokens / 1e6) * price.output;
  } else {
    costUsd = usage.images * price.perImage;
  }

  return { costUsd, known: true };
}

export { PRICES };
