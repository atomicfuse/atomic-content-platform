/**
 * Types for the image generation pipeline.
 */

/** Result of analyzing a source thumbnail with a vision model. */
export interface ImageAnalysis {
  subject: string;
  mood: string;
  palette: string[];
  composition: string;
  style: string;
}

/** Result of generating an original image. */
export interface ImageGenerationResult {
  /** Raw image data (PNG). */
  data: Buffer;
  /** Alt text for accessibility + SEO. */
  altText: string;
  /** Prompt used for generation (for debugging). */
  prompt: string;
}

// ---------------------------------------------------------------------------
// Three-tier image generation ladder types
// ---------------------------------------------------------------------------

/** Result of a single image-generation attempt (Gemini or OpenAI). */
export type ImageGenAttempt =
  | { ok: true; data: Buffer }
  | { ok: false; retriable: boolean; reason: string };

/** Log entry for a single provider attempt within the ladder. */
export interface ImageLadderAttemptLog {
  provider: "gemini" | "openai";
  reason: string;
}

/** Result of the three-tier image generation ladder. */
export type ImageLadderResult =
  | { ok: true; result: ImageGenerationResult }
  | { ok: false; reason: "image_gen_exhausted"; attempts: ImageLadderAttemptLog[] };
