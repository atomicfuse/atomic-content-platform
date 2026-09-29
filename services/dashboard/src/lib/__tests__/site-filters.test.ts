import { describe, it, expect } from "vitest";
import {
  filterSites,
  categoryMatches,
  extraCategoryOptions,
  NO_COMPANY,
  NO_GROUP,
  type SiteListFilters,
} from "../site-filters";
import type { DashboardSiteEntry } from "@/types/dashboard";

function makeSite(overrides: Partial<DashboardSiteEntry> = {}): DashboardSiteEntry {
  return {
    domain: "coolnews",
    company: "ATL",
    vertical: "News",
    status: "Live",
    site_id: "site_123",
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: "2026-01-01T00:00:00Z",
    created_at: "2025-06-15T00:00:00Z",
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: "staging/coolnews",
    preview_url: "https://coolnews.pages.dev",
    saved_previews: null,
    custom_domain: "coolnews.dev",
    ...overrides,
  };
}

const NO_FILTERS: SiteListFilters = {
  search: "",
  company: "",
  vertical: "",
  status: "",
  group: "",
};

describe("categoryMatches", () => {
  it("matches identical strings", () => {
    expect(categoryMatches("News", "News")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(categoryMatches("news", "NEWS")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(categoryMatches("  News  ", "News")).toBe(true);
  });

  it("does not over-normalise & vs and", () => {
    expect(categoryMatches("Food & Drink", "Food and Drink")).toBe(false);
  });

  it("empty filter matches everything", () => {
    expect(categoryMatches("Anything", "")).toBe(true);
  });

  it("rejects a genuinely different category", () => {
    expect(categoryMatches("News", "Travel")).toBe(false);
  });
});

describe("filterSites", () => {
  const sites = [
    makeSite({ domain: "atl-news", custom_domain: "atlnews.com", company: "ATL", vertical: "News", status: "Live" }),
    makeSite({ domain: "ngc-travel", custom_domain: "ngctravel.com", company: "NGC", vertical: "Travel", status: "Staging" }),
    makeSite({ domain: "no-company-site", custom_domain: null, company: null, vertical: "Food & Drink", status: "Ready" }),
  ];
  const siteGroups: Record<string, string[]> = {
    "atl-news": ["ready"],
    "ngc-travel": [],
    // no-company-site intentionally absent (never assigned any groups)
  };

  it("returns every site when no filters are set", () => {
    expect(filterSites(sites, NO_FILTERS, siteGroups)).toHaveLength(3);
  });

  it("filters by search on domain", () => {
    const result = filterSites(sites, { ...NO_FILTERS, search: "atl-news" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["atl-news"]);
  });

  it("filters by search on custom_domain", () => {
    const result = filterSites(sites, { ...NO_FILTERS, search: "ngctravel" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["ngc-travel"]);
  });

  it("search is case-insensitive", () => {
    const result = filterSites(sites, { ...NO_FILTERS, search: "ATLNEWS" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["atl-news"]);
  });

  it("filters by company", () => {
    const result = filterSites(sites, { ...NO_FILTERS, company: "NGC" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["ngc-travel"]);
  });

  it("filters by 'No company' sentinel — matches null company", () => {
    const result = filterSites(sites, { ...NO_FILTERS, company: NO_COMPANY }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["no-company-site"]);
  });

  it("filters by category with case-insensitive tolerance", () => {
    const result = filterSites(sites, { ...NO_FILTERS, vertical: "news" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["atl-news"]);
  });

  it("filters by status", () => {
    const result = filterSites(sites, { ...NO_FILTERS, status: "Staging" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["ngc-travel"]);
  });

  it("filters by a specific group id", () => {
    const result = filterSites(sites, { ...NO_FILTERS, group: "ready" }, siteGroups);
    expect(result.map((s) => s.domain)).toEqual(["atl-news"]);
  });

  it("filters by 'No group' sentinel — matches empty and absent group lists", () => {
    const result = filterSites(sites, { ...NO_FILTERS, group: NO_GROUP }, siteGroups);
    expect(result.map((s) => s.domain).sort()).toEqual(["no-company-site", "ngc-travel"].sort());
  });

  it("combines multiple filters", () => {
    const result = filterSites(
      sites,
      { ...NO_FILTERS, company: "ATL", status: "Live", group: "ready" },
      siteGroups,
    );
    expect(result.map((s) => s.domain)).toEqual(["atl-news"]);
  });

  it("combining filters that match no site returns empty", () => {
    const result = filterSites(sites, { ...NO_FILTERS, company: "ATL", status: "Staging" }, siteGroups);
    expect(result).toHaveLength(0);
  });
});

describe("extraCategoryOptions", () => {
  it("returns categories present on sites but missing from the known list", () => {
    const result = extraCategoryOptions(["News", "Underwater Basket Weaving"], ["News", "Travel"]);
    expect(result).toEqual(["Underwater Basket Weaving"]);
  });

  it("is case-insensitive when checking against known names", () => {
    const result = extraCategoryOptions(["news"], ["News"]);
    expect(result).toEqual([]);
  });

  it("de-duplicates repeated extra values", () => {
    const result = extraCategoryOptions(["Custom", "Custom", "custom"], []);
    expect(result).toEqual(["Custom"]);
  });

  it("ignores empty/blank vertical values", () => {
    const result = extraCategoryOptions(["", "   "], []);
    expect(result).toEqual([]);
  });
});
