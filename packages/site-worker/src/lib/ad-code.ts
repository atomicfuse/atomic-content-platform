/**
 * Ad snippets are pasted once per placement (`<div id="widget1">` + `_sf_loadWidget("widget1", …)`), but Grid
 * repeats a placement in every feed ad tile and next to other placements. Duplicate element ids leave all but
 * the first slot empty, so each slot gets its own: every id the snippet declares, wherever it's quoted
 * ("widget1", '#widget1'), becomes "<id>-<slotId>".
 */
export function uniqueAdCode(code: string, slotId: string): string {
  const ids = new Set([...code.matchAll(/\bid\s*=\s*["']([A-Za-z][\w:.-]*)["']/g)].map((m) => m[1]!));
  let out = code;
  for (const id of ids) {
    const re = new RegExp(`(["'])(#?)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
    out = out.replace(re, `$1$2${id}-${slotId}$1`);
  }
  return out;
}
