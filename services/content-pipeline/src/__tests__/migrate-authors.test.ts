import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { authorFileYaml, deletedSiteIds, headerAuthor, isBadByline, planMigration, recreditFrontmatter, slugFor, type SiteState } from "../scripts/migrate-authors-lib.js";

const site = (s: string, extra: Partial<SiteState> = {}): SiteState => ({ site: s, authors: [], badArticles: [], ...extra });

describe("isBadByline / slugFor", () => {
  it.each(["admin", "Editorial Team", "Mimi AI agent", "Alexi AI historian", "staff"])("bad: %s", (n) => expect(isBadByline(n)).toBe(true));
  it.each(["Ella Hughes", "Taylor Winters", "Sapir Lavi", "Aidan Price"])("a person's name stays: %s", (n) => expect(isBadByline(n)).toBe(false));
  it("slugs like the dashboard", () => {
    expect(slugFor("Ella Hughes", new Set())).toBe("ella-hughes");
    expect(slugFor("Ella Hughes", new Set(["ella-hughes"]))).toBe("ella-hughes-2");
  });
});

describe("planMigration", () => {
  const library = [{ id: "nia-okafor", name: "Nia Okafor", exclusive_sites: ["journeypeaks"] }];
  const sites = [
    site("scoopella", { badArticles: [{ path: "sites/scoopella/articles/a.md", author: "admin", ref: "staging" }] }),
    site("journeypeaks", { authors: [{ id: "nia-okafor", topics: [] }], badArticles: [{ path: "sites/journeypeaks/articles/b.md", author: "Editorial Team", ref: "main" }] }),
    site("carsnewsmag", { badArticles: [{ path: "sites/carsnewsmag/articles/c.md", author: "admin", ref: "staging" }] }),
  ];

  it("Ella becomes a library author exclusive to scoopella and scoopella's author; her site's bad bylines go to her", () => {
    const p = planMigration(sites, library);
    expect(p.createAuthors).toEqual([{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }]);
    expect(p.siteAuthors).toEqual([{ site: "scoopella", authors: [{ id: "ella-hughes", topics: [] }] }]);
    expect(p.recredit).toContainEqual({ site: "scoopella", ref: "staging", path: "sites/scoopella/articles/a.md", from: "admin", to: "Ella Hughes", authorId: "ella-hughes" });
  });

  it("other sites' bad bylines go to their first author; sites without authors wait", () => {
    const p = planMigration(sites, library);
    expect(p.recredit).toContainEqual({ site: "journeypeaks", ref: "main", path: "sites/journeypeaks/articles/b.md", from: "Editorial Team", to: "Nia Okafor", authorId: "nia-okafor" });
    expect(p.waiting).toEqual([{ site: "carsnewsmag", articles: 1 }]);
  });

  it("is idempotent: with Ella in place and no bad bylines left there is nothing to do", () => {
    const again = planMigration(
      [site("scoopella", { authors: [{ id: "ella-hughes", topics: [] }] })],
      [{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }],
    );
    expect(again).toEqual({ createAuthors: [], addExclusive: [], clearExclusive: [], siteAuthors: [], recredit: [], waiting: [] });
  });

  it("authors created exclusive by the first bulk run stop being exclusive; Ella keeps scoopella", () => {
    const p = planMigration(
      [site("scoopella", { authors: [{ id: "ella-hughes", topics: [] }] })],
      [
        { id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] },
        { id: "selin-aksoy", name: "Selin Aksoy", exclusive_sites: ["geekytraveler", "journeypeaks"] },
        { id: "free-one", name: "Free One", exclusive_sites: [] },
      ],
    );
    expect(p.clearExclusive).toEqual(["selin-aksoy"]);
    expect(p.addExclusive).toEqual([]);
  });

  it("an existing Ella without the exclusive gets it", () => {
    const p = planMigration([site("scoopella", { authors: [{ id: "ella-hughes", topics: [] }] })], [{ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: [] }]);
    expect(p.addExclusive).toEqual([{ id: "ella-hughes", sites: ["scoopella"] }]);
  });
});

describe("recreditFrontmatter", () => {
  const md = "---\ntitle: Hello\nauthor: admin\ntags: [a]\n---\nBody mentions author: admin in text.\n";
  it("changes only the header's author line and adds author_id after it; the body is untouched", () => {
    expect(recreditFrontmatter(md, "Nia Okafor", "nia-okafor")).toBe("---\ntitle: Hello\nauthor: Nia Okafor\nauthor_id: nia-okafor\ntags: [a]\n---\nBody mentions author: admin in text.\n");
  });
  it("replaces an existing author_id instead of adding a second one", () => {
    const withId = "---\nauthor: admin\nauthor_id: old\n---\nx\n";
    expect(recreditFrontmatter(withId, "Nia Okafor", "nia-okafor")).toBe("---\nauthor: Nia Okafor\nauthor_id: nia-okafor\n---\nx\n");
  });
});

describe("authorFileYaml", () => {
  it("writes a file the dashboard store and seed-authors read", () => {
    const doc = parseYaml(authorFileYaml({ id: "ella-hughes", name: "Ella Hughes", exclusive_sites: ["scoopella"] }, "2026-10-12T00:00:00.000Z")) as Record<string, unknown>;
    expect(doc).toMatchObject({ id: "ella-hughes", name: "Ella Hughes", tagline: "", bio: "", beats: [], verticals: [], links: {}, exclusive_sites: ["scoopella"], created_at: "2026-10-12T00:00:00.000Z" });
  });
});

describe("headerAuthor", () => {
  it("reads the author from the header only (a body line starting with author: doesn't count)", () => {
    expect(headerAuthor("---\ntitle: T\nauthor: 'Jane Smith'\n---\nauthor: Editorial Team\n")).toBe("Jane Smith");
    expect(headerAuthor("---\r\ntitle: T\r\nauthor: admin\r\n---\r\nx")).toBe("admin");
    expect(headerAuthor("no header\nauthor: admin")).toBeNull();
  });
});

describe("recreditFrontmatter keeps CRLF files working", () => {
  it("rewrites a CRLF header too", () => {
    expect(recreditFrontmatter("---\r\nauthor: admin\r\n---\r\nx", "Nia Okafor", "nia-okafor")).toBe("---\nauthor: Nia Okafor\nauthor_id: nia-okafor\n---\nx");
  });
});

describe("deletedSiteIds", () => {
  it("reads the index's deleted: list and any site marked deleted", () => {
    const yaml = "sites:\n  - domain: live\n    status: Live\n  - domain: gone\n    status: Deleted\ndeleted:\n  - domain: chaibeseret\n";
    expect([...deletedSiteIds(yaml)].sort()).toEqual(["chaibeseret", "gone"]);
    expect(deletedSiteIds("not: [valid")).toEqual(new Set());
  });
});

