/**
 * Pick a readable text color (near-black or white) for a given background color.
 *
 * Buttons that use a theme color as their background (e.g. `--color-secondary`
 * on Read More / Subscribe) previously hardcoded white text. When a preset set
 * that color to white, the result was white-on-white. This helper derives the
 * foreground from the background's relative luminance (WCAG), so the text is
 * always legible regardless of the chosen color.
 */

const DARK_TEXT = '#111111';
const LIGHT_TEXT = '#ffffff';

/** Parse #rgb / #rrggbb (with or without leading #) into 0-255 channels. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** WCAG relative luminance for an sRGB color (0 = black, 1 = white). */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Return the more legible of near-black / white for text on `backgroundHex`.
 * Defaults to white text for invalid input (preserves the prior hardcoded
 * behavior, which assumed a dark background).
 *
 * The 0.179 threshold is the WCAG crossover where white and black text give
 * equal contrast against the background.
 */
export function readableTextColor(backgroundHex: string): typeof DARK_TEXT | typeof LIGHT_TEXT {
  const rgb = parseHex(backgroundHex);
  if (!rgb) return LIGHT_TEXT;
  return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.179 ? DARK_TEXT : LIGHT_TEXT;
}

/** Footer text defaults per background tone. The dark set is exactly the
 *  Footer.astro defaults that predate this helper (dark footers don't change). */
const FOOTER_ON_DARK = { heading: '#fff', text: '#d1d5db', muted: '#9ca3af', linkHover: '#fff' };
const FOOTER_ON_LIGHT = { heading: '#111111', text: '#374151', muted: '#4b5563', linkHover: '#111111' };

/**
 * CSS custom-property declarations for text that sits on theme-colored
 * backgrounds. Emitted by the layouts next to the `--color-*` vars; components
 * use them as fallbacks so explicitly configured text colors still win.
 */
export function themeForegroundVars(colors: Record<string, string | undefined>): string[] {
  const secondaryBg = colors.secondary ?? '#1a1a2e';
  const accentBg = colors.accent ?? secondaryBg;
  const primaryBg = colors.primary ?? '#1a1a2e';
  const mustReadsBg = colors.must_reads_bg ?? secondaryBg;
  const footerBg = colors.footer_bg ?? secondaryBg;
  const footer = readableTextColor(footerBg) === DARK_TEXT ? FOOTER_ON_LIGHT : FOOTER_ON_DARK;
  return [
    `--color-secondary-fg: ${readableTextColor(secondaryBg)};`,
    `--color-accent-fg: ${readableTextColor(accentBg)};`,
    `--color-primary-fg: ${readableTextColor(primaryBg)};`,
    `--color-must_reads_bg-fg: ${readableTextColor(mustReadsBg)};`,
    `--footer-auto-heading: ${footer.heading};`,
    `--footer-auto-text: ${footer.text};`,
    `--footer-auto-muted: ${footer.muted};`,
    `--footer-auto-link-hover: ${footer.linkHover};`,
  ];
}
