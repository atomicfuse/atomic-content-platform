import sharp from "sharp";

/**
 * Logo contrast against the site header, using the WCAG relative-luminance contrast ratio.
 * A plain light/dark split fails on mid-tone headers (e.g. a coffee-orange): it allowed browns that
 * nearly vanish. bestInk() picks the ink with the most contrast and flags mid-tones; logoMedianContrast()
 * measures a generated logo so a faint one can be regenerated.
 */

/** Below this median contrast the logo reads as faint on the header (WCAG large-graphics guideline is 3:1). */
export const MIN_LOGO_CONTRAST = 3;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "").padEnd(6, "0");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function ratio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  return ratio(luminance(...hexToRgb(a)), luminance(...hexToRgb(b)));
}

/**
 * Which ink reads best on the header: "light" (white) or "dark" (near-black). A header where even the
 * best ink stays under 7:1 is a mid-tone — only that ink is safe for outlines and text there.
 */
export function bestInk(headerHex: string): { ink: "light" | "dark"; ratio: number; midTone: boolean } {
  const light = contrastRatio("#ffffff", headerHex);
  const dark = contrastRatio("#111111", headerHex);
  const best = Math.max(light, dark);
  return { ink: light >= dark ? "light" : "dark", ratio: best, midTone: best < 7 };
}

/** Median WCAG contrast of the logo's visible pixels against the header colour. */
export async function logoMedianContrast(png: Buffer, headerHex: string): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = luminance(...hexToRgb(headerHex));
  const values: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 200) continue; // transparent / antialiased edge
    values.push(ratio(luminance(data[i]!, data[i + 1]!, data[i + 2]!), bg));
  }
  if (values.length === 0) return 0;
  values.sort((x, y) => x - y);
  return values[Math.floor(values.length / 2)]!;
}
