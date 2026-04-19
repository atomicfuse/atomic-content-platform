/**
 * Content Router — classifies items as factual (news) or general (evergreen).
 *
 * Factual → Claude Sonnet (accuracy-first).
 * General → OpenAI GPT-4o-mini (cost-effective, engagement-first).
 */

import type { ContentItem, AggregatorSettings, RouterDecision } from "./types.js";

/** Verticals that always route to the factual (Claude) generator. */
const FACTUAL_VERTICALS = new Set(["News", "Politics", "Finance", "World News"]);

/**
 * Classify a content item as factual or general.
 *
 * Factual items are routed to Claude for accuracy-critical generation.
 * General items are routed to OpenAI GPT-4o-mini for cost-effective generation.
 */
export function classifyContent(
  item: ContentItem,
  settings: AggregatorSettings,
): RouterDecision {
  // Check vertical
  const verticalName = item.vertical?.name ?? "";
  if (FACTUAL_VERTICALS.has(verticalName)) {
    return {
      isFactual: true,
      reason: `Factual vertical: ${verticalName}`,
      generator: "claude",
    };
  }

  // Check tags against factual_tags from settings
  const factualTags = settings.classification.factual_tags.map((t) => t.toLowerCase());
  const matchedTag = item.tags.find((t) => factualTags.includes(t.name.toLowerCase()));

  if (matchedTag) {
    return {
      isFactual: true,
      reason: `Factual tag: ${matchedTag.name}`,
      generator: "claude",
    };
  }

  // Default: general content → OpenAI
  return {
    isFactual: false,
    reason: `General content (vertical: ${verticalName || "none"})`,
    generator: "openai",
  };
}
