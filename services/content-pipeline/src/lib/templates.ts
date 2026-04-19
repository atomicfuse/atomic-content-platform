/**
 * Article template loader.
 *
 * Reads article type templates from the platform repo's templates/ directory.
 * Templates provide structural guidance for AI content generation.
 */

import { readFile } from "fs/promises";
import { resolve } from "path";
import type { ArticleType } from "../types.js";

/** Path to templates directory relative to the monorepo root. */
const TEMPLATES_DIR = resolve(__dirname, "../../../../templates");

/**
 * Load an article template by type.
 */
export async function loadTemplate(type: ArticleType): Promise<string> {
  const path = resolve(TEMPLATES_DIR, `${type}.md`);
  return readFile(path, "utf-8");
}

/**
 * Select a random article type based on weighted percentages from the site brief.
 *
 * @param weights - e.g., { listicle: 40, standard: 30, "how-to": 20, review: 10 }
 */
export function selectArticleType(
  weights: Record<string, number>,
): ArticleType {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let random = Math.random() * total;

  for (const [type, weight] of entries) {
    random -= weight;
    if (random <= 0) {
      return type as ArticleType;
    }
  }

  // Fallback — entries is guaranteed non-empty since weights has entries
  return entries[0]![0] as ArticleType;
}
