import { describe, it, expect } from "vitest";
import {
  mapCategoriesToTags,
  buildCleanupPrompt,
  parseCleanupResponse,
} from "../../agents/migration/article-cleanup.js";
import type { WpCategory } from "../../agents/migration/types.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeCat(id: number, name: string): WpCategory {
  return { id, name, slug: name.toLowerCase().replace(/\s+/g, "-"), parent: 0 };
}

// ---------------------------------------------------------------------------
// mapCategoriesToTags
// ---------------------------------------------------------------------------

describe("mapCategoriesToTags", () => {
  const wpCategories: WpCategory[] = [
    makeCat(1, "Travel Tips"),
    makeCat(2, "Food & Drink"),
    makeCat(3, "Tech News"),
    makeCat(5, "Obscure Hobby"),
  ];

  const menuItems = ["travel tips", "Food & Drink", "Lifestyle"];

  it("matches WP categories to menu items case-insensitively", () => {
    const tags = mapCategoriesToTags([1, 2], wpCategories, menuItems);
    // "Travel Tips" matches "travel tips" (menu casing preserved)
    expect(tags).toEqual(["travel tips", "Food & Drink"]);
  });

  it("falls back to WP category name when no menu match", () => {
    const tags = mapCategoriesToTags([3], wpCategories, menuItems);
    expect(tags).toEqual(["Tech News"]);
  });

  it("returns unknown-<id> for category IDs not in WP categories", () => {
    const tags = mapCategoriesToTags([999], wpCategories, menuItems);
    expect(tags).toEqual(["unknown-999"]);
  });

  it("handles empty articleCategoryIds", () => {
    const tags = mapCategoriesToTags([], wpCategories, menuItems);
    expect(tags).toEqual([]);
  });

  it("handles empty wpCategories", () => {
    const tags = mapCategoriesToTags([1], [], menuItems);
    expect(tags).toEqual(["unknown-1"]);
  });

  it("handles empty menuItems — always falls back to WP name", () => {
    const tags = mapCategoriesToTags([1, 5], wpCategories, []);
    expect(tags).toEqual(["Travel Tips", "Obscure Hobby"]);
  });

  it("handles all arrays empty", () => {
    const tags = mapCategoriesToTags([], [], []);
    expect(tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCleanupPrompt
// ---------------------------------------------------------------------------

describe("buildCleanupPrompt", () => {
  it("includes the article title in the prompt", () => {
    const prompt = buildCleanupPrompt("My Title", "body text", "excerpt");
    expect(prompt).toContain("My Title");
  });

  it("includes the markdown body in the prompt", () => {
    const prompt = buildCleanupPrompt("T", "## Heading\nParagraph", "ex");
    expect(prompt).toContain("## Heading\nParagraph");
  });

  it("includes cleanup instructions", () => {
    const prompt = buildCleanupPrompt("T", "body", "excerpt");
    expect(prompt).toContain("Remove");
    expect(prompt).toContain("<description>");
    expect(prompt).toContain("<markdown>");
  });

  it("includes excerpt when provided", () => {
    const prompt = buildCleanupPrompt("T", "body", "A good excerpt here.");
    expect(prompt).toContain("A good excerpt here.");
  });

  it("asks to generate description when excerpt is empty", () => {
    const prompt = buildCleanupPrompt("T", "body", "");
    expect(prompt).toContain("Generate a concise");
  });

  it("asks to generate description when excerpt is very short", () => {
    const prompt = buildCleanupPrompt("T", "body", "short");
    expect(prompt).toContain("Generate a concise");
  });
});

// ---------------------------------------------------------------------------
// parseCleanupResponse
// ---------------------------------------------------------------------------

describe("parseCleanupResponse", () => {
  it("extracts description and markdown from valid XML format", () => {
    const response = `<description>A great article about travel.</description>
<markdown>## Travel Guide

Visit these places.</markdown>`;

    const result = parseCleanupResponse(response);
    expect(result.description).toBe("A great article about travel.");
    expect(result.markdown).toBe("## Travel Guide\n\nVisit these places.");
  });

  it("handles multiline description and markdown", () => {
    const response = `<description>
First line.
Second line.
</description>
<markdown>
# Title

Paragraph one.

Paragraph two.
</markdown>`;

    const result = parseCleanupResponse(response);
    expect(result.description).toBe("First line.\nSecond line.");
    expect(result.markdown).toBe("# Title\n\nParagraph one.\n\nParagraph two.");
  });

  it("returns original markdown when parsing fails (no tags)", () => {
    const result = parseCleanupResponse(
      "Just some plain text",
      "original body",
    );
    expect(result.description).toBe("");
    expect(result.markdown).toBe("original body");
  });

  it("returns response as markdown when parsing fails and no original given", () => {
    const result = parseCleanupResponse("Just some plain text");
    expect(result.description).toBe("");
    expect(result.markdown).toBe("Just some plain text");
  });

  it("returns fallback when only description is present (no markdown tag)", () => {
    const result = parseCleanupResponse(
      "<description>desc</description>\nno markdown tag",
      "original",
    );
    expect(result.description).toBe("");
    expect(result.markdown).toBe("original");
  });

  it("returns fallback when only markdown is present (no description tag)", () => {
    const result = parseCleanupResponse(
      "<markdown>body</markdown>",
      "original",
    );
    expect(result.description).toBe("");
    expect(result.markdown).toBe("original");
  });

  it("handles extra whitespace in tags", () => {
    const response = `<description>  spaced  </description>
<markdown>  content  </markdown>`;

    const result = parseCleanupResponse(response);
    expect(result.description).toBe("spaced");
    expect(result.markdown).toBe("content");
  });
});
