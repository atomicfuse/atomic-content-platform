import { describe, expect, it } from "vitest";
import { distributeTopics, exclusiveConflicts, fitOf, normalizeSiteAuthors, rankForSite, siteAudienceOf, siteTopicsOf } from "../assignment";
import type { AuthorRecord } from "../types";

const mk = (id: string, extra: Partial<AuthorRecord> = {}): AuthorRecord => ({
  id, name: id.replace(/-/g, " "), tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {},
  exclusive_sites: [], created_at: "", updated_at: "", ...extra,
});
const SITE = { site: "journeypeaks", vertical: "Travel", topics: ["Hiking Trails", "Budget Travel", "Road Trips"] };

describe("fitOf", () => {
  it("strong = same vertical and a shared topic word; close = one of the two; none = neither", () => {
    expect(fitOf(mk("a", { verticals: ["travel"], beats: ["Hiking"] }), SITE)).toBe("strong");
    expect(fitOf(mk("b", { verticals: ["Travel"], beats: ["Museums"] }), SITE)).toBe("close");
    expect(fitOf(mk("c", { beats: ["Road trips"] }), SITE)).toBe("close");
    expect(fitOf(mk("d", { beats: ["Celebrities"] }), SITE)).toBe("none");
  });
  it("ignores filler words so 'News' or 'and' never count as a match", () => {
    expect(fitOf(mk("e", { beats: ["Car news and reviews"] }), { site: "x", topics: ["Celebrity news"] })).toBe("none");
  });
});

describe("rankForSite", () => {
  const lib = [
    mk("strong-one", { verticals: ["Travel"], beats: ["Hiking"] }),
    mk("close-one", { beats: ["Road trips"] }),
    mk("exclusive-one", { verticals: ["Travel"], beats: ["Hiking"], exclusive_sites: ["scoopella"] }),
    mk("unrelated", { beats: ["Celebrities"] }),
    mk("already", { verticals: ["Travel"], beats: ["Hiking"] }),
  ];
  it("ranks strong, then close, then none; skips authors already on the site; flags exclusive elsewhere", () => {
    const r = rankForSite(lib, SITE, ["already"]);
    expect(r.map((x) => [x.author.id, x.fit, x.exclusiveElsewhere])).toEqual([
      ["strong-one", "strong", false], ["exclusive-one", "strong", true], ["close-one", "close", false], ["unrelated", "none", false],
    ]);
  });
});

describe("distributeTopics", () => {
  const seq = (...v: number[]): (() => number) => { let i = 0; return () => v[i++ % v.length]!; };
  it("with a generalist (author with no topics) nothing is split: the generalist already covers the rest", () => {
    expect(distributeTopics([{ id: "a", topics: ["Hiking Trails"] }, { id: "b", topics: [] }], SITE.topics, seq(0.5)))
      .toEqual([{ id: "a", topics: ["Hiking Trails"] }, { id: "b", topics: [] }]);
  });

  it("all specialists: every topic nobody chose goes to one of them, and the split is stable on re-save", () => {
    const out = distributeTopics([{ id: "a", topics: ["Hiking Trails"] }, { id: "b", topics: ["Road Trips"] }], SITE.topics, seq(0.1, 0.9));
    expect(out.flatMap((x) => x.topics).sort()).toEqual([...SITE.topics].sort());
    expect(out.find((x) => x.id === "a")!.topics).toContain("Hiking Trails");
    expect(distributeTopics(out, SITE.topics, seq(0.5))).toEqual(out);
  });
  it("drops topics the site no longer has and fixes their case", () => {
    const out = distributeTopics([{ id: "a", topics: ["hiking trails", "Old Topic"] }], ["Hiking Trails"], seq(0.5));
    expect(out).toEqual([{ id: "a", topics: ["Hiking Trails"] }]);
  });
  it("no site topics: keeps what was chosen; no authors: returns []", () => {
    expect(distributeTopics([{ id: "a", topics: ["X"] }], [], seq(0.5))).toEqual([{ id: "a", topics: ["X"] }]);
    expect(distributeTopics([], SITE.topics, seq(0.5))).toEqual([]);
  });
});

describe("exclusiveConflicts / normalizeSiteAuthors / siteTopicsOf", () => {
  it("an author exclusive to another site conflicts; one already exclusive to this site doesn't", () => {
    const lib = [mk("ella-hughes", { exclusive_sites: ["scoopella"] }), mk("own", { exclusive_sites: ["journeypeaks"] }), mk("free")];
    expect(exclusiveConflicts([{ id: "ella-hughes", topics: [] }, { id: "own", topics: [] }, { id: "free", topics: [] }], lib, "journeypeaks").map((a) => a.id)).toEqual(["ella-hughes"]);
  });
  it("normalizes: valid ids only, no duplicates, trimmed unique topics", () => {
    expect(normalizeSiteAuthors([{ id: "a", topics: [" X ", "x", 3] }, { id: "a" }, { id: "../bad" }, "junk"])).toEqual([{ id: "a", topics: ["X"] }]);
  });
  it("site topics come from topics_v2 names, else brief.topics", () => {
    expect(siteTopicsOf({ brief: { topics_v2: [{ name: "A" }, { name: "B" }], topics: ["Z"] } })).toEqual(["A", "B"]);
    expect(siteTopicsOf({ brief: { topics: ["Z"] } })).toEqual(["Z"]);
    expect(siteTopicsOf(null)).toEqual([]);
  });
});

describe("siteAudienceOf", () => {
  it("joins the brief's audiences, falls back to the single audience, else undefined", () => {
    expect(siteAudienceOf({ brief: { audiences: ["New parents", " Expecting moms ", ""] } })).toBe("New parents, Expecting moms");
    expect(siteAudienceOf({ brief: { audiences: [], audience: "Deal hunters" } })).toBe("Deal hunters");
    expect(siteAudienceOf({ brief: { audiences: [] } })).toBeUndefined();
    expect(siteAudienceOf(null)).toBeUndefined();
  });
});

