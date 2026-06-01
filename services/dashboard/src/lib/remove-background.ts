import sharp from "sharp";

/**
 * Remove the background from an AI-generated logo image.
 *
 * Samples the four corner pixels to determine the background color(s).
 * A pixel is made transparent if it is close to ANY corner color —
 * this handles gradient backgrounds (e.g. dark-to-darker) that a
 * single-average approach misses.
 *
 * Returns a PNG buffer with alpha channel.
 */
export async function removeBackground(
  imageBuffer: Buffer,
  threshold = 55
): Promise<Buffer> {
  const image = sharp(imageBuffer).ensureAlpha();
  const { width, height } = await image.metadata();

  if (!width || !height) return imageBuffer;

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // Byte offsets of the four corner pixels (RGBA = 4 bytes per pixel)
  const stride = info.width * 4;
  const cornerOffsets = [
    0,                                                    // top-left
    (info.width - 1) * 4,                                 // top-right
    (info.height - 1) * stride,                           // bottom-left
    (info.height - 1) * stride + (info.width - 1) * 4,   // bottom-right
  ];

  // Store each corner's RGB independently (handles gradient backgrounds)
  const cornerColors = cornerOffsets.map((offset) => ({
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
  }));

  // Make pixels transparent if close to ANY corner color
  const t2 = threshold * threshold;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    for (const bg of cornerColors) {
      const dr = r - bg.r;
      const dg = g - bg.g;
      const db = b - bg.b;
      if (dr * dr + dg * dg + db * db < t2) {
        data[i + 3] = 0;
        break;
      }
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim()   // Remove transparent padding so the logo fills its bounding box
    .resize({ width: 800, withoutEnlargement: true }) // Cap width for web use
    .png({ palette: true, quality: 80, compressionLevel: 9 })
    .toBuffer();
}
