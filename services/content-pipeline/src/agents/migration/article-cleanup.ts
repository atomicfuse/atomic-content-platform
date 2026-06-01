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

/**
 * Guarantee that at least one tag matches a site topic (case-insensitive).
 * If no match is found, prepends the best-guess topic or the first topic.
 * Same logic as content-generation agent's ensureTopicTag.
 */
export function ensureTopicTag(
  generatedTags: string[],
  topics: string[],
  articleTitle: string,
): string[] {
  if (topics.length === 0) return generatedTags;

  const tags = generatedTags.length > 0 ? [...generatedTags] : [];
  const lowerTopics = topics.map((t) => t.toLowerCase());

  const hasTopicTag = tags.some((tag) =>
    lowerTopics.includes(tag.toLowerCase()),
  );
  if (hasTopicTag) return tags;

  const combined = [articleTitle, ...tags].join(" ").toLowerCase();
  const matchedTopic = topics.find((topic) =>
    combined.includes(topic.toLowerCase()),
  );
  if (matchedTopic) return [matchedTopic, ...tags];

  return [topics[0]!, ...tags];
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

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

/** Check if an error is retryable (rate limit or server error). */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Anthropic SDK wraps status codes in the error message
  return /429|rate.limit|overloaded|529|500|502|503|504/i.test(msg);
}

/**
 * Send the article to Claude for cleanup and return parsed result.
 * Retries up to 3 times with exponential backoff on rate-limit / server errors.
 */
export async function cleanupArticle(
  anthropicApiKey: string,
  title: string,
  markdownBody: string,
  excerpt: string,
  client?: Anthropic,
): Promise<{ description: string; markdown: string }> {
  const anthropic = client ?? new Anthropic({ apiKey: anthropicApiKey });
  const prompt = buildCleanupPrompt(title, markdownBody, excerpt);

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = msg.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text in Anthropic response");
      }

      return parseCleanupResponse(textBlock.text, markdownBody);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt); // 2s, 4s, 8s
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[article-cleanup] Retryable error for "${title.slice(0, 50)}" ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delayMs}ms: ${errMsg}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
