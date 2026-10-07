/** Pure helpers for scripts/brand-safe-slugs.ts (kept separate so they can be unit-tested). */

/** `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Renames an article in place: the frontmatter `slug:` becomes `newSlug` and `oldSlug` is appended
 * to `redirect_from:` (seed-kv turns it into a 301). Only those lines change — the rest of the file
 * (other fields, image paths, body) is left byte-for-byte as it was.
 */
export function renameArticleText(text: string, oldSlug: string, newSlug: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const lines = m[1]!.split("\n");

  // Existing redirect_from list (block style) → collect and remove; it is re-added after `slug:`.
  const previous: string[] = [];
  const rfIndex = lines.findIndex((l) => /^redirect_from:\s*$/.test(l));
  if (rfIndex >= 0) {
    let end = rfIndex + 1;
    while (end < lines.length && /^\s+-\s+/.test(lines[end]!)) {
      previous.push(lines[end]!.replace(/^\s+-\s+/, "").trim());
      end++;
    }
    lines.splice(rfIndex, end - rfIndex);
  }
  const redirectBlock = ["redirect_from:", ...[...previous, oldSlug].filter((v, i, a) => a.indexOf(v) === i).map((s) => `  - ${s}`)];

  const slugIndex = lines.findIndex((l) => /^slug:\s*/.test(l));
  if (slugIndex >= 0) lines.splice(slugIndex, 1, `slug: ${newSlug}`, ...redirectBlock);
  else lines.push(`slug: ${newSlug}`, ...redirectBlock);

  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}
