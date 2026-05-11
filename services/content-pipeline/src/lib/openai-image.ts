/**
 * OpenAI image generation via REST API (gpt-image-2).
 * Fallback provider in the three-tier image generation ladder.
 */

import type { ImageGenAttempt } from "../agents/content-generation/image-pipeline/types.js";

const OPENAI_IMAGE_API = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_MODEL = "gpt-image-2";

/**
 * Generate an image for the given prompt using OpenAI gpt-image-2.
 *
 * Returns a structured result:
 * - `{ ok: true, data }` on success
 * - `{ ok: false, retriable, reason }` on failure
 *   - retriable=true for 5xx, 429, timeouts, network errors
 *   - retriable=false for 4xx (auth, content policy, bad request)
 */
export async function generateImageWithOpenAI(
  apiKey: string,
  prompt: string,
): Promise<ImageGenAttempt> {
  try {
    console.log(`[openai-img] POST ${OPENAI_IMAGE_API} model=${OPENAI_IMAGE_MODEL}`);

    const response = await fetch(OPENAI_IMAGE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt,
        n: 1,
        size: "1024x1024",
      }),
      signal: AbortSignal.timeout(90_000), // 90s — OpenAI image gen can be slow
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[openai-img] Image generation failed: ${response.status} ${response.statusText}`);
      console.error(`[openai-img] Response: ${errorBody.slice(0, 500)}`);

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
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      console.warn("[openai-img] No image data in response");
      return { ok: false, retriable: false, reason: "no_image_in_response" };
    }

    return { ok: true, data: Buffer.from(b64, "base64") };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    const isNetworkError = err instanceof TypeError;

    if (isTimeout) {
      console.warn("[openai-img] Image generation timed out");
      return { ok: false, retriable: true, reason: "timeout" };
    }

    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[openai-img] Image generation error:", reason);
    return { ok: false, retriable: isNetworkError, reason };
  }
}
