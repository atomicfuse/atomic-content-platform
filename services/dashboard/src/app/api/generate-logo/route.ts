import { NextResponse } from "next/server";
import { removeBackground } from "@/lib/remove-background";
import { extractFaviconFromLogo } from "@/lib/favicon-extractor";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
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
  const dark = isDarkColor(headerBg ?? "#1a1a2e");
  const contrastInstruction = dark
    ? "LIGHT VERSION: Use off-white, cream, or bright vibrant colors. Optimized for a dark/black background."
    : "DARK VERSION: Use deep black, charcoal, or rich saturated colors. Optimized for a light/white background.";

  const paletteEntries = Object.entries(colors ?? {}).filter(([, v]) => typeof v === "string" && v.startsWith("#"));
  const paletteLine = paletteEntries.length > 0
    ? `\n• BRAND PALETTE: Draw from these brand colors where they fit the contrast guidance above — ${paletteEntries.map(([k, v]) => `${k} ${v}`).join(", ")}. Use complementary neutrals if needed.`
    : "";

  return `Create a professional, horizontal BRAND LOGO for "${siteName}", a website about ${vertical}${audience ? ` targeting ${audience}` : ""}.

LAYOUT & STRUCTURE:
• COMPOSITION: One clear icon on the left, with the text "${siteName}" on the right.
• BALANCE: The icon and text should be vertically centered and horizontally aligned.
• ASPECT RATIO: Wide horizontal format (suitable for a website navigation bar).

VISUAL STYLE:
• ICON: A single, bold, recognizable symbol representing ${vertical}. Incorporate a creative element that subtly connects the icon to the text for a unified brand look.
• TYPOGRAPHY: Use a bold, modern, clean sans-serif font. The text must read exactly "${siteName}".
• ART STYLE: Minimalist, flat design, vector-like. No 3D, no gradients, no photorealism.
• COLORS: ${contrastInstruction} Max 2-3 colors.${paletteLine}

CRITICAL CONSTRAINTS:
• TRANSPARENCY: Solid colors on a pure transparent background.
• NO MOCKUPS: No business cards, no walls, no paper textures, no shadows.
• CLARITY: Ensure high contrast and perfect spelling of "${siteName}".
• PADDING: Leave a small amount of breathing room/padding around the edges.`;
}
