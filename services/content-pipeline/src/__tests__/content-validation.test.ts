import { describe, it, expect } from "vitest";
import { validateArticleBody } from "../agents/content-generation/agent.js";

describe("validateArticleBody", () => {
  it("rejects empty body", () => {
    expect(validateArticleBody("")).toEqual({ valid: false, reason: "empty body" });
  });

  it("rejects whitespace-only body", () => {
    expect(validateArticleBody("   \n\n  ")).toEqual({ valid: false, reason: "empty body" });
  });

  it("rejects body under 50 words", () => {
    const result = validateArticleBody("This is a short body with only ten words in it.");
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toContain("too short");
  });

  it("rejects known failure messages even when long enough", () => {
    const garbage =
      "No article content was available to process. The source text contained only a system prompt artifact from the HTML-to-Markdown conversion and no original article body. " +
      Array(40).fill("padding").join(" ");
    const result = validateArticleBody(garbage);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toContain("placeholder");
  });

  it("accepts valid article body", () => {
    const body = Array(100).fill("word").join(" ");
    expect(validateArticleBody(body)).toEqual({ valid: true });
  });

  it("rejects body with 'unable to generate' pattern", () => {
    const body = "We were unable to generate the article due to insufficient source material. " +
      Array(60).fill("padding").join(" ");
    const result = validateArticleBody(body);
    expect(result.valid).toBe(false);
  });
});
