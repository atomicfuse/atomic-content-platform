import { describe, expect, it } from "vitest";
import { filterAuthors, filterCounts } from "../library";
import type { AuthorListItem } from "../types";

const mk = (id: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name: id, tagline: "", bio: "A bio.", beats: [], portrait: { kind: "generated", path: `/authors/assets/${id}.webp` },
  links: {}, exclusive_sites: [], created_at: "2026-01-01", updated_at: "2026-01-01", sites: [], ...extra,
});
const ITEMS = [
  mk("ella", { name: "Ella Hughes", tagline: "Royals writer", exclusive_sites: ["scoopella"], sites: [{ site: "scoopella", topics: [] }], updated_at: "2026-10-02" }),
  mk("ben", { name: "Ben Foster", beats: ["Fashion"], portrait: null, updated_at: "2026-10-03" }),
  mk("cara", { name: "Cara Diaz", sites: [{ site: "popstorylab", topics: [] }, { site: "viralsides", topics: [] }], updated_at: "2026-10-01" }),
];

describe("filterAuthors", () => {
  it("search matches name, tagline, beats and site names (case-insensitive)", () => {
    expect(filterAuthors(ITEMS, "royals", "all", "name").map((a) => a.id)).toEqual(["ella"]);
    expect(filterAuthors(ITEMS, "FASHION", "all", "name").map((a) => a.id)).toEqual(["ben"]);
    expect(filterAuthors(ITEMS, "viralsides", "all", "name").map((a) => a.id)).toEqual(["cara"]);
  });
  it("filters: exclusive, not on any site, incomplete", () => {
    expect(filterAuthors(ITEMS, "", "exclusive", "name").map((a) => a.id)).toEqual(["ella"]);
    expect(filterAuthors(ITEMS, "", "unassigned", "name").map((a) => a.id)).toEqual(["ben"]);
    expect(filterAuthors(ITEMS, "", "incomplete", "name").map((a) => a.id)).toEqual(["ben"]);
  });
  it("sorts by recently updated, name, or number of sites", () => {
    expect(filterAuthors(ITEMS, "", "all", "updated").map((a) => a.id)).toEqual(["ben", "ella", "cara"]);
    expect(filterAuthors(ITEMS, "", "all", "name").map((a) => a.id)).toEqual(["ben", "cara", "ella"]);
    expect(filterAuthors(ITEMS, "", "all", "sites").map((a) => a.id)).toEqual(["cara", "ella", "ben"]);
  });
  it("counts per filter", () => {
    expect(filterCounts(ITEMS)).toEqual({ all: 3, exclusive: 1, unassigned: 1, incomplete: 1 });
  });
});
