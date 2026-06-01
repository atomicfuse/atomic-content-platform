import sharp from "sharp";

/**
 * Extract a square favicon from a logo image.
 *
 * AI-generated logos are laid out as [icon | gap | site name text]. The icon
 * is identified by analyzing per-column alpha density: walk left-to-right,
 * find the first significant transparent gap after the icon, and crop to its
 * left edge. Falls back to a proportional crop when no clear gap exists
 * (single-element logos, wordmarks, icon-touches-text).
 *
 * Output is 180×180 (covers apple-touch-icon; browsers downscale for 16/32 tabs).
 */
export async function extractFaviconFromLogo(
  logoBuffer: Buffer,
): Promise<Buffer> {
  const img = sharp(logoBuffer).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w === 0 || h === 0) {
    return sharp(logoBuffer)
      .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 80 })
      .toBuffer();
  }

  const cropWidth = await detectIconWidth(img, w, h);

  return sharp(logoBuffer)
    .extract({ left: 0, top: 0, width: cropWidth, height: h })
    .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 80 })
    .toBuffer();
}

/**
 * Scan the alpha channel column-by-column and return the rightmost x of the
 * leftmost dense cluster (the icon). Falls back to a proportional crop when
 * no clear icon→text gap is detected.
 */
async function detectIconWidth(
  img: sharp.Sharp,
  w: number,
  h: number,
): Promise<number> {
  const proportionalFallback = (): number =>
    Math.min(w, w > h * 1.3 ? h : Math.round(Math.min(w, h) * 0.4));

  let data: Buffer;
  try {
    ({ data } = await img.raw().toBuffer({ resolveWithObject: true }));
  } catch {
    return proportionalFallback();
  }

  const ALPHA_THRESHOLD = 64;
  const density = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowOffset + x * 4 + 3] > ALPHA_THRESHOLD) density[x]++;
    }
  }

  const denseT = h * 0.05;
  const gapT = h * 0.02;
  const minGapWidth = Math.max(8, Math.floor(w * 0.03));

  let firstDense = -1;
  for (let x = 0; x < w; x++) {
    if (density[x] > denseT) { firstDense = x; break; }
  }
  if (firstDense < 0) return proportionalFallback();

  let gapStart = -1;
  for (let x = firstDense; x < w; x++) {
    if (density[x] < gapT) {
      if (gapStart < 0) gapStart = x;
      if (x - gapStart + 1 >= minGapWidth) return gapStart;
    } else {
      gapStart = -1;
    }
  }

  return proportionalFallback();
}
