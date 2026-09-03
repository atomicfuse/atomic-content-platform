import { describe, it, expect } from "vitest";
import { PRESETS } from "../themePresets";

/** Mirror of the site-worker readableTextColor luminance check, kept local so
 *  this dashboard test has no cross-package import. */
function luminance(hex: string): number {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const ch = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

describe("theme presets — secondary color invariant", () => {
  it("no preset uses pure white (#ffffff/#fff) as `secondary`", () => {
    const offenders = Object.entries(PRESETS)
      .filter(([, p]) => /^#(fff|ffffff)$/i.test(p.colors.secondary))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("the previously-broken presets now have a dark `secondary` (so buttons render)", () => {
    const names = new Set(["Mint Finance", "Tokyo Night", "Aurora", "Pink Glow"]);
    const checked = Object.values(PRESETS).filter((p) => names.has(p.name));
    expect(checked.length).toBe(4); // all four are present
    for (const p of checked) {
      expect(luminance(p.colors.secondary)).toBeLessThan(0.179);
    }
  });
});
