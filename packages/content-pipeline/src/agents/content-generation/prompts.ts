/**
 * Prompt builders for content generation.
 *
 * Constructs system and user prompts from site briefs and article templates.
 */

import type { SiteBrief, ArticleType } from "@atomic-platform/shared-types";

/**
 * Build the system prompt for article generation.
 */
export function buildSystemPrompt(params: {
  siteName: string;
  domain: string;
  brief: SiteBrief;
  articleType: ArticleType;
  template: string;
}): string {
  // TODO: implement prompt construction
  return "";
}

/**
 * Build the user prompt for article generation.
 */
export function buildUserPrompt(params: {
  articleType: ArticleType;
  topic?: string;
  additionalInstructions?: string;
}): string {
  // TODO: implement
  return "";
}
