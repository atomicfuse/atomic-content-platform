/**
 * Inject ad slot divs into rendered article HTML at paragraph boundaries.
 *
 * For each placement with position "after-paragraph-N", an ad div is inserted
 * after the Nth <p>...</p> block. Placements targeting paragraphs that don't
 * exist (article too short) are silently skipped.
 */

import type { AdPlacement } from '@atomic-platform/shared-types';

/** Regex to match closing </p> tags (case-insensitive). */
const CLOSING_P = /<\/p>/gi;

/**
 * Build the HTML string for an ad slot div.
 */
function adSlotHtml(placement: AdPlacement): string {
  const deviceClass =
    placement.device === 'desktop'
      ? 'hidden md:block'
      : placement.device === 'mobile'
        ? 'block md:hidden'
        : '';

  const desktopSizes = (placement.sizes.desktop ?? [])
    .map((s) => s.join('x'))
    .join(',');
  const mobileSizes = (placement.sizes.mobile ?? [])
    .map((s) => s.join('x'))
    .join(',');

  const firstSize = (placement.sizes.desktop?.[0] ?? placement.sizes.mobile?.[0]);
  const minWidth = firstSize ? `${firstSize[0]}px` : 'auto';
  const minHeight = firstSize ? `${firstSize[1]}px` : 'auto';

  return [
    `<div class="ad-slot ${deviceClass}"`,
    ` data-ad-id="${placement.id}"`,
    ` data-sizes-desktop="${desktopSizes}"`,
    ` data-sizes-mobile="${mobileSizes}"`,
    ` style="min-width:${minWidth};min-height:${minHeight};margin:1rem auto;text-align:center;">`,
    `<span style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;">Advertisement</span>`,
    `</div>`,
  ].join('');
}

/**
 * Parse "after-paragraph-N" position strings.
 * Returns the paragraph number (1-based) or null if not a paragraph position.
 */
function parseParagraphPosition(position: string): number | null {
  const match = /^after-paragraph-(\d+)$/.exec(position);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * Inject ad slot HTML into article body HTML at the specified paragraph positions.
 */
export function injectAdsIntoHtml(
  html: string,
  placements: AdPlacement[],
): string {
  // Build a map of paragraph number -> ad HTML to insert
  const insertions = new Map<number, string>();
  for (const placement of placements) {
    const n = parseParagraphPosition(placement.position);
    if (n === null) continue;
    // If multiple ads target the same paragraph, concatenate them
    const existing = insertions.get(n) ?? '';
    insertions.set(n, existing + adSlotHtml(placement));
  }

  if (insertions.size === 0) return html;

  // Walk through closing </p> tags and insert ads after the Nth one
  let paragraphCount = 0;
  const result = html.replace(CLOSING_P, (match) => {
    paragraphCount++;
    const adHtml = insertions.get(paragraphCount);
    return adHtml ? match + adHtml : match;
  });

  return result;
}
