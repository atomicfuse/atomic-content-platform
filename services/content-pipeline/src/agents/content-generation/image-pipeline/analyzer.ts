/**
 * Thumbnail Analyzer — uses GPT-4o-mini vision to extract
 * style, mood, palette, subject, and composition from a source thumbnail.
 *
 * The analysis is used ONLY AS INSPIRATION for generating an original image.
 * We NEVER copy or reuse the source thumbnail directly.
 */

import OpenAI from "openai";
import type { ImageAnalysis } from "./types.js";

const MODEL = "gpt-4o-mini";

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for image analysis");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Analyze a source thumbnail URL and extract visual characteristics.
 * Returns null on failure — image analysis is non-critical.
 */
export async function analyzeThumbnail(thumbnailUrl: string): Promise<ImageAnalysis | null> {
  try {
    console.log(`[img-analyzer] Analyzing thumbnail: ${thumbnailUrl}`);

    const client = getClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You are an image analyst. Analyze the provided image and extract visual characteristics.
Respond ONLY with a valid JSON object (no markdown fences):
{
  "subject": "brief description of the main subject",
  "mood": "the overall mood/feeling (e.g. dramatic, cheerful, serene)",
  "palette": ["3-5 dominant colors as CSS-friendly names"],
  "composition": "brief description of layout/composition style",
  "style": "artistic style (e.g. photographic, illustrated, minimal)"
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: thumbnailUrl, detail: "low" },
            },
            {
              type: "text",
              text: "Analyze this image and extract its visual characteristics.",
            },
          ],
        },
      ],
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText) return null;

    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const cleaned = fenceMatch ? fenceMatch[1]! : rawText;
    return JSON.parse(cleaned.trim()) as ImageAnalysis;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[img-analyzer] Analysis failed (non-critical): ${message}`);
    return null;
  }
}
