import { describe, expect, it } from "vitest";
import { detectPreset, presetToColors } from "../themePresets";

describe("Grid colour keys vs preset detection", () => {
  it("extra Grid-only keys do not change the detected preset", () => {
    const base = presetToColors("classic");
    expect(detectPreset({ ...base, card_bg: "#ffffff", pill_border: "#000000" })).toBe(detectPreset(base));
  });
});
