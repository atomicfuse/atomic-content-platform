import { describe, it, expect } from "vitest";
import { expandThemeColors, buildTheme } from "../../agents/migration/theme-builder.js";

const ALL_19_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "text",
  "muted",
  "surface",
  "border",
  "footer_bg",
  "hero_title",
  "must_reads_title",
  "must_reads_bg",
  "article_hero_title",
  "feed_title",
  "feed_desc",
  "feed_date",
  "category_header_text",
  "prose_heading",
  "prose_body",
] as const;

describe("expandThemeColors", () => {
  it("returns all 19 color keys when given full CSV colors", () => {
    const colors = expandThemeColors({
      primary: "#F43656",
      secondary: "#C87137",
      accent: "#B80000",
      text: "#000000",
      background: "#FFFFFF",
    });

    expect(Object.keys(colors)).toHaveLength(19);
    for (const key of ALL_19_KEYS) {
      expect(colors[key]).toBeDefined();
      expect(colors[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("preserves provided colors", () => {
    const colors = expandThemeColors({
      primary: "#FF0000",
      secondary: "#00FF00",
      accent: "#0000FF",
      text: "#111111",
      background: "#EEEEEE",
    });

    expect(colors.primary).toBe("#FF0000");
    expect(colors.secondary).toBe("#00FF00");
    expect(colors.accent).toBe("#0000FF");
    expect(colors.text).toBe("#111111");
    expect(colors.background).toBe("#EEEEEE");
  });

  it("uses defaults for missing colors", () => {
    const colors = expandThemeColors({});

    expect(colors.primary).toBe("#1a1a2e");
    expect(colors.accent).toBe("#f4c542");
    expect(colors.text).toBe("#1a1a2e");
    expect(colors.background).toBe("#ffffff");
    expect(colors.secondary).toBe("#1a1a2e");
    expect(colors.hero_title).toBe("#ffffff");
  });

  it("defaults feed_date to the muted color, not accent", () => {
    const colors = expandThemeColors({
      primary: "#1a1a2e",
      accent: "#f4c542",
      text: "#000000",
      background: "#ffffff",
    });
    // feed_date should follow the muted (secondary text) color,
    // not the bright CTA accent.
    expect(colors.feed_date).toBe(colors.muted);
    expect(colors.feed_date).not.toBe(colors.accent);
  });
});

describe("buildTheme", () => {
  it("returns base, colors, and fonts", () => {
    const theme = buildTheme({ primary: "#F43656" });

    expect(theme.base).toBe("modern");
    expect(theme.fonts).toEqual({ heading: "Poppins", body: "Inter" });
    expect(Object.keys(theme.colors)).toHaveLength(19);
  });
});
