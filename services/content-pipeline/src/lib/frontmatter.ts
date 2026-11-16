import matter from "gray-matter";

/**
 * Parse a markdown file's YAML frontmatter. Use this instead of calling `matter()` directly.
 *
 * Note: `matter(text)` without options caches its result per input text, process-wide and
 * forever, and returns that cached `data` object by reference. A caller that mutates `data`
 * therefore changes what the next caller with byte-identical text receives. In production this
 * made the hero-image copy to main see the staging edit and skip every commit (2026-11-16).
 * Passing an options object bypasses the cache read and write; parsing is otherwise identical.
 */
export function parseFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, {});
}
