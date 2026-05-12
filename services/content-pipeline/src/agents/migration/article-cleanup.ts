/**
 * Claude article cleanup agent + category mapper.
 *
 * Pure helpers for mapping WP categories → menu-item tags,
 * building/parsing cleanup prompts, and an async wrapper
 * that calls the Anthropic SDK for article cleanup.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { WpCategory } from "./types.js";

// ---------------------------------------------------------------------------
// Category → tag mapping
// ---------------------------------------------------------------------------

/**
 * Map WP article category IDs to menu-item names (case-insensitive match).
 * Falls back to the WP category name when no menu item matches.
 */
export function mapCategoriesToTags(
  articleCategoryIds: number[],
  wpCategories: WpCategory[],
  menuItems: string[],
): string[] {
  const categoryMap = new Map<number, WpCategory>();
  for (const cat of wpCategories) {
    categoryMap.set(cat.id, cat);
  }

  const menuLower = menuItems.map((m) => m.toLowerCase());

  return articleCategoryIds.map((id): string => {
    const wpCat = categoryMap.get(id);
    if (!wpCat) return `unknown-${id}`;

    const idx = menuLower.indexOf(wpCat.name.toLowerCase());
    if (idx !== -1) return menuItems[idx] ?? wpCat.name;

    return wpCat.name;
  });
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build the system+user prompt for Claude article cleanup.
 */
export function buildCleanupPrompt(
  title: string,
  markdownBody: string,
  excerpt: string,
): string {
  return `You are an article cleanup assistant. Clean up the following WordPress article that was converted from HTML to Markdown.

Instructions:
- Remove any formatting artifacts from the HTML-to-Markdown conversion.
- Remove "Read more", "Related posts", "You may also like", or similar boilerplate sections.
- Remove any leftover shortcodes or HTML tags.
- Preserve the core article content and structure.
- Fix broken Markdown formatting (unclosed bold/italic, broken links, etc.).
- Do NOT change the meaning or tone of the article.
${excerpt && excerpt.length > 20 ? "- Use the provided excerpt as the article description." : "- Generate a concise 1-2 sentence description summarizing the article."}

Return your response in the following XML format:
<description>A concise 1-2 sentence description of the article</description>
<markdown>The cleaned-up article body in Markdown</markdown>

Article title: ${title}

Article body:
${markdownBody}

${excerpt ? `Original excerpt: ${excerpt}` : ""}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse Claude's cleanup response, extracting <description> and <markdown>.
 * Falls back to original text when parsing fails.
 */
export function parseCleanupResponse(
  response: string,
  originalMarkdown: string = "",
): { description: string; markdown: string } {
  const descMatch = response.match(
    /<description>([\s\S]*?)<\/description>/,
  );
  const mdMatch = response.match(
    /<markdown>([\s\S]*?)<\/markdown>/,
  );

  if (!descMatch || !mdMatch) {
    return {
      description: "",
      markdown: originalMarkdown || response,
    };
  }

  return {
    description: (descMatch[1] ?? "").trim(),
    markdown: (mdMatch[1] ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Full cleanup (calls Anthropic)
// ---------------------------------------------------------------------------

/**
 * Send the article to Claude for cleanup and return parsed result.
 */
export async function cleanupArticle(
  anthropicApiKey: string,
  title: string,
  markdownBody: string,
  excerpt: string,
): Promise<{ description: string; markdown: string }> {
  const client = new Anthropic({ apiKey: anthropicApiKey });
  const prompt = buildCleanupPrompt(title, markdownBody, excerpt);

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Anthropic response");
  }

  return parseCleanupResponse(textBlock.text, markdownBody);
}
