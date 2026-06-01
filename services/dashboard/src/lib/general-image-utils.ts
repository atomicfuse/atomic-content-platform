/** Returns true if the article uses the site's default general image or has no image. */
export function isGeneralImage(featuredImage: string | undefined, domain: string): boolean {
  if (!featuredImage) return true;
  return featuredImage.includes(`${domain}-general-article`);
}
