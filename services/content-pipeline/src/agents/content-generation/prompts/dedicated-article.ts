/**
 * Prompt templates for dedicated/original article generation (Claude Sonnet).
 *
 * Unlike news-article.ts which rewrites aggregator content, this generates
 * original articles from a user-provided prompt. No source material to
 * verify against — instead, claims should be qualified appropriately.
 * Default target: 600-900 words, markdown with H2 subheadings (overridden by content_guidelines).
 */

import type { SiteBrief } from "../../../types.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";

/**
 * Build the system prompt for dedicated/original article generation.
 */
export function buildDedicatedSystemPrompt(siteName: string, brief: SiteBrief): string {
  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  const wc = parseWordCountFromGuidelines(brief.content_guidelines, 600, 900);

  const themeLine = brief.theme && brief.theme.trim()
    ? `\n\n## Editorial Angle\n${brief.theme.trim()}`
    : "";

  return `You are a writer generating original content for ${siteName}, a publication covering ${brief.topics.join(", ")} for ${brief.audience}.${themeLine}

## CRITICAL RULES
- Generate original, well-researched content based on your knowledge
- Qualify claims appropriately — use "according to experts", "research suggests", "it is generally understood" where needed
- Do NOT make up specific statistics, quotes, or attributions you are not confident about
- Maintain the site's voice and stay on-topic for the publication

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
  "title": "string — compelling, informative headline (50-70 chars)",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — 1-2 sentence engaging meta description (150-160 chars)",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H2 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. STRICT: never exceed ${wc.max} words."
}`;
}

/**
 * Build the user prompt for a dedicated article from a free-text user request.
 */
export function buildDedicatedUserPrompt(userPrompt: string): string {
  return `## Article Request

${userPrompt}

Write an original article based on the request above. Follow all system prompt rules regarding tone, audience, and output format.`;
}
