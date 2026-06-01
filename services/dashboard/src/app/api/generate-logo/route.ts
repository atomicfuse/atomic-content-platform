import { NextResponse } from "next/server";
import { removeBackground } from "@/lib/remove-background";
import { extractFaviconFromLogo } from "@/lib/favicon-extractor";

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Simple luminance check — returns true if the hex color is dark. */
function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/**
 * POST /api/generate-logo
 * Body: { siteName, vertical, audience?, headerBg?, colors? }
 * Returns: { image: string (base64 PNG), favicon?: string (base64 PNG) } or { error: string }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    siteName: string;
    vertical: string;
    audience?: string;
    headerBg?: string;
    colors?: Record<string, string>;
  };

  const prompt = buildLogoPrompt(body.siteName, body.vertical, body.audience, body.headerBg, body.colors);

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });

    if (!response.ok) {
      console.warn(`[generate-logo] Gemini failed: ${response.status}`);
      return NextResponse.json(
        { error: `Gemini returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: {
          parts: Array<{
            inlineData?: { mimeType: string; data: string };
            text?: string;
          }>;
        };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content.parts.find(
      (p) => p.inlineData
    );
    if (!imagePart?.inlineData) {
      return NextResponse.json(
        { error: "No image in Gemini response" },
        { status: 502 }
      );
    }

    const raw = Buffer.from(imagePart.inlineData.data, "base64");
    const transparent = await removeBackground(raw);
    // Also extract a square favicon from the logo so the caller gets both
    let faviconBase64: string | undefined;
    try {
      const faviconBuf = await extractFaviconFromLogo(transparent);
      faviconBase64 = faviconBuf.toString("base64");
    } catch {
      // Non-fatal — favicon extraction failed, caller can fall back
    }
    return NextResponse.json({ image: transparent.toString("base64"), favicon: faviconBase64 });
  } catch (err) {
    console.error("[generate-logo] Error:", err);
    return NextResponse.json(
      { error: "Logo generation failed" },
      { status: 500 }
    );
  }
}

function buildLogoPrompt(
  siteName: string,
  vertical: string,
  audience?: string,
  headerBg?: string,
  colors?: Record<string, string>,
): string {
  const headerHex = headerBg ?? "#1a1a2e";
  const dark = isDarkColor(headerHex);

  const paletteEntries = Object.entries(colors ?? {}).filter(([, v]) => typeof v === "string" && v.startsWith("#"));
  const filteredPalette = paletteEntries.filter(([, hex]) => isDarkColor(hex) !== dark);
  const paletteLine = filteredPalette.length > 0
    ? `\n• BRAND PALETTE (reference values for the designer — these codes must NEVER appear as text in the rendered image): inspired by ${filteredPalette.map(([k, v]) => `${k} ${v}`).join(", ")}. Use complementary ${dark ? "light" : "dark"} neutrals where helpful.`
    : "";

  const contrastDirective = dark
    ? `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
The logo CANVAS is a solid ${headerHex} background (DARK). Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be LIGHT colors: pure WHITE, off-white, cream, pale pastels, or BRIGHT/VIBRANT saturated colors. Do NOT use black, dark grey, navy, dark brown, or any dark hex — those would be invisible.`
    : `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
The logo CANVAS is a solid ${headerHex} background (LIGHT). Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be DARK colors: deep black, charcoal, navy, dark brown, or rich saturated colors. Do NOT use white, off-white, cream, or pale pastels — those would be invisible.`;

  return `${contrastDirective}

Create a polished, professional, horizontal BRAND LOGO for "${siteName}", a website about ${vertical}${audience ? ` targeting ${audience}` : ""}.

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
• BACKGROUND: Solid uniform ${headerHex} background, edge to edge. No textures, patterns, gradients, or drop shadows. (This solid background will be stripped to transparency in post-processing — only the logo elements should remain.)
• TEXT IN IMAGE: The ONLY text rendered in the image is exactly "${siteName}". Do NOT render any hex codes, color codes, numbers, palette labels, version tags, or watermarks anywhere in the image.
• CONTRAST CHECK: ${dark ? "Re-verify before finalizing — every logo element must be clearly visible against a dark background." : "Re-verify before finalizing — every logo element must be clearly visible against a light background."}
• CLARITY: Perfect spelling of "${siteName}".
• PADDING: Leave a small amount of breathing room/padding around the edges.`;
}
