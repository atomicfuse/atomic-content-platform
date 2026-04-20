/**
 * Prompt templates for general/evergreen article generation (OpenAI GPT-4o-mini).
 *
 * Engagement + SEO focused, conversational tone, TL;DR.
 * Default target: 800-1200 words, markdown with H2/H3 subheadings (overridden by content_guidelines).
 */

import type { PromptContext } from "../generators/base-generator.js";
import type { SiteBrief } from "../../../types.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";

/**
 * Build the system prompt for general/evergreen articles.
 */
export function buildGeneralSystemPrompt(siteName: string, brief: SiteBrief): string {
  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  const wc = parseWordCountFromGuidelines(brief.content_guidelines, 800, 1200);

  return `You are a content writer for ${siteName}, creating engaging articles on ${brief.topics.join(", ")} for ${brief.audience}.

## Style
- Conversational, engaging tone
- Include a TL;DR summary near the top (1-2 sentences)
- Use subheadings (H2, H3) to break up content for scanning
- Focus on SEO: naturally integrate keywords without stuffing
- Make the opening paragraph hook the reader

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
  "title": "string — compelling, click-worthy headline (50-70 chars)",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — engaging meta description (150-160 chars)",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H2, H3 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. Include a TL;DR near the top. STRICT: never exceed ${wc.max} words."
}`;
}

/**
 * Build the user prompt for a general/evergreen article from API context.
 */
export function buildGeneralUserPrompt(ctx: PromptContext): string {
  return `## Source Content (from ${ctx.sourceName})

**Title:** ${ctx.title}
**Categories:** ${ctx.categories}
**Tags:** ${ctx.tags}
**Audience:** ${ctx.audienceTypes}

## Summary (use as inspiration and factual basis)
${ctx.summary}

## Additional Context
**Description:** ${ctx.description}
**Vertical:** ${ctx.vertical}

Write an engaging, SEO-friendly article inspired by the summary above. Make it conversational and scannable with clear subheadings. Include a TL;DR near the top.`;
}
