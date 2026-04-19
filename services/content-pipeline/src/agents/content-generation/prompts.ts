/**
 * Prompt builders for content generation from source articles.
 */

import type { SiteBrief } from "../../types.js";
import type { ParsedContent } from "./rss.js";

export interface GeneratedArticle {
  title: string;
  slug: string;
  description: string;
  type: string;
  tags: string[];
  body: string;
}

/**
 * Source-agnostic representation of an article to rewrite.
 * Works with both aggregator API and RSS sources.
 */
export interface SourceArticle {
  title: string;
  url: string;
  imageUrl: string | null;
}

/**
 * Build the system prompt instructing Claude on the site's voice and output format.
 */
export function buildSystemPrompt(siteName: string, brief: SiteBrief): string {
  // content_guidelines can be string or string[] depending on YAML source
  const guidelines = Array.isArray(brief.content_guidelines)
    ? (brief.content_guidelines as string[]).map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  return `You are a content writer for ${siteName}, a website covering ${brief.topics.join(", ")} for ${brief.audience}.

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

## Tagging Rules
The site has these main topics: ${brief.topics.join(", ")}
- The FIRST tag MUST be one of the site's topics listed above (exact match, case-insensitive)
- If the article genuinely relates to multiple topics, include them all as the first tags
- After the topic tag(s), add 2-4 additional descriptive tags for the article content
- If the article doesn't clearly fit any topic, pick the closest one

## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — compelling headline for the site",
  "slug": "string — URL-safe kebab-case slug (lowercase, hyphens only)",
  "description": "string — 1-2 sentence SEO meta description",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST tag must be a site topic (${brief.topics.join(", ")}), then 2-4 additional tags"],
  "body": "string — full article body in markdown, with images as ![alt](url) and YouTube embeds as <div class=\\"embed-block embed-object\\"><iframe ...></iframe></div>"
}`;
}

/**
 * Build the user prompt with the source article content and media inventory.
 */
export function buildUserPrompt(source: SourceArticle, parsed: ParsedContent): string {
  const mediaSection = buildMediaSection(source, parsed);

  return `## Source Article

Title: ${source.title}
URL: ${source.url}

## Content
${parsed.textBody}

${mediaSection}

Rewrite this article for the site. Include all media at appropriate positions in the body.`;
}

/**
 * Build a user prompt when scraping failed — generates an original article
 * inspired by the source title and metadata only.
 */
export function buildMetadataOnlyPrompt(source: SourceArticle): string {
  const media = source.imageUrl ? `\n## Media to Include\nFeatured image: ${source.imageUrl}\n` : "";

  return `## Source Article (metadata only — full content unavailable)

Title: ${source.title}
URL: ${source.url}
${media}
The source article could not be scraped. Using ONLY the title above as inspiration, write an ORIGINAL article on this topic for the site. Do NOT invent fake quotes or attribute statements to the source. Write your own comprehensive take on the subject.${source.imageUrl ? " Include the featured image at an appropriate position." : ""}`;
}

function buildMediaSection(source: SourceArticle, parsed: ParsedContent): string {
  const parts: string[] = ["## Media to Include"];

  // Prefer source image (from aggregator API) over scraped image
  const featuredImage = source.imageUrl ?? parsed.featuredImageUrl;
  if (featuredImage) {
    parts.push(`Featured image: ${featuredImage}`);
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
