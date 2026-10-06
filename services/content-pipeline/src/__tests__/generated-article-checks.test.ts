import { describe, it, expect, vi } from "vitest";
import {
  findPromptJargon,
  generateArticleWithChecks,
  parseGeneratedArticle,
} from "../agents/content-generation/generators/base-generator.js";

const USAGE = { inputTokens: 100, outputTokens: 50, estimated: false };

function articleJson(body: string, extra = ""): string {
  return `{"title":"T","slug":"t","description":"D","type":"standard","tags":["Celebrities"],"body":${JSON.stringify(body)}${extra}}`;
}

describe("parseGeneratedArticle repair", () => {
  it("accepts a trailing comma before the closing brace", () => {
    const raw = `{\n  "title": "T",\n  "slug": "t",\n  "description": "D",\n  "type": "standard",\n  "tags": ["A",],\n  "body": "Hello",\n}`;
    expect(parseGeneratedArticle(raw)).toMatchObject({ title: "T", tags: ["A"], body: "Hello" });
  });

  it("accepts raw newlines inside string values", () => {
    const raw = `{"title":"T","slug":"t","description":"D","type":"standard","tags":[],"body":"Line one\n\nLine two"}`;
    expect(parseGeneratedArticle(raw).body).toBe("Line one\n\nLine two");
  });

  it("still throws on output that is not JSON at all", () => {
    expect(() => parseGeneratedArticle("Sorry, I can't help with that.")).toThrow(/Failed to parse/);
  });
});

describe("findPromptJargon", () => {
  it.each([
    ["Per the brief, Apple Martin wore Chanel.", "the brief"],
    ["## The Peg: A Quiet Goodbye", "The Peg"],
    ["What our brief confirms is limited.", "our brief"],
  ])("flags %s", (body, hit) => {
    expect(findPromptJargon({ title: "T", description: "D", body })).toBe(hit);
  });

  it("ignores normal uses of the word", () => {
    expect(findPromptJargon({ title: "A brief history of Swift", description: "Briefly: yes", body: "She was brief." })).toBeNull();
  });
});

describe("generateArticleWithChecks", () => {
  it("returns the first clean article with its usage and model", async () => {
    const call = vi.fn().mockResolvedValue({ text: articleJson("Clean body"), usage: USAGE, model: "claude-sonnet-5-5" });
    const res = await generateArticleWithChecks(call);
    expect(res).toMatchObject({ body: "Clean body", model: "claude-sonnet-5-5", usage: USAGE });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries once when the output cannot be parsed, summing usage", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ text: "not json", usage: USAGE, model: "m" })
      .mockResolvedValueOnce({ text: articleJson("Second try"), usage: USAGE, model: "m" });
    const res = await generateArticleWithChecks(call);
    expect(res.body).toBe("Second try");
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 100, estimated: false });
  });

  it("retries once when the article leaks prompt jargon and tells the model why", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ text: articleJson("Per the brief, it happened."), usage: USAGE, model: "m" })
      .mockResolvedValueOnce({ text: articleJson("Per Cosmopolitan, it happened."), usage: USAGE, model: "m" });
    const res = await generateArticleWithChecks(call);
    expect(res.body).toBe("Per Cosmopolitan, it happened.");
    expect(call.mock.calls[1]![0]).toMatch(/the brief/);
  });

  it("sanitises jargon that survives the retry instead of dropping the article", async () => {
    const call = vi.fn().mockResolvedValue({ text: articleJson("Per the brief, it happened. The brief says more."), usage: USAGE, model: "m" });
    const res = await generateArticleWithChecks(call);
    expect(res.body).toBe("Per the report, it happened. The report says more.");
  });

  it("throws when both attempts are unparseable", async () => {
    const call = vi.fn().mockResolvedValue({ text: "nope", usage: USAGE, model: "m" });
    await expect(generateArticleWithChecks(call)).rejects.toThrow(/Failed to parse/);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
