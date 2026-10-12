/**
 * Path segments the site worker owns on every site — no article may use them as its slug:
 * `grid` (Grid template routes) and `author` (author pages, /author/<id>).
 */
const RESERVED_ARTICLE_SLUGS: ReadonlySet<string> = new Set(["grid", "author"]);

export function isReservedArticleSlug(slug: string): boolean {
  return RESERVED_ARTICLE_SLUGS.has(slug.toLowerCase());
}
