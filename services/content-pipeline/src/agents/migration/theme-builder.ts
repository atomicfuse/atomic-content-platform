export interface CsvColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  text?: string;
  background?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function isDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

function adjustBrightness(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const adjust = (v: number): number =>
    factor > 0 ? v + (255 - v) * factor : v * (1 + factor);
  return rgbToHex(adjust(r), adjust(g), adjust(b));
}

function mixColors(hex1: string, hex2: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(
    r1 + (r2 - r1) * ratio,
    g1 + (g2 - g1) * ratio,
    b1 + (b2 - b1) * ratio,
  );
}

export function expandThemeColors(csv: CsvColors): Record<string, string> {
  const primary = csv.primary ?? "#1a1a2e";
  const secondary = csv.secondary ?? primary;
  const accent = csv.accent ?? "#f4c542";
  const text = csv.text ?? "#1a1a2e";
  const background = csv.background ?? "#ffffff";

  const bgIsDark = isDark(background);

  return {
    primary,
    secondary,
    accent,
    background,
    text,
    muted: mixColors(text, background, 0.5),
    surface: bgIsDark
      ? adjustBrightness(background, 0.1)
      : adjustBrightness(background, -0.03),
    border: bgIsDark
      ? adjustBrightness(background, 0.2)
      : adjustBrightness(background, -0.1),
    footer_bg: isDark(primary) ? primary : secondary,
    hero_title: "#ffffff",
    must_reads_title: "#ffffff",
    must_reads_bg: isDark(primary) ? primary : secondary,
    article_hero_title: "#ffffff",
    feed_title: text,
    feed_desc: mixColors(text, background, 0.2),
    feed_date: mixColors(text, background, 0.5),
    category_header_text: bgIsDark ? "#ffffff" : "#1a1a1a",
    prose_heading: text,
    prose_body: mixColors(text, background, 0.15),
  };
}

export function buildTheme(csvColors: CsvColors): {
  base: string;
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
} {
  return {
    base: "modern",
    colors: expandThemeColors(csvColors),
    fonts: { heading: "Poppins", body: "Inter" },
  };
}
