/**
 * Image Generator — three-tier ladder: Gemini → OpenAI → source thumbnail.
 *
 * Tier A: Gemini Flash (2 attempts, retry only on transient errors)
 * Tier B: OpenAI gpt-image-1 (1 attempt, no retry — this IS the fallback)
 * Tier C: Source thumbnail (download + optimize — best-effort fallback)
 * Tier D: All exhausted → returns { ok: false, reason: "image_gen_exhausted" }
 *
 * Articles without images are still created (no featured image) so that a
 * transient image-provider outage doesn't block the entire pipeline.
 */

import { generateImageWithGemini, type GeminiImageInput } from "../../../lib/gemini.js";
import { generateImageWithOpenAI } from "../../../lib/openai-image.js";
import { optimizeImage } from "../../../lib/image-optimizer.js";
import { notifyImageGeneration, type NotificationConfig } from "../../../lib/notifications.js";
import type { ImageGenerationResult, ImageLadderResult, ImageLadderAttemptLog } from "./types.js";

// Model identifiers — included in logs and notifications for traceability
const GEMINI_MODEL = "gemini-2.5-flash-image";
const OPENAI_MODEL = "gpt-image-1";

export interface ImageGenInput {
  articleTitle: string;
  articleDescription: string;
  articleSummary: string;
  vertical: string;
  /** Source article thumbnail URL (if available). */
  sourceThumbnailUrl?: string;
}

/**
 * Build the image generation prompt.
 *
 * When a reference image is attached, the prompt tells Gemini to match the
 * visual style (photo vs illustration) of the reference. Without a reference,
 * it defaults to a professional editorial illustration.
 */
function buildImagePrompt(input: ImageGenInput, hasReference: boolean): string {
  const topicSummary = input.articleDescription || input.articleSummary.slice(0, 200);

  if (hasReference) {
    return [
      `I'm attaching the thumbnail from the source article as a style reference.`,
      `Create a NEW, ORIGINAL hero image for an article titled: "${input.articleTitle}".`,
      `Topic: ${topicSummary}.`,
      `Match the visual style of the reference image:`,
      `- If it is a realistic photograph, generate a candid photograph with natural lighting.`,
      `- If it is an illustration, graphic, or low-quality image, generate a clean, modern editorial illustration.`,
      `Wide landscape format (16:9). Web-optimized, moderate detail.`,
      `Do NOT copy the reference image. Create something new that matches its style.`,
      `Do NOT include any text, watermarks, logos, or identifiable real people.`,
    ].join(" ");
  }

  return [
    `Create a professional editorial illustration for a ${input.vertical} article.`,
    `Article title: "${input.articleTitle}".`,
    `Topic: ${topicSummary}.`,
    `Style: clean, modern hero image for a news/content website.`,
    `Wide landscape format (16:9). Web-optimized, moderate detail.`,
    `Do NOT include any text, watermarks, logos, or identifiable real people.`,
  ].join(" ");
}

/**
 * Download a thumbnail and return it as base64 for Gemini.
 * Returns undefined on any failure — thumbnail fetch is best-effort.
 */
async function fetchThumbnail(url: string): Promise<GeminiImageInput | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AtomicBot/1.0)",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`[img-gen] Thumbnail fetch failed: ${response.status} ${url}`);
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      console.warn(`[img-gen] Thumbnail not an image: ${contentType}`);
      return undefined;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 5_000) {
      console.warn(`[img-gen] Thumbnail too small (${buffer.length} bytes), skipping`);
      return undefined;
    }

    const mimeType = contentType.split(";")[0]!.trim();
    return { data: buffer.toString("base64"), mimeType };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[img-gen] Thumbnail fetch error: ${msg}`);
    return undefined;
  }
}

/**
 * Download a thumbnail as a raw Buffer for use as the article image.
 * Separate from fetchThumbnail (which returns base64 for Gemini input).
 * Returns undefined on any failure.
 */
async function downloadThumbnailBuffer(url: string): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AtomicBot/1.0)",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`[img-gen] Thumbnail download failed: ${response.status} ${url}`);
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return undefined;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1_000) {
      console.warn(`[img-gen] Thumbnail too small (${buffer.length} bytes)`);
      return undefined;
    }

    return buffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[img-gen] Thumbnail download error: ${msg}`);
    return undefined;
  }
}

