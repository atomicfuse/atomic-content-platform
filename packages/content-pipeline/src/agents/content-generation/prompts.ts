/**
 * Prompt builders for content generation from RSS sources.
 */

import type { SiteBrief } from "@atomic-platform/shared-types";
import type { RssItem, ParsedContent } from "./rss.js";

export interface GeneratedArticle {
  title: string;
  slug: string;
  description: string;
  type: string;
  tags: string[];
  body: string;
}

/**
 * Build the system prompt instructing Claude on the site's voice and output format.
 */
export function buildSystemPrompt(siteName: string, brief: SiteBrief): string {
  // content_guidelines can be string or string[] depending on YAML source
  const guidelines = Array.isArray(brief.content_guidelines)
    ? (brief.content_guidelines as string[]).map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  return `You are a content writer for ${siteName}, a website focused on technology news and trends.

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}

## Task
You will receive a source article. Rewrite it for ${siteName}'s audience in the site's voice.
Do NOT copy text verbatim — rewrite meaningfully while preserving all facts.
Preserve all media (images and YouTube embeds) from the source — include them in the body at natural positions.

## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — compelling headline for the site",
  "slug": "string — URL-safe kebab-case slug (lowercase, hyphens only)",
  "description": "string — 1-2 sentence SEO meta description",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string", ...],
  "body": "string — full article body in markdown, with images as ![alt](url) and YouTube embeds as <div class=\\"embed-block embed-object\\"><iframe ...></iframe></div>"
}`;
}

/**
 * Build the user prompt with the source article content and media inventory.
 */
export function buildUserPrompt(item: RssItem, parsed: ParsedContent): string {
  const mediaSection = buildMediaSection(parsed);

  return `## Source Article

Title: ${item.title}
URL: ${item.link}

## Content
${parsed.textBody}

${mediaSection}

Rewrite this article for the site. Include all media at appropriate positions in the body.`;
}

function buildMediaSection(parsed: ParsedContent): string {
  const parts: string[] = ["## Media to Include"];

  if (parsed.featuredImageUrl) {
    parts.push(`Featured image: ${parsed.featuredImageUrl}`);
  }

  if (parsed.inlineImages.length > 0) {
    parts.push("Inline images:");
    parsed.inlineImages.forEach((img) => {
      parts.push(`  - ![${img.alt}](${img.src})`);
    });
  }

  if (parsed.youtubeEmbeds.length > 0) {
    parts.push("YouTube embeds (include in body wrapped in embed-block div):");
    parsed.youtubeEmbeds.forEach((embed) => {
      parts.push(`  ${embed}`);
    });
  }

  if (parts.length === 1) {
    return ""; // No media
  }

  return parts.join("\n");
}
