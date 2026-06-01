/**
 * Pure helper used by `scripts/seed-kv.ts` (and by the unit tests) to
 * coerce the YAML `featured` frontmatter field of an article into the
 * typed `('hero' | 'must-read')[]` array stored on `ArticleIndexEntry`.
 *
 * Anything in this file must be:
 *   - synchronous and pure (no fs / network / wrangler calls);
 *   - deterministic given identical input;
 *   - importable by both the script and `vitest` without extra setup.
 *
 * Defensive coercions:
 *   - missing / null input → `undefined` (article is not featured;
 *     `selectFeatured()` is free to auto-fallback);
 *   - empty array input → `undefined` (semantically "not featured");
 *   - unknown values (anything not in the VALID set) are silently
 *     stripped so a typo in YAML cannot break the page;
 *   - if a non-empty input had values but ALL of them were invalid,
 *     we return `[]` so callers can distinguish "bad data" from
 *     "intentionally empty / not featured".
 */

const VALID = new Set(['hero', 'must-read'] as const);

/**
 * Parses the raw `featured` frontmatter value (string | string[] | unknown)
 * into a typed `('hero' | 'must-read')[]` array, or `undefined` when the
 * article should be treated as not-featured.
 */
export function parseFeatured(
  raw: unknown,
): ('hero' | 'must-read')[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const filtered = arr
    .map((v) => String(v).trim())
    .filter((v): v is 'hero' | 'must-read' => VALID.has(v as 'hero' | 'must-read'));
  return filtered.length > 0 ? filtered : Array.isArray(raw) && raw.length === 0 ? undefined : [];
}
