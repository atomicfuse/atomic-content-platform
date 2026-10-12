import { describe, expect, it, vi } from "vitest";
import { authorNameFromYaml, createBylineResolver, normalizeSiteAuthors, pickArticleAuthor } from "../bylines.js";

const AUTHORS = [{ id: "maya-ortiz", topics: ["Hiking"] }, { id: "ben-foster", topics: ["Road Trips"] }, { id: "nia-okafor", topics: [] }];

describe("pickArticleAuthor", () => {
  it("the author with the article's topic first (any case); otherwise rotation over all", () => {
    expect(pickArticleAuthor(AUTHORS, "road trips", 0)[0]!.id).toBe("ben-foster");
    expect(pickArticleAuthor(AUTHORS, undefined, 0)[0]!.id).toBe("maya-ortiz");
    expect(pickArticleAuthor(AUTHORS, undefined, 4)[0]!.id).toBe("ben-foster");
    expect(pickArticleAuthor(AUTHORS, "Unknown topic", 2)[0]!.id).toBe("nia-okafor");
  });
  it("returns every author once, chosen first, so a missing profile can fall through", () => {
    expect(pickArticleAuthor(AUTHORS, "Hiking", 1).map((a) => a.id).sort()).toEqual(["ben-foster", "maya-ortiz", "nia-okafor"]);
    expect(pickArticleAuthor([], "Hiking", 0)).toEqual([]);
  });
});

describe("generalists (authors with no topics) share every topic", () => {
  const SITE = [{ id: "fiona", topics: ["Royals", "Fashion"] }, { id: "ben", topics: [] }];
  it("a topic one author covers alternates between that author and the generalists", () => {
    expect([0, 1, 2, 3].map((turn) => pickArticleAuthor(SITE, "Royals", turn)[0]!.id)).toEqual(["fiona", "ben", "fiona", "ben"]);
  });
  it("a specialist on another topic is only a fallback", () => {
    const three = [{ id: "fiona", topics: ["Royals"] }, { id: "ben", topics: [] }, { id: "cy", topics: ["Travel"] }];
    expect([0, 1].map((turn) => pickArticleAuthor(three, "Royals", turn)[0]!.id)).toEqual(["fiona", "ben"]);
    expect(pickArticleAuthor(three, "Royals", 0).map((a) => a.id)).toEqual(["fiona", "ben", "cy"]);
  });
  it("a topic nobody chose goes to the generalists", () => {
    expect([0, 1].map((turn) => pickArticleAuthor(SITE, "Cooking", turn)[0]!.id)).toEqual(["ben", "ben"]);
  });
});

describe("authorNameFromYaml / normalizeSiteAuthors", () => {
  it("reads the name; broken or nameless files give null", () => {
    expect(authorNameFromYaml("id: a\nname: Maya Ortiz\n")).toBe("Maya Ortiz");
    expect(authorNameFromYaml("name: [oops")).toBeNull();
    expect(authorNameFromYaml(null)).toBeNull();
  });
  it("keeps valid ids once", () => {
    expect(normalizeSiteAuthors([{ id: "a", topics: ["X"] }, { id: "a" }, { id: "Bad Id" }])).toEqual([{ id: "a", topics: ["X"] }]);
  });
});

describe("createBylineResolver", () => {
  const files: Record<string, string> = { "maya-ortiz": "id: maya-ortiz\nname: Maya Ortiz\n", "ben-foster": "name: [broken" };
  const read = vi.fn(async (id: string) => files[id] ?? null);

  it("uses the topic author with author_id; reads each profile once", async () => {
    const bylineFor = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 0 });
    expect(await bylineFor("Hiking")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    expect(await bylineFor("Hiking")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("skips authors whose profile is missing or broken; none usable → the legacy name without an id", async () => {
    const bylineFor = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 1 });
    expect(await bylineFor("Road Trips")).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    const none = createBylineResolver({ siteDomain: "s", siteAuthors: [{ id: "ghost", topics: [] }], legacyAuthor: "Old Name", readAuthorFile: read, nextTurn: async () => 0 });
    expect(await none()).toEqual({ name: "Old Name" });
  });

  it("a site without authors keeps its legacy name, else Editorial Team; a rotation failure still gives a byline", async () => {
    expect(await createBylineResolver({ siteDomain: "s", siteAuthors: [], legacyAuthor: "Old Name", readAuthorFile: read })()).toEqual({ name: "Old Name" });
    expect(await createBylineResolver({ siteDomain: "s", siteAuthors: [], readAuthorFile: read })()).toEqual({ name: "Editorial Team" });
    const flaky = createBylineResolver({ siteDomain: "s", siteAuthors: AUTHORS, readAuthorFile: read, nextTurn: async () => { throw new Error("mongo down"); } });
    expect((await flaky("Hiking")).authorId).toBe("maya-ortiz");
  });

  it("one author: no rotation call; a read error isn't remembered for the rest of the run", async () => {
    const nextTurn = vi.fn(async () => 0);
    let fail = true;
    const flakyRead = vi.fn(async () => { if (fail) throw new Error("GitHub 502"); return "name: Maya Ortiz\n"; });
    const bylineFor = createBylineResolver({ siteDomain: "s", siteAuthors: [{ id: "maya-ortiz", topics: [] }], legacyAuthor: "Old Name", readAuthorFile: flakyRead, nextTurn });
    expect(await bylineFor()).toEqual({ name: "Old Name" });
    fail = false;
    expect(await bylineFor()).toEqual({ name: "Maya Ortiz", authorId: "maya-ortiz" });
    expect(nextTurn).not.toHaveBeenCalled();
  });
});
