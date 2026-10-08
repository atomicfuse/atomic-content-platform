/**
 * Site logo prompt — shared by the OpenAI (transparent output) and Gemini (solid background, stripped
 * afterwards) paths. The header-contrast rules are what keep the wordmark readable on the header.
 */
import { bestInk, contrastRatio } from "./logo-contrast";

/** Simple luminance check — returns true if the hex color is dark. */
export function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Relative luminance (ITU-R BT.709)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

export interface LogoPromptInput {
  siteName: string;
  vertical: string;
  audience?: string;
  headerBg?: string;
  colors?: Record<string, string>;
  /** true: the model returns a transparent PNG (OpenAI); false: solid header colour, removed later (Gemini). */
  transparentOutput: boolean;
  /** Optional personality cues — each one is left out when missing. */
  tagline?: string | null;
  topics?: string[];
  tone?: string | null;
}

/** "SITE PERSONALITY" block from the site's tagline, topics and tone; empty when none are set. */
function personalityBlock(tagline?: string | null, topics?: string[], tone?: string | null): string {
  const lines: string[] = [];
  if (tagline?.trim()) lines.push(`• Tagline: "${tagline.trim()}"`);
  const covers = (topics ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 6);
  if (covers.length > 0) lines.push(`• Covers: ${covers.join(", ")}`);
  if (tone?.trim()) lines.push(`• Voice: ${tone.trim()}`);
  if (lines.length === 0) return "";
  return `\n\nSITE PERSONALITY (let these shape the mascot, its expression and the overall style so the logo feels made for this site — never render these words in the image):\n${lines.join("\n")}`;
}

export function buildLogoPrompt({ siteName, vertical, audience, headerBg, colors, transparentOutput, tagline, topics, tone }: LogoPromptInput): string {
  const headerHex = headerBg ?? "#1a1a2e";
  // Ink is chosen by WCAG contrast, not a 50% luminance split: on a mid-tone header (e.g. a coffee
  // orange) only near-black or pure white survives, so browns/greys are banned outright there.
  const { ink, midTone } = bestInk(headerHex);
  const dark = ink === "light";

  // Palette is filtered by lightness so dark hex values can't bleed into a light-version
  // logo (and vice versa). The previous palette line was the main cause of contrast failures.
  const paletteEntries = Object.entries(colors ?? {}).filter(([, v]) => typeof v === "string" && v.startsWith("#"));
  const filteredPalette = paletteEntries.filter(([, hex]) =>
    midTone ? contrastRatio(hex, headerHex) >= 4.5 : isDarkColor(hex) !== dark,
  );
  const paletteLine = filteredPalette.length > 0
    ? `\n• BRAND PALETTE (reference values for the designer — these codes must NEVER appear as text in the rendered image): inspired by ${filteredPalette.map(([k, v]) => `${k} ${v}`).join(", ")}. Use complementary ${dark ? "light" : "dark"} neutrals where helpful.`
    : "";

  const backgroundRule = transparentOutput
    ? `• BACKGROUND: Fully TRANSPARENT background. The logo will sit on a solid ${headerHex} website header — contrast against that colour. No glow, no drop shadow, no outer halo, no backdrop shape behind the logo.`
    : `• BACKGROUND: Solid uniform ${headerHex} background, edge to edge. No textures, patterns, gradients, or drop shadows. (This solid background will be stripped to transparency in post-processing — only the logo elements should remain.)`;

  const contrastDirective = dark
    ? `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
${transparentOutput ? `The logo will be placed on a solid ${headerHex} website header (DARK).` : `The logo CANVAS is a solid ${headerHex} background (DARK).`} Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be LIGHT colors: pure WHITE, off-white, cream, pale pastels, or BRIGHT/VIBRANT saturated colors. Do NOT use black, dark grey, navy, dark brown, or any dark hex — those would be invisible.`
    : `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
${transparentOutput ? `The logo will be placed on a solid ${headerHex} website header (LIGHT).` : `The logo CANVAS is a solid ${headerHex} background (LIGHT).`} Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be DARK colors: ${midTone ? "near-black, deep charcoal or very deep navy" : "deep black, charcoal, navy, dark brown, or rich saturated colors"}. Do NOT use white, off-white, cream, or pale pastels — those would be invisible.`;

  const midToneRule = !midTone ? "" : dark
    ? `\nThis header is a MID-TONE colour: only PURE WHITE or very pale near-white survives on it. Do NOT use pastels, yellows, light greys, browns, oranges or any mid-brightness colour — not for fills, outlines or text.`
    : `\nThis header is a MID-TONE colour: only NEAR-BLACK (deep charcoal, black, very deep navy) survives on it. Do NOT use brown, tan, grey, orange, muted or mid-brightness colours anywhere — not for fills, outlines or text. Accent colours must be far darker than the header.`;

  return `${contrastDirective}${midToneRule}

Create a polished, professional, horizontal BRAND LOGO for "${siteName}", a website about ${vertical}${audience ? ` targeting ${audience}` : ""}.${personalityBlock(tagline, topics, tone)}

LAYOUT & STRUCTURE:
• COMPOSITION: One clear icon on the left, with the text "${siteName}" on the right.
• BALANCE: The icon and text should be vertically centered and horizontally aligned.
• ASPECT RATIO: Wide horizontal format (suitable for a website navigation bar).

VISUAL STYLE:
• ICON: A single, bold, recognizable symbol or stylized mascot representing ${vertical}. Crafted illustration with personality — confident outlines, soft internal shading, and a subtle sense of depth (think a modern brand mascot, NOT a flat two-tone icon).
• TYPOGRAPHY: Bold, modern, clean sans-serif. The text must read exactly "${siteName}".
• ART STYLE: Premium vector-illustration with subtle gradients, soft highlights, and shading WITHIN shapes for depth and richness. NOT photorealistic, NOT 3D-rendered, NOT a generic flat icon.
• COLORS: 2-4 ${dark ? "light/bright" : "dark/saturated"} brand colors with subtle shading variations.${paletteLine}

CRITICAL CONSTRAINTS:
${backgroundRule}
• TEXT IN IMAGE: The ONLY text rendered in the image is exactly "${siteName}". Do NOT render any hex codes, color codes, numbers, palette labels, version tags, or watermarks anywhere in the image.
• CONTRAST CHECK: ${dark ? "Re-verify before finalizing — every logo element must be clearly visible against a dark background." : "Re-verify before finalizing — every logo element must be clearly visible against a light background."}
• CLARITY: Perfect spelling of "${siteName}".
• PADDING: Leave a small amount of breathing room/padding around the edges.`;
}
