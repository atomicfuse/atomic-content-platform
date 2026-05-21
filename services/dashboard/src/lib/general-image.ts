import { uploadToR2 } from "./r2-upload";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

export async function generateAndUploadDefaultSiteImage(
  siteId: string,
  siteName: string,
  vertical: string,
): Promise<{ success: boolean; reason?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, reason: "GEMINI_API_KEY not configured" };

  const prompt = `Create a professional, visually appealing hero image for a website called "${siteName}" in the ${vertical} niche. The image should be a high-quality photograph or illustration suitable as a default article thumbnail. No text overlays. Clean, modern aesthetic. 1200x630 pixels aspect ratio.`;

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      return { success: false, reason: `gemini_${response.status}` };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType: string; data: string } }>;
        };
      }>;
    };
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData,
    );
    if (!imagePart?.inlineData) {
      return { success: false, reason: "no_image_in_response" };
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");

    // Optimize with sharp (same as article upload: max 1200px, WebP)
    const sharp = (await import("sharp")).default;
    const optimized = await sharp(imageBuffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const r2Key = `${siteId}/assets/images/${siteId}-general-article.webp`;
    const uploaded = await uploadToR2(r2Key, optimized, "image/webp");

    if (!uploaded) return { success: false, reason: "r2_upload_failed" };
    return { success: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { success: false, reason };
  }
}
