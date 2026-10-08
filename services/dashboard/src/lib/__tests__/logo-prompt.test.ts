import { describe, expect, it } from "vitest";
import { buildLogoPrompt } from "../logo-prompt";

const base = { siteName: "Scoopella", vertical: "Entertainment", headerBg: "#1a1a2e" };

describe("buildLogoPrompt", () => {
  it("transparent output: says the logo will sit on the header colour — never that the canvas is solid", () => {
    const p = buildLogoPrompt({ ...base, transparentOutput: true });
    expect(p).not.toMatch(/CANVAS is a solid/i);
    expect(p).not.toMatch(/Solid uniform/i);
    expect(p).toContain("placed on a solid #1a1a2e website header");
    expect(p).toMatch(/Fully TRANSPARENT background/);
  });
  it("Gemini (solid) output keeps today's wording", () => {
    const p = buildLogoPrompt({ ...base, transparentOutput: false });
    expect(p).toContain("The logo CANVAS is a solid #1a1a2e background (DARK).");
    expect(p).toContain("• BACKGROUND: Solid uniform #1a1a2e background, edge to edge.");
  });
  it("mid-tone header (coffee orange): near-black ink only, browns and greys banned", () => {
    const p = buildLogoPrompt({ ...base, headerBg: "#c27b4a", transparentOutput: true });
    expect(p).toContain("MID-TONE");
    expect(p).toMatch(/Do NOT use brown/i);
    expect(p).not.toContain("dark brown, or rich saturated colors");
  });
  it("mid-tone header: palette colours too close to the header are left out", () => {
    const p = buildLogoPrompt({
      ...base, headerBg: "#c27b4a", transparentOutput: true,
      colors: { primary: "#6b3a1f", accent: "#141414" },
    });
    expect(p).not.toContain("#6b3a1f");
    expect(p).toContain("#141414");
  });
  it("clearly dark headers keep the light-ink wording", () => {
    const p = buildLogoPrompt({ ...base, transparentOutput: true });
    expect(p).not.toContain("MID-TONE");
    expect(p).toContain("MUST be LIGHT colors");
  });
  it("adds the site's tagline, topics and tone as personality cues — never as text to render", () => {
    const p = buildLogoPrompt({
      ...base, transparentOutput: true,
      tagline: "Pop culture with a wink", topics: ["Movies", "Celebrities", "TV"], tone: "playful and witty",
    });
    expect(p).toContain("SITE PERSONALITY");
    expect(p).toContain('Tagline: "Pop culture with a wink"');
    expect(p).toContain("Covers: Movies, Celebrities, TV");
    expect(p).toContain("Voice: playful and witty");
    expect(p).toMatch(/never render these words/i);
  });
  it("leaves out each missing cue, and the whole block when there are none (prompt unchanged)", () => {
    const only = buildLogoPrompt({ ...base, transparentOutput: true, topics: ["Movies"] });
    expect(only).toContain("Covers: Movies");
    expect(only).not.toContain("Tagline:");
    expect(only).not.toContain("Voice:");
    for (const transparentOutput of [true, false]) {
      const plain = buildLogoPrompt({ ...base, transparentOutput });
      expect(buildLogoPrompt({ ...base, transparentOutput, tagline: "  ", topics: [], tone: "" })).toBe(plain);
      expect(plain).not.toContain("SITE PERSONALITY");
    }
  });
});

