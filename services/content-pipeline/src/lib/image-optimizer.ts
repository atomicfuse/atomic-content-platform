/**
 * Image optimization — converts raw AI-generated PNGs to compressed WebP.
 *
 * AI image generators (Gemini, OpenAI) return uncompressed PNGs that are
 * typically 1.5–3 MB. For content sites with 100+ articles, this is
 * unsustainable. This module compresses images to WebP at a target size
 * of ~100–300 KB while maintaining good visual quality.
 */

import sharp from "sharp";

/** Target file size in bytes (200 KB). */
const TARGET_SIZE_BYTES = 200 * 1024;

/** Maximum acceptable file size in bytes (350 KB). */
const MAX_SIZE_BYTES = 350 * 1024;

/** Maximum width for hero images (px). Most content sites display ≤1200px. */
const MAX_WIDTH = 1200;

/**
 * Optimize an image buffer: resize if oversized, convert to WebP.
 *
 * Strategy:
 *   1. Resize to max 1200px wide (preserving aspect ratio)
 *   2. Convert to WebP at quality 80
 *   3. If still over MAX_SIZE_BYTES, retry at lower quality (60)
 *
 * Returns the optimized buffer (always WebP).
 */
export async function optimizeImage(raw: Buffer): Promise<Buffer> {
  const metadata = await sharp(raw).metadata();
  const originalKB = (raw.length / 1024).toFixed(0);

  let pipeline = sharp(raw);

  // Resize if wider than MAX_WIDTH
  if (metadata.width && metadata.width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  // First pass: quality 80
  let result = await pipeline.webp({ quality: 80 }).toBuffer();

  // If still too large, try quality 60
  if (result.length > MAX_SIZE_BYTES) {
    pipeline = sharp(raw);
    if (metadata.width && metadata.width > MAX_WIDTH) {
      pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }
    result = await pipeline.webp({ quality: 60 }).toBuffer();
  }

  // If STILL too large (unlikely), go aggressive: quality 40
  if (result.length > MAX_SIZE_BYTES) {
    pipeline = sharp(raw);
    if (metadata.width && metadata.width > MAX_WIDTH) {
      pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }
    result = await pipeline.webp({ quality: 40 }).toBuffer();
  }

  const resultKB = (result.length / 1024).toFixed(0);
  console.log(`[img-opt] ${originalKB} KB → ${resultKB} KB (WebP)`);

  return result;
}
