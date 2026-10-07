import { describe, expect, it } from "vitest";
import { renameArticleText, uniqueSlug } from "../scripts/brand-safe-slugs-lib.js";

const doc = (extra = ""): string => `---\ntitle: 'Eating Disorders in Teens'\ntype: standard\nslug: eating-disorders-teens\n${extra}featuredImage: /assets/images/eating-disorders-teens.webp\n---\n\nBody mentions eating-disorders-teens once.\n`;

describe("renameArticleText", () => {
  it("swaps the slug field and records the old slug in redirect_from, leaving everything else as is", () => {
    const out = renameArticleText(doc(), "eating-disorders-teens", "teen-health-guide");
    expect(out).toContain("slug: teen-health-guide\nredirect_from:\n  - eating-disorders-teens\n");
    expect(out).toContain("featuredImage: /assets/images/eating-disorders-teens.webp"); // image path unchanged
    expect(out).toContain("Body mentions eating-disorders-teens once."); // body untouched
    expect(out).not.toContain("slug: eating-disorders-teens\n");
  });
  it("appends to an existing redirect_from list", () => {
    const out = renameArticleText(doc("redirect_from:\n  - older-slug\n"), "eating-disorders-teens", "teen-health-guide");
    expect(out).toContain("slug: teen-health-guide\nredirect_from:\n  - older-slug\n  - eating-disorders-teens\n");
  });
  it("adds slug + redirect_from when the file had no slug field", () => {
    const out = renameArticleText("---\ntitle: X\n---\nbody\n", "old-one", "new-one");
    expect(out).toBe("---\ntitle: X\nslug: new-one\nredirect_from:\n  - old-one\n---\nbody\n");
  });
});

describe("uniqueSlug", () => {
  it("adds -2, -3… when the slug is taken", () => {
    expect(uniqueSlug("teen-health", new Set(["teen-health", "teen-health-2"]))).toBe("teen-health-3");
    expect(uniqueSlug("fresh", new Set())).toBe("fresh");
  });
});

describe("staleArticlesFilter", () => {
  it("matches this site+branch's records whose file is gone (e.g. renamed slugs)", async () => {
    const { staleArticlesFilter } = await import("../scripts/backfill-mongo.js");
    expect(staleArticlesFilter("wk", "main", ["a", "b"])).toEqual({ domain: "wk", branch: "main", slug: { $nin: ["a", "b"] } });
  });
  it("never matches anything when the listing is empty (a failed listing must not wipe the site)", async () => {
    const { staleArticlesFilter } = await import("../scripts/backfill-mongo.js");
    expect(staleArticlesFilter("wk", "main", [])).toBeNull();
  });
});
