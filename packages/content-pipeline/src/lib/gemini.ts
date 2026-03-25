/**
 * Gemini image generation via REST API.
 * Returns null on any failure — Gemini is optional; callers skip featuredImage.
 */

const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Generate an image for the given prompt using Gemini.
 * Returns a PNG Buffer or null if generation fails or key is absent.
 */
export async function generateImageWithGemini(
  apiKey: string,
  prompt: string,
): Promise<Buffer | null> {
  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!response.ok) {
      console.warn(`[gemini] Image generation failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content.parts.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      console.warn("[gemini] No image in response");
      return null;
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  } catch (err) {
    console.warn("[gemini] Image generation error:", err);
    return null;
  }
}
