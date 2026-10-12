import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAuthorPart, portraitKey, type GenerateDeps } from "../generate.js";

const BIO = Array.from({ length: 80 }, () => "word").join(" ") + ".";

function deps(texts: string[]): GenerateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    generateText: vi.fn(async (p: { systemPrompt: string; userPrompt: string }) => {
      calls.push(p.userPrompt);
      return { text: texts.shift() ?? "", usage: { inputTokens: 10, outputTokens: 20 }, model: "claude-sonnet-5-5" };
    }),
    generatePortrait: vi.fn(async () => ({ path: "/authors/assets/maya-ortiz-abc1234567.webp", model: "gpt-image-2.5-flare" })),
    recordText: vi.fn(async () => undefined),
    recordImage: vi.fn(async () => undefined),
  };
}

describe("generateAuthorPart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns one validated text part and records its cost under the context site", async () => {
    const d = deps([`{"bio":"${BIO}"}`]);
    const out = await generateAuthorPart({ part: "bio", draft: { name: "Maya Ortiz" }, siteContext: { site: "coffeeactually" }, takenNames: [] }, d);
    expect(out).toEqual({ part: "bio", value: BIO, model: "claude-sonnet-5-5" });
    expect(d.recordText).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "coffeeactually", model: "claude-sonnet-5-5" }));
  });

  it("retries once with the reason when the first answer is invalid", async () => {
    const d = deps(['{"bio":"She is an award-winning writer."}', `{"bio":"${BIO}"}`]);
    const out = await generateAuthorPart({ part: "bio", draft: {}, siteContext: {}, takenNames: [] }, d);
    expect(out.value).toBe(BIO);
    expect(d.calls[1]).toMatch(/previous answer was rejected/i);
    expect(d.recordText).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "authors" }));
  });

  it("fails with 422 after two invalid answers (never returns a bad value)", async () => {
    const d = deps(['{"name":"Ella Hughes"}', '{"name":"ella hughes"}']);
    await expect(generateAuthorPart({ part: "name", draft: {}, siteContext: {}, takenNames: ["Ella Hughes"] }, d))
      .rejects.toMatchObject({ status: 422 });
  });

  it("portrait: delegates to the portrait generator and records one image", async () => {
    const d = deps([]);
    const out = await generateAuthorPart({ part: "portrait", authorId: "maya-ortiz", draft: { name: "Maya Ortiz", beats: ["Coffee"] }, siteContext: {}, takenNames: [] }, d);
    expect(out).toEqual({ part: "portrait", value: { kind: "generated", path: "/authors/assets/maya-ortiz-abc1234567.webp" }, model: "gpt-image-2.5-flare" });
    expect(d.recordImage).toHaveBeenCalledWith(expect.objectContaining({ images: 1, model: "gpt-image-2.5-flare" }));
  });
});

describe("portraitKey", () => {
  it("is content-hashed under authors/assets", () => {
    expect(portraitKey("maya-ortiz", Buffer.from("x"))).toMatch(/^authors\/assets\/maya-ortiz-[0-9a-f]{10}\.webp$/);
  });
});
