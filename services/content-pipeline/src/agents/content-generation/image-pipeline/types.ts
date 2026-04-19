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
  /** DALL-E prompt used for generation (for debugging). */
  prompt: string;
}
