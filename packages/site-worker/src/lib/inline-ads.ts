/**
 * Server-side injection of `after-paragraph-N` ad slots into article body
 * HTML. Mirrors what the legacy `ad-loader.js` did client-side, but at
 * request time in the Worker so the slots are present in the initial
 * HTML (and therefore caches consistently with the rest of the shell).
 *
 * Pure function — testable without a runtime.
 */

interface InlinePlacement {
  id?: string;
  position?: string;
  device?: string;
  sizes?: {
    desktop?: number[][];
    mobile?: number[][];
  };
}

/**
 * For each placement whose `position` matches `after-paragraph-N`, inserts
 * a `<div data-ad-id="…">` immediately after the `</p>` that closes the
 * Nth paragraph. Idempotent in the sense that the inserted markup itself
 * doesn't open a new `<p>`, so re-running won't double-count paragraphs.
 *
 * The HTML is split by `</p>` rather than parsed into a DOM — Astro's SSR
 * runs in workerd which doesn't ship a DOMParser. Plain string surgery is
 * fine because article bodies come from `marked.parse()` and use a
 * stable, well-formed `<p>...</p>` shape.
 *
 * Returns the input unchanged when no inline placements match.
 */
export function injectInlineAds(html: string, placements: readonly InlinePlacement[]): string {
  const inline: Array<{ id: string; position: string; afterIndex: number; sizesDesktop: number[][]; sizesMobile: number[][] }> = [];
  for (const p of placements) {
    const match = /^after-paragraph-(\d+)$/.exec(p.position ?? '');
    if (!match) continue;
    const n = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    inline.push({
      id: p.id ?? `${p.position}-anon`,
      position: p.position!,
      afterIndex: n,
      sizesDesktop: p.sizes?.desktop ?? [],
      sizesMobile: p.sizes?.mobile ?? [],
    });
  }
  if (inline.length === 0) return html;

  // Split keeping `</p>` as its own segment in the resulting array.
  // ['<p>foo', '</p>', '<p>bar', '</p>', '<h2>...']
  const parts = html.split(/(<\/p>)/i);
  let pSeen = 0;
  const out: string[] = [];
  for (const part of parts) {
    out.push(part);
    if (part.toLowerCase() === '</p>') {
      pSeen += 1;
      const matches = inline.filter((p) => p.afterIndex === pSeen);
      for (const p of matches) {
        out.push(renderInlineSlot(p.id, p.position, p.sizesDesktop, p.sizesMobile));
      }
    }
  }
  return out.join('');
}

function renderInlineSlot(
  id: string,
  position: string,
  sizesDesktop: number[][],
  sizesMobile: number[][],
): string {
  // Same shape AdSlot.astro emits server-side, so mock-ad-fill.js picks
  // these up identically — including the size attributes which the
  // mock script needs to render the correct dimensions.
  return (
    `<div data-ad-id="${escapeAttr(id)}"`
    + ` data-ad-position="${escapeAttr(position)}"`
    + ` data-sizes-desktop="${escapeAttr(JSON.stringify(sizesDesktop))}"`
    + ` data-sizes-mobile="${escapeAttr(JSON.stringify(sizesMobile))}"`
    + ` class="atl-ad-slot atl-ad-${escapeAttr(position)}"></div>`
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
