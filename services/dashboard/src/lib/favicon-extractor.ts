import sharp from "sharp";

/**
 * Extract a square favicon from a logo image.
 *
 * AI-generated logos are laid out as [icon | site name text]. This function
 * crops the left 40% of the image (where the icon lives) and resizes to
 * 180x180 (covers apple-touch-icon; browsers downscale for 16/32 tabs).
 *
 * The 40% crop works for both landscape logos (clear icon+text separation)
 * and near-square logos where removeBackground + trim didn't fully crop
 * the background (leaving the icon + text in a wider-than-expected area).
 *
 * Returns a PNG buffer suitable for saving as favicon.png.
 */
export async function extractFaviconFromLogo(
  logoBuffer: Buffer,
): Promise<Buffer> {
  const meta = await sharp(logoBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w === 0 || h === 0) {
    return sharp(logoBuffer).resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ palette: true, quality: 80 }).toBuffer();
  }

  // Always crop the left portion — icon is on the left in AI-generated logos.
  // For landscape images, crop a left square (h x h).
  // For square/near-square images, crop the left 40% as a square.
  const cropSize = w > h * 1.3 ? h : Math.round(Math.min(w, h) * 0.4);

  return sharp(logoBuffer)
    .extract({ left: 0, top: 0, width: cropSize, height: Math.min(cropSize, h) })
    .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 80 })
    .toBuffer();
}
