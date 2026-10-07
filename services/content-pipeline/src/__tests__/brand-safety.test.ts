import { describe, expect, it, vi } from "vitest";
import { findUnsafeSlugTerms, makeSlugBrandSafe, normalizeSlug, parseJudgeVerdict, stripUnsafeTerms } from "../lib/brand-safety.js";

describe("findUnsafeSlugTerms", () => {
  it("flags the example: eating disorders (multi-word term)", () => {
    expect(findUnsafeSlugTerms("eating-disorders-teens")).toEqual([{ category: "sensitive_social_issues", term: "eating-disorders" }]);
  });
  it.each([
    ["aubrey-oday-diddy-prison-perks", "prison"],
    ["celebrity-dies-at-82", "dies"],
    ["gaza-war-teachers-killed", "gaza"],
    ["mass-shooting-texas", "shooting"],
    ["fentanyl-overdose-spike", "fentanyl"],
    ["nude-photo-leak", "nude"],
    ["self-harm-warning-signs", "self-harm"],
  ])("flags %s", (slug, term) => {
    expect(findUnsafeSlugTerms(slug).map((h) => h.term)).toContain(term);
  });
  it("matches simple plurals", () => {
    expect(findUnsafeSlugTerms("new-guns-law").map((h) => h.term)).toEqual(["gun"]);
  });
  it.each(["drugstore-beauty-finds", "screenshot-tips", "warner-bros-slate", "skills-for-life", "wine-tours-tuscany", "conspiracy-theories-explained", "best-thriller-movies-2026"])(
    "does not flag the safe slug %s",
    (slug) => expect(findUnsafeSlugTerms(slug)).toEqual([]),
  );
});

describe("stripUnsafeTerms", () => {
  it("removes flagged words (single and multi-word) and tidies hyphens", () => {
    expect(stripUnsafeTerms("teens-eating-disorders-signs-prison")).toBe("teens-signs");
  });
});

describe("normalizeSlug", () => {
  it("lowercases, kebab-cases and caps at 60 chars on a word boundary", () => {
    expect(normalizeSlug("  Teen Wellness & Body Image!  ")).toBe("teen-wellness-body-image");
    expect(normalizeSlug("a".repeat(30) + "-" + "b".repeat(40)).length).toBeLessThanOrEqual(60);
  });
});

describe("makeSlugBrandSafe", () => {
  it("leaves a safe slug alone without calling the AI", async () => {
    const rewrite = vi.fn();
    expect(await makeSlugBrandSafe("best-thriller-movies-2026", "Best Thriller Movies", rewrite)).toEqual({ slug: "best-thriller-movies-2026", changed: false, hits: [] });
    expect(rewrite).not.toHaveBeenCalled();
  });
  it("uses the AI rewrite when it comes back safe", async () => {
    const rewrite = vi.fn(async () => "Teen Wellness and Body Image");
    const out = await makeSlugBrandSafe("eating-disorders-teens", "Eating disorders in teens", rewrite);
    expect(out).toMatchObject({ slug: "teen-wellness-and-body-image", changed: true });
    expect(rewrite).toHaveBeenCalledWith("eating-disorders-teens", ["eating-disorders"], "Eating disorders in teens");
  });
  it("strips the words when the AI rewrite is still unsafe or fails", async () => {
    expect((await makeSlugBrandSafe("eating-disorders-teens-guide", "t", async () => "eating-disorder-help")).slug).toBe("teens-guide");
    expect((await makeSlugBrandSafe("eating-disorders-teens-guide", "t", async () => { throw new Error("down"); })).slug).toBe("teens-guide");
  });
  it("never returns an empty slug", async () => {
    const out = await makeSlugBrandSafe("murder-trial", "Murder trial", async () => "");
    expect(out.slug).toMatch(/^[a-z0-9-]+$/);
    expect(out.slug.length).toBeGreaterThan(3);
    expect(findUnsafeSlugTerms(out.slug)).toEqual([]);
  });
});