/**
 * Generate alt text from article context.
 */
function generateAltText(input: ImageGenInput): string {
  return `Image for: ${input.articleTitle}`;
}

/**
 * Three-tier image generation ladder.
 *
 * Tier A: Gemini (up to 2 attempts — retry only on transient: 5xx/429/timeout)
 * Tier B: OpenAI gpt-image-1 (1 attempt — this IS the fallback)
 * Tier C: Exhausted → { ok: false, reason: "image_gen_exhausted", attempts }
 */
export async function generateImageWithLadder(
  input: ImageGenInput,
  notifications?: NotificationConfig,
  siteDomain?: string,
): Promise<ImageLadderResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const attempts: ImageLadderAttemptLog[] = [];

  // Fetch reference thumbnail (used by Gemini only — OpenAI prompt is text-only)
  let reference: GeminiImageInput | undefined;
  if (input.sourceThumbnailUrl) {
    console.log(`[img-gen] Fetching source thumbnail: ${input.sourceThumbnailUrl}`);
    reference = await fetchThumbnail(input.sourceThumbnailUrl);
    if (reference) {
      console.log(`[img-gen] Reference image loaded (${(Buffer.from(reference.data, "base64").length / 1024).toFixed(0)} KB)`);
    }
  }

  const geminiPrompt = buildImagePrompt(input, !!reference);

  // ── Tier A: Gemini (up to 2 attempts) ──────────────────────────────────
  if (geminiKey) {
    const MAX_GEMINI_ATTEMPTS = 2;
    for (let i = 0; i < MAX_GEMINI_ATTEMPTS; i++) {
      console.log(`[img-gen] Tier A: Gemini attempt ${i + 1}/${MAX_GEMINI_ATTEMPTS} for "${input.articleTitle}"`);
      const attempt = await generateImageWithGemini(geminiKey, geminiPrompt, reference);

      if (attempt.ok) {
        console.log(`[img-gen] Gemini (${GEMINI_MODEL}) succeeded (${(attempt.data.length / 1024).toFixed(0)} KB raw)`);
        if (notifications) {
          void notifyImageGeneration(notifications, {
            article: input.articleTitle, site: siteDomain,
            provider: `Gemini (${GEMINI_MODEL})`, success: true,
          });
        }
        const optimized = await optimizeImage(attempt.data);
        return {
          ok: true,
          result: { data: optimized, altText: generateAltText(input), prompt: geminiPrompt },
        };
      }

      attempts.push({ provider: "gemini", reason: attempt.reason });
      const isLastGemini = !attempt.retriable || i === MAX_GEMINI_ATTEMPTS - 1;
      const nextTier = openaiKey ? `OpenAI (${OPENAI_MODEL})` : (input.sourceThumbnailUrl ? "source thumbnail" : undefined);
      console.error(`[img-gen] Image generation with Gemini (${GEMINI_MODEL}) failed for "${input.articleTitle}" because ${attempt.reason}${isLastGemini && nextTier ? `. Trying now with ${nextTier}...` : ""}`);
      if (notifications) {
        void notifyImageGeneration(notifications, {
          article: input.articleTitle, site: siteDomain,
          provider: `Gemini (${GEMINI_MODEL})`, success: false, reason: attempt.reason,
          nextProvider: isLastGemini ? nextTier : `Gemini (${GEMINI_MODEL}) retry`,
        });
      }

      // Permanent failure → skip remaining Gemini attempts
      if (!attempt.retriable) break;
    }
  } else {
    attempts.push({ provider: "gemini", reason: "api_key_not_configured" });
    console.error(`[img-gen] Image generation with Gemini (${GEMINI_MODEL}) skipped: GEMINI_API_KEY not set`);
    if (notifications) {
      void notifyImageGeneration(notifications, {
        article: input.articleTitle, site: siteDomain,
        provider: `Gemini (${GEMINI_MODEL})`, success: false, reason: "API key not configured",
        nextProvider: openaiKey ? `OpenAI (${OPENAI_MODEL})` : (input.sourceThumbnailUrl ? "source thumbnail" : undefined),
      });
    }
  }

  // ── Tier B: OpenAI gpt-image-1 (1 attempt) ────────────────────────────
  if (openaiKey) {
    const openaiPrompt = buildImagePrompt(input, false); // no reference for OpenAI
    console.log(`[img-gen] Tier B: OpenAI attempt for "${input.articleTitle}"`);
    const attempt = await generateImageWithOpenAI(openaiKey, openaiPrompt);

    if (attempt.ok) {
      console.log(`[img-gen] OpenAI (${OPENAI_MODEL}) succeeded (${(attempt.data.length / 1024).toFixed(0)} KB raw)`);
      if (notifications) {
        void notifyImageGeneration(notifications, {
          article: input.articleTitle, site: siteDomain,
          provider: `OpenAI (${OPENAI_MODEL})`, success: true,
        });
      }
      const optimized = await optimizeImage(attempt.data);
      return {
        ok: true,
        result: { data: optimized, altText: generateAltText(input), prompt: openaiPrompt },
      };
    }

    attempts.push({ provider: "openai", reason: attempt.reason });
    const nextTier = input.sourceThumbnailUrl ? "source thumbnail" : undefined;
    console.error(`[img-gen] Image generation with OpenAI (${OPENAI_MODEL}) failed for "${input.articleTitle}" because ${attempt.reason}${nextTier ? `. Trying now with ${nextTier}...` : ""}`);
    if (notifications) {
      void notifyImageGeneration(notifications, {
        article: input.articleTitle, site: siteDomain,
        provider: `OpenAI (${OPENAI_MODEL})`, success: false, reason: attempt.reason,
        nextProvider: nextTier,
      });
    }
  } else {
    attempts.push({ provider: "openai", reason: "api_key_not_configured" });
    console.error(`[img-gen] Image generation with OpenAI (${OPENAI_MODEL}) skipped: OPENAI_API_KEY not set`);
    if (notifications) {
      void notifyImageGeneration(notifications, {
        article: input.articleTitle, site: siteDomain,
        provider: `OpenAI (${OPENAI_MODEL})`, success: false, reason: "API key not configured",
        nextProvider: input.sourceThumbnailUrl ? "source thumbnail" : undefined,
      });
    }
  }

  // ── Tier C: Source thumbnail (download + optimize) ───────────────────
  if (input.sourceThumbnailUrl) {
    console.log(`[img-gen] Tier C: downloading source thumbnail as fallback for "${input.articleTitle}"`);
    const thumbBuffer = await downloadThumbnailBuffer(input.sourceThumbnailUrl);
    if (thumbBuffer) {
      try {
        const optimized = await optimizeImage(thumbBuffer);
        console.log(`[img-gen] Source thumbnail fallback succeeded (${(optimized.length / 1024).toFixed(0)} KB)`);
        if (notifications) {
          void notifyImageGeneration(notifications, {
            article: input.articleTitle, site: siteDomain,
            provider: "source thumbnail", success: true,
          });
        }
        return {
          ok: true,
          result: { data: optimized, altText: generateAltText(input), prompt: "(source thumbnail)" },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ provider: "thumbnail", reason: msg });
        console.error(`[img-gen] Image generation with source thumbnail failed for "${input.articleTitle}" because ${msg}`);
        if (notifications) {
          void notifyImageGeneration(notifications, {
            article: input.articleTitle, site: siteDomain,
            provider: "source thumbnail", success: false, reason: msg,
          });
        }
      }
    } else {
      attempts.push({ provider: "thumbnail", reason: "download_failed" });
      console.error(`[img-gen] Image generation with source thumbnail failed for "${input.articleTitle}" because download failed`);
      if (notifications) {
        void notifyImageGeneration(notifications, {
          article: input.articleTitle, site: siteDomain,
          provider: "source thumbnail", success: false, reason: "download failed",
        });
      }
    }
  } else {
    attempts.push({ provider: "thumbnail", reason: "no_source_url" });
  }

  // ── Tier D: Exhausted ──────────────────────────────────────────────────
  const reasonChain = attempts.map((a) => `${a.provider}:${a.reason}`).join(", ");
  console.error(`[img-gen] Image generation exhausted for "${input.articleTitle}": ${reasonChain}`);
  return { ok: false, reason: "image_gen_exhausted", attempts };
}
