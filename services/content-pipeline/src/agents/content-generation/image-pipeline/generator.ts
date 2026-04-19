/**
 * Image Generator — creates article images using Gemini Flash.
 *
 * Builds a prompt from article title, description, and summary,
 * then generates an editorial illustration via Gemini.
 * Falls back gracefully — image generation is non-critical.
 */

import { generateImageWithGemini } from "../../../lib/gemini.js";
import type { ImageGenerationResult } from "./types.js";

export interface ImageGenInput {
  articleTitle: string;
  articleDescription: string;
  articleSummary: string;
  vertical: string;
}

/**
 * Build an image generation prompt from article content.
 * Focuses on the topic and mood rather than sensitive specifics.
 */
function buildImagePrompt(input: ImageGenInput): string {
  const topicSummary = input.articleDescription || input.articleSummary.slice(0, 200);

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
 * Generate alt text from article context.
 */
function generateAltText(input: ImageGenInput): string {
  return `Editorial illustration for: ${input.articleTitle}`;
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

  const prompt = buildImagePrompt(input);
  console.log(`[img-gen] Generating image for: "${input.articleTitle}"`);
  console.log(`[img-gen] Prompt: ${prompt.slice(0, 150)}...`);

  const imageData = await generateImageWithGemini(apiKey, prompt);

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
