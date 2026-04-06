import sharp from "sharp";

/**
 * Remove the background from an AI-generated logo image.
 *
 * Samples the four corner pixels to determine the background color,
 * then makes all pixels within a colour-distance threshold transparent.
 * Returns a PNG buffer with alpha channel.
 */
export async function removeBackground(
  imageBuffer: Buffer,
  threshold = 35
): Promise<Buffer> {
  const image = sharp(imageBuffer).ensureAlpha();
  const { width, height } = await image.metadata();

  if (!width || !height) return imageBuffer;

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // Byte offsets of the four corner pixels (RGBA = 4 bytes per pixel)
  const stride = info.width * 4;
  const corners = [
    0,                                          // top-left
    (info.width - 1) * 4,                       // top-right
    (info.height - 1) * stride,                 // bottom-left
    (info.height - 1) * stride + (info.width - 1) * 4, // bottom-right
  ];

  // Average corner colours to find the background
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const offset of corners) {
    bgR += data[offset];
    bgG += data[offset + 1];
    bgB += data[offset + 2];
  }
  bgR = Math.round(bgR / 4);
  bgG = Math.round(bgG / 4);
  bgB = Math.round(bgB / 4);

  // Make pixels close to the background colour transparent
  const t2 = threshold * threshold;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    if (dr * dr + dg * dg + db * db < t2) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
