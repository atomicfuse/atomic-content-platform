/**
 * Excerpt extraction utilities for preview pages.
 *
 * Provides a fallback chain when frontmatter excerpt is not available:
 * 1. Auto-extract first N paragraphs from rendered HTML
 * 2. Fall back to article description
 */

/** Regex to match <p>...</p> blocks (non-greedy, case-insensitive). */
const P_TAG = /<p[\s>][\s\S]*?<\/p>/gi;

/**
 * Extract the first N paragraphs from rendered article HTML.
 * Returns the matched paragraph HTML joined together.
 */
export function extractParagraphs(html: string, count: number): string {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(P_TAG.source, P_TAG.flags);

  while ((match = regex.exec(html)) !== null && matches.length < count) {
    matches.push(match[0]);
  }

  return matches.join('\n');
}

/**
 * Get the best excerpt for an article.
 *
 * Priority:
 * 1. Frontmatter `excerpt` field (AI-generated)
 * 2. Auto-extracted first N paragraphs from rendered HTML
 * 3. Article `description` field
 */
export function getArticleExcerpt(
  article: { excerpt?: string; description?: string },
  renderedHtml: string | null,
  excerptParagraphs: number,
): { text: string; isHtml: boolean } {
  // 1. Frontmatter excerpt (plain text)
  if (article.excerpt) {
    return { text: article.excerpt, isHtml: false };
  }

  // 2. Auto-extract from rendered HTML
  if (renderedHtml) {
    const extracted = extractParagraphs(renderedHtml, excerptParagraphs);
    if (extracted) {
      return { text: extracted, isHtml: true };
    }
  }

  // 3. Description fallback
  if (article.description) {
    return { text: article.description, isHtml: false };
  }

  return { text: '', isHtml: false };
}
