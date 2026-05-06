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
  const iconColors = dark
    ? "Use bright, vivid colors (NOT dark colors) so it pops on a dark background."
    : "Use rich, saturated colors that stand out on a light background.";

  return `Design a bold, distinctive ICON for a ${vertical} website called "${siteName}"${audience ? ` targeting ${audience}` : ""}.

IMPORTANT — ICON ONLY, NO TEXT:
• Do NOT include any text, letters, or words — this is a pure symbol/icon
• The site name "${siteName}" will be rendered separately in HTML text

ICON DESIGN:
• A single bold symbol or mark that represents ${vertical}
• ${iconColors}
• Simple, recognizable at small sizes (32px–48px)
• 2–3 colors maximum, flat design
• Geometric and clean — no fine details that disappear at small sizes

SIZING & CROP:
• Square aspect ratio, 1:1
• The icon must fill the entire canvas — NO empty padding or whitespace around it
• Crop tightly so the icon touches all edges
• Target 512×512 pixels

STYLE:
• Modern, professional, flat design
• Transparent background (PNG with no solid background)
• No gradients, no 3D effects, no drop shadows, no text`;
}
