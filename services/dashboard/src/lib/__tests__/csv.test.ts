import { describe, it, expect } from "vitest";
import { escapeCsvField, buildSitesCsv, sitesCsvFilename, SITES_CSV_COLUMNS } from "../csv";
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

describe("escapeCsvField", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeCsvField("coolnews")).toBe("coolnews");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("News, Tech")).toBe('"News, Tech"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('Say "hi"')).toBe('"Say ""hi"""');
  });

  it("quotes fields containing a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("quotes fields containing a carriage return", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });
});

describe("buildSitesCsv", () => {
  it("emits the header in the documented column order", () => {
    const csv = buildSitesCsv([], {});
    const [header] = csv.split("\n");
    expect(header).toBe(
      "domain,custom_domain,status,company,category,groups,created_at,last_updated,staging_preview_url",
    );
    expect(SITES_CSV_COLUMNS).toEqual([
      "domain",
      "custom_domain",
      "status",
      "company",
      "category",
      "groups",
      "created_at",
      "last_updated",
      "staging_preview_url",
    ]);
  });

  it("exports rows in the given order with mapped columns", () => {
    const rows = [
      makeSite({ domain: "site-a", custom_domain: "a.com" }),
      makeSite({ domain: "site-b", custom_domain: "b.com" }),
    ];
    const csv = buildSitesCsv(rows, {});
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain("site-a");
    expect(lines[1]).toContain("a.com");
    expect(lines[2]).toContain("site-b");
    expect(lines[2]).toContain("b.com");
  });

  it("joins group ids with a semicolon", () => {
    const rows = [makeSite({ domain: "site-a" })];
    const csv = buildSitesCsv(rows, { "site-a": ["ready", "premium"] });
    const dataLine = csv.trim().split("\n")[1]!;
    expect(dataLine).toContain("ready;premium");
  });

  it("writes an empty groups cell when the site has no groups", () => {
    const rows = [makeSite({ domain: "site-a" })];
    const csv = buildSitesCsv(rows, {});
    const cols = csv.trim().split("\n")[1]!.split(",");
    // groups is the 6th column (index 5)
    expect(cols[5]).toBe("");
  });

  it("quotes a category value containing a comma", () => {
    const rows = [makeSite({ vertical: "Food, Drink" })];
    const csv = buildSitesCsv(rows, {});
    expect(csv).toContain('"Food, Drink"');
  });

  it("quotes a value containing an embedded newline", () => {
    const rows = [makeSite({ domain: "site-a\nweird" })];
    const csv = buildSitesCsv(rows, {});
    expect(csv).toContain('"site-a\nweird"');
  });

  it("renders null/empty optional fields as empty cells", () => {
    const rows = [makeSite({ custom_domain: null, preview_url: null, company: null })];
    const csv = buildSitesCsv(rows, {});
    const cols = csv.trim().split("\n")[1]!.split(",");
    expect(cols[1]).toBe(""); // custom_domain
    expect(cols[3]).toBe(""); // company
    expect(cols[8]).toBe(""); // staging_preview_url
  });

  describe("formula-injection protection", () => {
    it.each(["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1)"])(
      "prefixes a value starting with %s with an apostrophe",
      (dangerous) => {
        const rows = [makeSite({ domain: dangerous })];
        const csv = buildSitesCsv(rows, {});
        const firstCol = csv.trim().split("\n")[1]!.split(",")[0];
        expect(firstCol).toBe(`'${dangerous}`);
      },
    );

    it("does not prefix an ordinary value", () => {
      const rows = [makeSite({ domain: "coolnews" })];
      const csv = buildSitesCsv(rows, {});
      const firstCol = csv.trim().split("\n")[1]!.split(",")[0];
      expect(firstCol).toBe("coolnews");
    });
  });
});

describe("sitesCsvFilename", () => {
  it("formats as sites-YYYY-MM-DD.csv", () => {
    const fixed = new Date(2026, 0, 5); // Jan 5, 2026 (local)
    expect(sitesCsvFilename(fixed)).toBe("sites-2026-01-05.csv");
  });

  it("zero-pads single-digit month and day", () => {
    const fixed = new Date(2026, 8, 9); // Sep 9, 2026
    expect(sitesCsvFilename(fixed)).toBe("sites-2026-09-09.csv");
  });
});
