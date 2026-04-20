/**
 * Prompt templates for factual/news article generation (Claude Sonnet).
 *
 * Journalist tone, factual fidelity, no invented facts.
 * Default target: 600-900 words, markdown with H1/H2 (overridden by content_guidelines).
 */

import type { PromptContext } from "../generators/base-generator.js";
import type { SiteBrief } from "../../../types.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";

/**
 * Build the system prompt for news/factual articles.
 */
export function buildNewsSystemPrompt(siteName: string, brief: SiteBrief): string {
  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  const wc = parseWordCountFromGuidelines(brief.content_guidelines, 600, 900);

  return `You are a factual journalist writing for ${siteName}, a publication covering ${brief.topics.join(", ")} for ${brief.audience}.

## CRITICAL RULES
- NEVER invent facts, statistics, quotes, or attributions
- Every claim must come from the source summary — do not hallucinate
- If the summary is vague on a point, say "according to reports" rather than making up specifics
- Maintain journalistic objectivity and accuracy

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}

## Tagging Rules
The site has these main topics: ${brief.topics.join(", ")}
- The FIRST tag MUST be one of the site's topics (exact match, case-insensitive)
- After the topic tag(s), add 2-4 additional descriptive tags
- If the article doesn't clearly fit any topic, pick the closest one

## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — factual, informative headline (50-70 chars)",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — 1-2 sentence factual meta description (150-160 chars)",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H1 title and H2 subheadings. STRICT: never exceed ${wc.max} words."
}`;
}

/**
 * Build the user prompt for a news/factual article from API context.
 */
export function buildNewsUserPrompt(ctx: PromptContext): string {
  return `## Source Content (from ${ctx.sourceName})

**Title:** ${ctx.title}
**Published:** ${ctx.publishedAt}
**Vertical:** ${ctx.vertical}
**Categories:** ${ctx.categories}
**Tags:** ${ctx.tags}

## Summary (primary source — all facts must come from here)
${ctx.summary}

## Additional Context
**Description:** ${ctx.description}
**Audience:** ${ctx.audienceTypes}

Write a factual news article based STRICTLY on the summary above. Do NOT invent any facts, quotes, or statistics not present in the summary. Use a journalistic tone with clear attribution.`;
}
