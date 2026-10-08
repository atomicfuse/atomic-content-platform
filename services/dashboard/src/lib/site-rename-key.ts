/**
 * Where an R2 object goes when a site is renamed: `<old>/…` → `<new>/…`, and the site's default
 * article image is renamed too — new articles reference `<new>-general-article.webp`, so keeping
 * the old file name left them with a broken image (hiddenstorydaily, milesandwords, viralsides…).
 */
export function siteRenameKey(key: string, oldDomain: string, newDomain: string): string {
  const oldPrefix = `${oldDomain}/`;
  if (!key.startsWith(oldPrefix)) return key;
  const moved = `${newDomain}/${key.slice(oldPrefix.length)}`;
  const oldDefault = `${newDomain}/assets/images/${oldDomain}-general-article.webp`;
  return moved === oldDefault ? `${newDomain}/assets/images/${newDomain}-general-article.webp` : moved;
}
