/**
 * Slug Generator — converts article titles to URL-safe kebab-case slugs.
 *
 * Removes stop words, limits to 60 chars, ensures clean URL paths.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "were", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "shall",
  "that", "this", "these", "those", "i", "we", "you", "he", "she",
  "they", "me", "him", "her", "us", "them", "my", "your", "his",
  "its", "our", "their", "what", "which", "who", "whom", "how",
  "when", "where", "why", "not", "no", "nor", "so", "if", "then",
  "than", "too", "very", "just", "about", "above", "after", "again",
  "all", "also", "any", "because", "before", "between", "both",
  "each", "few", "into", "more", "most", "other", "out", "over",
  "same", "some", "such", "through", "under", "up", "while",
]);

const MAX_SLUG_LENGTH = 60;

/**
 * Generate a URL-safe kebab-case slug from a title.
 * Removes stop words and limits length to 60 characters.
 */
export function generateSlug(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove non-alphanumeric except hyphens
    .replace(/\s+/g, " ")     // Collapse whitespace
    .trim()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  // Build slug word by word, stopping before exceeding max length
  let slug = "";
  for (const word of words) {
    const candidate = slug ? `${slug}-${word}` : word;
    if (candidate.length > MAX_SLUG_LENGTH) break;
    slug = candidate;
  }

  // Fallback: if stop-word removal emptied everything, use first few words
  if (!slug) {
    slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .slice(0, MAX_SLUG_LENGTH);
  }

  // Clean trailing hyphens
  return slug.replace(/-+$/, "").replace(/^-+/, "");
}
