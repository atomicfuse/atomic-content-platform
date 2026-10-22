/**
 * Checks for pasted ad widget code. A loader such as `_sf_loadWidget("widget1", …)` puts the ad into the element
 * whose id it names and resizes it by that name; when no element in the snippet has that id, every slot using the
 * name shares one frame name and only the first ad gets its real height (the rest are cut off).
 */
const LOADER_CALL = /\b(_sf_loadWidget|_atl_loadWidget)\(\s*["']([^"']+)["']/g;
const DECLARED_ID = /\bid\s*=\s*["']([^"']+)["']/g;

/** Loader calls whose element id isn't declared in the same snippet. */
export function adCodeWarnings(code: string | undefined): string[] {
  if (!code) return [];
  const declared = new Set([...code.matchAll(DECLARED_ID)].map((m) => m[1]));
  const warnings: string[] = [];
  for (const [, loader, id] of code.matchAll(LOADER_CALL)) {
    if (!declared.has(id)) {
      warnings.push(`${loader}("${id}") has no element with id="${id}" in this code — the ad will load at the wrong size. Make the id in the call match the <div id>.`);
    }
  }
  return warnings;
}
