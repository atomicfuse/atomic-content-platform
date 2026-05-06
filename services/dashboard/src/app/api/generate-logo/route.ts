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
 * Body: { siteName, vertical, audience?, headerBg? }
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
  };

  const prompt = buildLogoPrompt(body.siteName, body.vertical, body.audience, body.headerBg);

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
): string {
  const dark = isDarkColor(headerBg ?? "#1a1a2e");
  const textHex = dark ? "#FFFFFF" : "#222222";
  const iconColors = dark
    ? "Use bright, vivid colors for the icon (NOT dark colors) so it pops on a dark background."
    : "Use rich, saturated colors for the icon.";

  return `Design a professional website logo for "${siteName}", a ${vertical} site${audience ? ` targeting ${audience}` : ""}.

⚠️ MANDATORY TEXT COLOR: The text "${siteName}" MUST be rendered in ${textHex} (${dark ? "pure white" : "near-black"}). This logo will be placed on a ${dark ? "dark" : "light"} background (${headerBg ?? "#1a1a2e"}). ${dark ? "Dark text will be INVISIBLE — you MUST use white #FFFFFF text." : "Light text will be INVISIBLE — you MUST use dark #222222 text."}

COMPOSITION (left to right, tightly packed):
• A bold, distinctive icon/symbol relevant to ${vertical}. ${iconColors}
• Directly next to it: the text "${siteName}" in ${textHex} color, bold sans-serif typeface

TEXT RULES:
• The letters of "${siteName}" must be colored ${textHex} — not dark blue, not gray, not navy — exactly ${textHex}
• Text must be clearly readable, spelled exactly as "${siteName}", and the dominant element
• The icon and text should feel like one cohesive mark — vertically centered

SIZING & CROP:
• Landscape aspect ratio, roughly 4:1 (wide, not tall)
• The icon + text must fill the full width and height — NO empty padding or whitespace
• Crop tightly so the logo touches the canvas edges
• Target 800×200 pixels

STYLE:
• Modern, professional, flat design
• Transparent background (PNG with no solid background)
• No gradients, no 3D effects, no drop shadows
• Icon: bold and geometric, 2-3 colors max

REMINDER: Text color = ${textHex}. Do NOT use dark text on transparent background if ${textHex} is white.`;
}
