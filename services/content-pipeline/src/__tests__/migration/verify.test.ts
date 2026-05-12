import { describe, it, expect } from "vitest";
import { validateArticleFrontmatter } from "../../agents/migration/verify.js";

describe("validateArticleFrontmatter", () => {
  it("passes for valid frontmatter", () => {
    const errors = validateArticleFrontmatter({
      title: "Test",
      description: "A description",
      slug: "test-slug",
      publishDate: "2026-05-11",
      author: "Author",
      tags: ["News"],
      status: "published",
      type: "standard",
      imported_from: "wordpress",
      wp_original_id: 123,
    });
    expect(errors).toHaveLength(0);
  });

  it("reports missing required fields", () => {
    const errors = validateArticleFrontmatter({ title: "Test" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes("slug"))).toBe(true);
  });

  it("reports empty description", () => {
    const errors = validateArticleFrontmatter({
      title: "Test", description: "", slug: "test", publishDate: "2026-05-11",
      author: "A", tags: [], status: "published", type: "standard",
    });
    expect(errors.some((e: string) => e.includes("description"))).toBe(true);
  });
});
