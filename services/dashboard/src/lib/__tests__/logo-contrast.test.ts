import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { bestInk, contrastRatio, logoMedianContrast, MIN_LOGO_CONTRAST } from "../logo-contrast";

const ORANGE = "#c27b4a"; // coffeeactually's header

async function markOnTransparent(fill: string): Promise<Buffer> {
  const mark = await sharp({ create: { width: 300, height: 120, channels: 4, background: fill } }).png().toBuffer();
  return sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: 150, top: 90 }]).png().toBuffer();
}

describe("contrast helpers", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
  it("picks the ink with the most contrast and flags mid-tone headers", () => {
    expect(bestInk("#1a1a2e")).toMatchObject({ ink: "light", midTone: false });
    expect(bestInk("#f5f5f5")).toMatchObject({ ink: "dark", midTone: false });
    expect(bestInk(ORANGE)).toMatchObject({ ink: "dark", midTone: true });
  });
});

describe("logoMedianContrast", () => {
  it("a brown mark on the orange header is too faint; a near-black one passes", async () => {
    expect(await logoMedianContrast(await markOnTransparent("#6b3a1f"), ORANGE)).toBeLessThan(MIN_LOGO_CONTRAST);
    expect(await logoMedianContrast(await markOnTransparent("#141414"), ORANGE)).toBeGreaterThanOrEqual(MIN_LOGO_CONTRAST);
  });
  it("ignores transparent pixels", async () => {
    expect(await logoMedianContrast(await markOnTransparent("#ffffff"), "#1a1a2e")).toBeGreaterThan(10);
  });
});
