/**
 * Image Generator — creates ORIGINAL images using DALL-E 3.
 *
 * HARD REQUIREMENT: Never copy or directly use source thumbnails.
 * The analysis from the analyzer is used ONLY as inspiration for
 * generating a completely new, original image.
 */

import OpenAI from "openai";
import type { ImageAnalysis, ImageGenerationResult } from "./types.js";

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for image generation");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface ImageGenInput {
  /** Visual analysis of the source thumbnail (null if no thumbnail). */
  analysis: ImageAnalysis | null;
  articleTitle: string;
  articleSummary: string;
  vertical: string;
}

/**
 * Build a DALL-E prompt from analysis + article context.
 * Creates an original image — never copies the source.
 */
function buildDallePrompt(input: ImageGenInput): string {
  const parts: string[] = [];

  parts.push(`Create a professional, original editorial illustration for an article titled "${input.articleTitle}".`);

  if (input.analysis) {
    parts.push(`Style inspiration: ${input.analysis.style} aesthetic with a ${input.analysis.mood} mood.`);
    parts.push(`Color palette: ${input.analysis.palette.join(", ")}.`);
    parts.push(`Subject matter: ${input.analysis.subject}.`);
  } else {
    parts.push(`The article is about: ${input.articleSummary.slice(0, 200)}.`);
    parts.push(`Category: ${input.vertical}.`);
  }

  parts.push("The image should be clean, modern, and suitable for a professional news/content website.");
  parts.push("Do NOT include any text, watermarks, or logos in the image.");

  return parts.join(" ");
}

/**
 * Generate alt text for the image.
 */
function generateAltText(input: ImageGenInput): string {
  if (input.analysis) {
    return `Illustration of ${input.analysis.subject} for article: ${input.articleTitle}`;
  }
  return `Editorial illustration for article: ${input.articleTitle}`;
}

/**
 * Generate an original image using DALL-E 3.
 * Returns null on failure — image generation is non-critical.
 */
export async function generateImage(input: ImageGenInput): Promise<ImageGenerationResult | null> {
  try {
    const prompt = buildDallePrompt(input);
    console.log(`[img-gen] Generating image for: "${input.articleTitle}"`);

    const client = getClient();
    const response = await client.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1792x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      console.warn("[img-gen] No image data in response");
      return null;
    }

    return {
      data: Buffer.from(b64, "base64"),
      altText: generateAltText(input),
      prompt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[img-gen] Image generation failed (non-critical): ${message}`);
    return null;
  }
}
