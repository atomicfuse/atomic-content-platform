/**
 * Image Generator — three-tier ladder: Gemini → OpenAI → exhausted.
 *
 * Tier A: Gemini Flash (2 attempts, retry only on transient errors)
 * Tier B: OpenAI gpt-image-1 (1 attempt, no retry — this IS the fallback)
 * Tier C: Both exhausted → returns { ok: false, reason: "image_gen_exhausted" }
 *
 * Image generation is MANDATORY — articles without images are not created.
 * When the ladder is exhausted, the article is abandoned and
 * processWithConcurrency moves on to the next source URL.
 */

import { generateImageWithGemini, type GeminiImageInput } from "../../../lib/gemini.js";
import { generateImageWithOpenAI } from "../../../lib/openai-image.js";
import type { ImageGenerationResult, ImageLadderResult, ImageLadderAttemptLog } from "./types.js";

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
      `- If it is a realistic photograph, generate a candid, high-resolution photograph with natural lighting and editorial quality.`,
      `- If it is an illustration, graphic, or low-quality image, generate a clean, modern professional editorial illustration.`,
      `Wide landscape format (16:9). Rich colors, premium quality.`,
      `Do NOT copy the reference image. Create something new that matches its style.`,
      `Do NOT include any text, watermarks, logos, or identifiable real people.`,
    ].join(" ");
  }

  return [
    `Create a professional editorial illustration for a ${input.vertical} article.`,
    `Article title: "${input.articleTitle}".`,
    `Topic: ${topicSummary}.`,
    `Style: clean, modern, professional hero image for a news/content website.`,
    `Wide landscape format (16:9). Vivid colors, editorial quality.`,
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
        console.log(`[img-gen] Gemini succeeded (${(attempt.data.length / 1024).toFixed(0)} KB)`);
        return {
          ok: true,
          result: { data: attempt.data, altText: generateAltText(input), prompt: geminiPrompt },
        };
      }

      attempts.push({ provider: "gemini", reason: attempt.reason });
      console.warn(`[img-gen] Gemini attempt ${i + 1} failed: ${attempt.reason} (retriable=${attempt.retriable})`);

      // Permanent failure → skip remaining Gemini attempts
      if (!attempt.retriable) break;
    }
  } else {
    attempts.push({ provider: "gemini", reason: "api_key_not_configured" });
    console.warn("[img-gen] Tier A skipped: GEMINI_API_KEY not set");
  }

  // ── Tier B: OpenAI gpt-image-1 (1 attempt) ────────────────────────────
  if (openaiKey) {
    const openaiPrompt = buildImagePrompt(input, false); // no reference for OpenAI
    console.log(`[img-gen] Tier B: OpenAI attempt for "${input.articleTitle}"`);
    const attempt = await generateImageWithOpenAI(openaiKey, openaiPrompt);

    if (attempt.ok) {
      console.log(`[img-gen] OpenAI succeeded (${(attempt.data.length / 1024).toFixed(0)} KB)`);
      return {
        ok: true,
        result: { data: attempt.data, altText: generateAltText(input), prompt: openaiPrompt },
      };
    }

    attempts.push({ provider: "openai", reason: attempt.reason });
    console.warn(`[img-gen] OpenAI failed: ${attempt.reason}`);
  } else {
    attempts.push({ provider: "openai", reason: "api_key_not_configured" });
    console.warn("[img-gen] Tier B skipped: OPENAI_API_KEY not set");
  }

  // ── Tier C: Exhausted ──────────────────────────────────────────────────
  const reasonChain = attempts.map((a) => `${a.provider}:${a.reason}`).join(", ");
  console.error(`[img-gen] Image generation exhausted for "${input.articleTitle}": ${reasonChain}`);
  return { ok: false, reason: "image_gen_exhausted", attempts };
}
