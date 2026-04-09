/**
 * Prompt builders for article regeneration/revision.
 */

import type { SiteBrief } from "../../types.js";

/**
 * Build the system prompt for article revision.
 */
export function buildRevisionSystemPrompt(params: {
  siteName: string;
  brief: SiteBrief;
}): string {
  // TODO: implement
  return "";
}

/**
 * Build the user prompt with the original article + reviewer feedback.
 */
export function buildRevisionUserPrompt(params: {
  originalArticle: string;
  reviewerNotes: string;
}): string {
  // TODO: implement
  return "";
}
