/**
 * Image Generator — creates article images using Gemini Flash.
 *
 * When the source article has a thumbnail, downloads it and sends it to
 * Gemini as a reference image. Gemini sees the original and generates a
 * new image in an appropriate style — realistic photo if the source is a
 * photograph, illustration if it's a graphic or low-quality image.
 *
 * Falls back gracefully — image generation is non-critical.
 */

import { generateImageWithGemini, type GeminiImageInput } from "../../../lib/gemini.js";
import type { ImageGenerationResult } from "./types.js";

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
 * Returns undefined on any failure — non-critical.
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
    // Only accept actual images
    if (!contentType.startsWith("image/")) {
      console.warn(`[img-gen] Thumbnail not an image: ${contentType}`);
      return undefined;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // Skip tiny images (likely tracking pixels or broken)
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
 * Generate an article image using Gemini Flash.
 * Returns null on failure — image generation is non-critical.
 */
export async function generateImage(input: ImageGenInput): Promise<ImageGenerationResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[img-gen] GEMINI_API_KEY not set — skipping image generation");
    return null;
  }

  // Try to fetch the source thumbnail as a style reference
  let reference: GeminiImageInput | undefined;
  if (input.sourceThumbnailUrl) {
    console.log(`[img-gen] Fetching source thumbnail: ${input.sourceThumbnailUrl}`);
    reference = await fetchThumbnail(input.sourceThumbnailUrl);
    if (reference) {
      console.log(`[img-gen] Reference image loaded (${(Buffer.from(reference.data, "base64").length / 1024).toFixed(0)} KB)`);
    }
  }

  const prompt = buildImagePrompt(input, !!reference);
  console.log(`[img-gen] Generating image for: "${input.articleTitle}" (${reference ? "with reference" : "no reference"})`);
  console.log(`[img-gen] Prompt: ${prompt.slice(0, 150)}...`);

  const imageData = await generateImageWithGemini(apiKey, prompt, reference);

  if (!imageData) {
    console.warn(`[img-gen] Gemini returned no image for: "${input.articleTitle}"`);
    return null;
  }

  console.log(`[img-gen] Image generated successfully (${(imageData.length / 1024).toFixed(0)} KB)`);

  return {
    data: imageData,
    altText: generateAltText(input),
    prompt,
  };
}
