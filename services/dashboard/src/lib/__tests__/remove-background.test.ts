import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { removeBackground } from "../remove-background";

async function opaquePixels(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 200) n++;
  return n;
}

describe("removeBackground on an already-transparent logo (OpenAI output)", () => {
  it("keeps a dark logo's pixels (transparent corners are not a colour to remove), trims and caps the width", async () => {
    const mark = await sharp({ create: { width: 1200, height: 300, channels: 4, background: { r: 20, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
    const canvas = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 168, top: 362 }]).png().toBuffer();
    const out = await removeBackground(canvas);
    expect(await opaquePixels(out)).toBeGreaterThan(0);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(800);
    expect(meta.height).toBeLessThan(400); // the empty canvas around the mark was trimmed
  });
  it("still removes a solid background (Gemini output)", async () => {
    const mark = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const canvas = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 26, g: 26, b: 46, alpha: 1 } } })
      .composite([{ input: mark, left: 200, top: 110 }]).png().toBuffer();
    const meta = await sharp(await removeBackground(canvas)).metadata();
    expect(meta.width).toBeLessThanOrEqual(210);
  });
});
