/**
 * Gemini image generation via REST API.
 * Returns structured result indicating success or classified failure.
 */

import type { ImageGenAttempt } from "../agents/content-generation/image-pipeline/types.js";

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiImageInput {
  /** Base64-encoded image data. */
  data: string;
  /** MIME type (e.g. "image/jpeg", "image/png"). */
  mimeType: string;
}

/**
 * Generate an image for the given prompt using Gemini.
 * Optionally accepts a reference image that Gemini can see when generating.
 *
 * Returns a structured result:
 * - `{ ok: true, data }` on success
 * - `{ ok: false, retriable, reason }` on failure
 *   - retriable=true for 5xx, 429, timeouts, network errors
 *   - retriable=false for 4xx (auth, content policy), missing image in response
 */
export async function generateImageWithGemini(
  apiKey: string,
  prompt: string,
  referenceImage?: GeminiImageInput,
): Promise<ImageGenAttempt> {
  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    console.log(`[gemini] POST ${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent`);

    const parts: Array<Record<string, unknown>> = [];
    if (referenceImage) {
      parts.push({
        inlineData: { mimeType: referenceImage.mimeType, data: referenceImage.data },
      });
    }
    parts.push({ text: prompt });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000), // 60s timeout for image generation
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[gemini] Image generation failed: ${response.status} ${response.statusText}`);
      console.error(`[gemini] Response: ${errorBody.slice(0, 500)}`);

      const retriable = response.status >= 500 || response.status === 429;
      const label =
        response.status === 429
          ? "rate_limited"
          : response.status >= 500
            ? "server_error"
            : "client_error";
      return { ok: false, retriable, reason: `${label}:${response.status}` };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content.parts.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      console.warn("[gemini] No image in response");
      return { ok: false, retriable: false, reason: "no_image_in_response" };
    }

    return { ok: true, data: Buffer.from(imagePart.inlineData.data, "base64") };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    const isNetworkError = err instanceof TypeError;

    if (isTimeout) {
      console.warn("[gemini] Image generation timed out");
      return { ok: false, retriable: true, reason: "timeout" };
    }

    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[gemini] Image generation error:", reason);
    return { ok: false, retriable: isNetworkError, reason };
  }
}
