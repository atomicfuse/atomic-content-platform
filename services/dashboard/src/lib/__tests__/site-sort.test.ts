import { describe, it, expect } from "vitest";
import { nextSort, sortSites, type SiteSortContext } from "../site-sort";
import type { DashboardSiteEntry } from "@/types/dashboard";

function site(domain: string, extra: Partial<DashboardSiteEntry> = {}): DashboardSiteEntry {
  return { domain, vertical: "", status: "Live", ...extra } as DashboardSiteEntry;
}

const CTX: SiteSortContext = {
  articleCounts: { a: 5, b: 1, c: 9 },
  latestArticles: { a: "2026-10-01T10", b: "2026-10-05T10:00:00Z" },
  siteGroups: { a: ["ncg"], b: ["atl"], c: [], d: ["atl", "mock-ads"] },
  groupNames: { atl: "ATL", ncg: "NCG", "mock-ads": "Mock Ads" },
};

const domains = (sites: DashboardSiteEntry[]): string[] => sites.map((s) => s.domain);

describe("nextSort", () => {
  it("cycles asc → desc → off on the same column", () => {
    const asc = nextSort(null, "group");
    expect(asc).toEqual({ key: "group", dir: "asc" });
    const desc = nextSort(asc, "group");
    expect(desc).toEqual({ key: "group", dir: "desc" });
    expect(nextSort(desc, "group")).toBeNull();
  });

  it("starts ascending when switching to another column", () => {
    expect(nextSort({ key: "group", dir: "desc" }, "category")).toEqual({ key: "category", dir: "asc" });
  });
});

describe("sortSites", () => {
  const sites = [site("a"), site("b"), site("c"), site("d")];

  it("returns the input order when there is no sort", () => {
    expect(domains(sortSites(sites, null, CTX))).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const input = [...sites];
    sortSites(input, { key: "group", dir: "asc" }, CTX);
    expect(domains(input)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by group display name, ungrouped sites last in both directions", () => {
    expect(domains(sortSites(sites, { key: "group", dir: "asc" }, CTX))).toEqual(["b", "d", "a", "c"]);
    expect(domains(sortSites(sites, { key: "group", dir: "desc" }, CTX))).toEqual(["a", "d", "b", "c"]);
  });

  it("sorts by category case-insensitively, empty categories last", () => {
    const withCats = [
      site("x", { vertical: "Travel" }),
      site("y", { vertical: "" }),
      site("z", { vertical: "entertainment" }),
      site("w", { vertical: "Food & Drink" }),
    ];
    expect(domains(sortSites(withCats, { key: "category", dir: "asc" }, CTX))).toEqual(["z", "w", "x", "y"]);
    expect(domains(sortSites(withCats, { key: "category", dir: "desc" }, CTX))).toEqual(["x", "w", "z", "y"]);
  });

  it("keeps the existing Website / Articles / Last Articles / Created behaviour", () => {
    const named = [site("b.com"), site("a.com", { custom_domain: "zz.com" }), site("c.com")];
    expect(domains(sortSites(named, { key: "website", dir: "asc" }, CTX))).toEqual(["b.com", "c.com", "a.com"]);
    expect(domains(sortSites(sites, { key: "articles", dir: "desc" }, CTX))).toEqual(["c", "a", "b", "d"]);
    expect(domains(sortSites(sites, { key: "lastArticles", dir: "desc" }, CTX))).toEqual(["b", "a", "c", "d"]);
    const dated = [site("old", { created_at: "2026-01-01" }), site("new", { created_at: "2026-09-01" })];
    expect(domains(sortSites(dated, { key: "created", dir: "desc" }, CTX))).toEqual(["new", "old"]);
  });
});
