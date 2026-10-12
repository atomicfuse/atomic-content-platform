import { describe, expect, it } from "vitest";
import { isReservedArticleSlug } from "../lib/reserved-slugs.js";

describe("isReservedArticleSlug", () => {
  it("grid and author are reserved path segments on every site", () => {
    expect(isReservedArticleSlug("grid")).toBe(true);
    expect(isReservedArticleSlug("author")).toBe(true);
    expect(isReservedArticleSlug("AUTHOR")).toBe(true);
    expect(isReservedArticleSlug("author-tips")).toBe(false);
    expect(isReservedArticleSlug("authors")).toBe(false);
  });
});
