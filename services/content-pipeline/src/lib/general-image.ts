/**
 * Shared "is this the site's default image?" predicate.
 *
 * Lives here rather than in bulk-image.ts because n8n-image.ts needs it too,
 * and bulk-image.ts already imports from n8n-image.ts — importing back would
 * be circular. Mirrors the dashboard's `general-image-utils.ts`.
 */

/** True when the article uses the site's default general image, or has none. */
export function isGeneralImage(
  featuredImage: string | undefined,
  _domain: string,
): boolean {
  if (!featuredImage) return true;
  return featuredImage.includes("general-article");
}