describe("tone: insults, innuendo and violence words (vendors flag these too)", () => {
  it.each([
    ["professional-wrestling-is-stupid-and-thats-the-point", "stupid"],
    ["kylie-jenner-hulu-bachelorette-weekend-pretty-little-liars", "bachelorette"],
    ["kylie-jenner-hulu-bachelorette-weekend-pretty-little-liars", "liar"],
    ["reality-star-brawl-at-reunion", "brawl"],
  ])("flags %s (%s)", (slug, term) => {
    expect(findUnsafeSlugTerms(slug).map((h) => h.term)).toContain(term);
  });
});

describe("AI reviewer (second layer)", () => {
  const safeJudge = vi.fn(async () => ({ safe: true, words: [] as string[] }));
  it("rewrites a slug the word list passes but the AI reviewer flags", async () => {
    const judge = vi.fn()
      .mockResolvedValueOnce({ safe: false, words: ["slammed"] })
      .mockResolvedValueOnce({ safe: true, words: [] });
    const rewrite = vi.fn(async () => "star-responds-to-critics");
    const out = await makeSlugBrandSafe("star-slammed-by-critics", "Star slammed", rewrite, judge);
    expect(out).toMatchObject({ slug: "star-responds-to-critics", changed: true });
    expect(rewrite).toHaveBeenCalledWith("star-slammed-by-critics", ["slammed"], "Star slammed");
  });
  it("keeps a slug both layers pass, with one reviewer call", async () => {
    safeJudge.mockClear();
    expect((await makeSlugBrandSafe("best-thriller-movies-2026", "t", vi.fn(), safeJudge)).changed).toBe(false);
    expect(safeJudge).toHaveBeenCalledTimes(1);
  });
  it("treats a reviewer error as no opinion (the word list still applies)", async () => {
    const broken = vi.fn(async () => { throw new Error("down"); });
    expect((await makeSlugBrandSafe("best-thriller-movies-2026", "t", vi.fn(), broken)).changed).toBe(false);
  });
  it("rejects a rewrite the reviewer still flags, falling back to stripping", async () => {
    const judge = vi.fn()
      .mockResolvedValueOnce({ safe: false, words: ["slammed"] })
      .mockResolvedValue({ safe: false, words: ["roasted"] }); // every rewrite attempt is rejected
    const out = await makeSlugBrandSafe("star-slammed-by-critics-again", "t", async () => "star-roasted-by-critics", judge);
    expect(out.slug).toBe("star-by-critics-again");
  });
});

describe("parseJudgeVerdict", () => {
  it("reads the reviewer's JSON, tolerating fences", () => {
    expect(parseJudgeVerdict('```json\n{"safe": false, "words": ["Stupid"]}\n```')).toEqual({ safe: false, words: ["stupid"] });
    expect(parseJudgeVerdict('{"safe": true}')).toEqual({ safe: true, words: [] });
  });
  it("returns null for junk (no opinion)", () => {
    expect(parseJudgeVerdict("I think it's fine")).toBeNull();
  });
});

describe("makeSlugBrandSafe — retries and a title-based fallback", () => {
  it("retries the rewrite (up to 3), telling the AI what the last attempt got flagged for", async () => {
    const judge = vi.fn()
      .mockResolvedValueOnce({ safe: false, words: ["conspiracies"] }) // original
      .mockResolvedValueOnce({ safe: false, words: ["radical"] })      // attempt 1 (only the reviewer catches it)
      .mockResolvedValueOnce({ safe: true, words: [] });               // attempt 2
    const rewrite = vi.fn()
      .mockResolvedValueOnce("covid-radical-groups-and-the-military")
      .mockResolvedValueOnce("covid-misinformation-and-the-military");
    const out = await makeSlugBrandSafe("covid-19-conspiracies-extremism-military", "COVID-19 conspiracies and the military", rewrite, judge);
    expect(out.slug).toBe("covid-misinformation-and-the-military");
    expect(rewrite.mock.calls[1]![1]).toEqual(expect.arrayContaining(["conspiracies", "radical"]));
  });
  it("falls back to the article title minus flagged words — never a bare 'latest-story'", async () => {
    const out = await makeSlugBrandSafe("murder-trial", "Inside the Murder Trial of the Decade in Ohio", async () => "murder-case", undefined);
    expect(out.slug).toBe("inside-trial-of-decade-ohio");
  });
});
