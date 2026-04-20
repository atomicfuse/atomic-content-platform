/**
 * Prompt builders for article regeneration/revision.
 */

import type { SiteBrief } from "../../types.js";
import { parseWordCountFromGuidelines } from "../word-count.js";

/**
 * Build the system prompt for article revision.
 */
export function buildRevisionSystemPrompt(params: {
  siteName: string;
  brief: SiteBrief;
}): string {
  const { siteName, brief } = params;

  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  const wc = parseWordCountFromGuidelines(brief.content_guidelines, 600, 1000);

  return `You are a content editor for ${siteName}. Your task is to revise an article based on reviewer feedback.

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}

## Rules
- Address ALL reviewer feedback points
- Maintain the same general topic and angle
- Improve quality while preserving accurate information
- Do NOT invent new facts or quotes

## Output Format
Respond ONLY with a valid JSON object (no markdown fences):
{
  "title": "string — revised headline",
  "description": "string — revised meta description (150-160 chars)",
  "tags": ["string — tags, first must be a site topic"],
  "body": "string — revised ${wc.label} article body in markdown with H2 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. STRICT: never exceed ${wc.max} words."
}`;
}

/**
 * Build the user prompt with the original article + reviewer feedback.
 */
export function buildRevisionUserPrompt(params: {
  originalArticle: string;
  reviewerNotes: string;
  frontmatter: Record<string, unknown>;
}): string {
  const { originalArticle, reviewerNotes, frontmatter } = params;

  return `## Original Article

**Title:** ${frontmatter.title ?? "Untitled"}
**Tags:** ${Array.isArray(frontmatter.tags) ? frontmatter.tags.join(", ") : "none"}

## Content
${originalArticle}

## Reviewer Feedback
${reviewerNotes}

Revise the article to address all reviewer feedback while maintaining the site's voice and editorial standards.`;
}
