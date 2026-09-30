import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SITE_COLUMNS,
  DEFAULT_VISIBLE_COLUMN_IDS,
  loadVisibleColumnIds,
  saveVisibleColumnIds,
  hasLiveColumn,
  getColumnById,
  formatSchedule,
  COLUMN_STORAGE_KEY,
  type SiteColumnContext,
  type LiveConfigEntry,
} from "../site-columns";
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

function emptyContext(overrides: Partial<SiteColumnContext> = {}): SiteColumnContext {
  return {
    siteGroups: {},
    articleCounts: {},
    latestArticles: {},
    liveConfig: {},
    ...overrides,
  };
}

function makeLiveEntry(overrides: Partial<LiveConfigEntry> = {}): LiveConfigEntry {
  return {
    template: null,
    ga4: null,
    facebook_pixel: null,
    gtm: null,
    google_ads: null,
    articles_per_day: null,
    publish_days: null,
    last_synced_at: null,
    ...overrides,
  };
}

describe("DEFAULT_VISIBLE_COLUMN_IDS", () => {
  it("matches today's table exactly, in today's order", () => {
    expect(DEFAULT_VISIBLE_COLUMN_IDS).toEqual([
      "company",
      "group",
      "category",
      "status",
      "articles",
      "lastArticles",
      "siteId",
      "created",
      "lastUpdated",
    ]);
  });

  it("does not include Website or Actions (they aren't SiteColumnDefs)", () => {
    const ids = SITE_COLUMNS.map((c) => c.id);
    expect(ids).not.toContain("website");
    expect(ids).not.toContain("actions");
  });

  it("new live/index columns default to hidden", () => {
    const hiddenIds = [
      "template",
      "ga4",
      "facebookPixel",
      "gtm",
      "googleAds",
      "articlesPerDay",
      "lastSync",
      "customDomain",
    ];
    for (const id of hiddenIds) {
      expect(getColumnById(id)?.defaultVisible).toBe(false);
    }
  });
});

describe("hasLiveColumn", () => {
  it("is false when no live column is visible", () => {
    expect(hasLiveColumn(DEFAULT_VISIBLE_COLUMN_IDS)).toBe(false);
  });

  it("is true once a live column id is included", () => {
    expect(hasLiveColumn([...DEFAULT_VISIBLE_COLUMN_IDS, "template"])).toBe(true);
    expect(hasLiveColumn(["ga4"])).toBe(true);
  });

  it("is false for the index-sourced customDomain column", () => {
    expect(hasLiveColumn(["customDomain"])).toBe(false);
  });
});

describe("csv accessors", () => {
  it("company falls back to empty string when null", () => {
    const col = getColumnById("company")!;
    expect(col.csv(makeSite({ company: null }), emptyContext())).toBe("");
    expect(col.csv(makeSite({ company: "NGC" }), emptyContext())).toBe("NGC");
  });

  it("group reads from siteGroups, joined with a semicolon", () => {
    const col = getColumnById("group")!;
    const site = makeSite({ domain: "site-a" });
    expect(col.csv(site, emptyContext({ siteGroups: { "site-a": ["ready", "premium"] } }))).toBe(
      "ready;premium",
    );
    expect(col.csv(site, emptyContext())).toBe("");
  });

  it("category reads site.vertical", () => {
    expect(getColumnById("category")!.csv(makeSite({ vertical: "Food" }), emptyContext())).toBe(
      "Food",
    );
  });

  it("status reads site.status", () => {
    expect(getColumnById("status")!.csv(makeSite({ status: "Staging" }), emptyContext())).toBe(
      "Staging",
    );
  });

  it("articles reads from articleCounts, empty when absent", () => {
    const col = getColumnById("articles")!;
    const site = makeSite({ domain: "site-a" });
    expect(col.csv(site, emptyContext({ articleCounts: { "site-a": 7 } }))).toBe("7");
    expect(col.csv(site, emptyContext())).toBe("");
  });

  it("lastArticles reads the raw ISO string from latestArticles", () => {
    const col = getColumnById("lastArticles")!;
    const site = makeSite({ domain: "site-a" });
    expect(
      col.csv(site, emptyContext({ latestArticles: { "site-a": "2026-01-02T00:00:00Z" } })),
    ).toBe("2026-01-02T00:00:00Z");
  });

  it("siteId falls back to empty string", () => {
    expect(getColumnById("siteId")!.csv(makeSite({ site_id: "" }), emptyContext())).toBe("");
  });

  it("created/lastUpdated read the raw date fields", () => {
    expect(
      getColumnById("created")!.csv(makeSite({ created_at: "2025-06-15T00:00:00Z" }), emptyContext()),
    ).toBe("2025-06-15T00:00:00Z");
    expect(
      getColumnById("lastUpdated")!.csv(makeSite({ last_updated: "2026-01-01T00:00:00Z" }), emptyContext()),
    ).toBe("2026-01-01T00:00:00Z");
  });

  it("customDomain falls back to empty string when null", () => {
    expect(getColumnById("customDomain")!.csv(makeSite({ custom_domain: null }), emptyContext())).toBe(
      "",
    );
    expect(
      getColumnById("customDomain")!.csv(makeSite({ custom_domain: "x.com" }), emptyContext()),
    ).toBe("x.com");
  });

  describe("template detection", () => {
    const col = getColumnById("template")!;
    const site = makeSite({ domain: "site-a" });

    it("maps 'grid' to 'Grid'", () => {
      const ctx = emptyContext({ liveConfig: { "site-a": makeLiveEntry({ template: "grid" }) } });
      expect(col.csv(site, ctx)).toBe("Grid");
    });

    it("maps 'modern' to 'Modern'", () => {
      const ctx = emptyContext({ liveConfig: { "site-a": makeLiveEntry({ template: "modern" }) } });
      expect(col.csv(site, ctx)).toBe("Modern");
    });

    it("is empty when the live entry is missing entirely", () => {
      expect(col.csv(site, emptyContext())).toBe("");
    });

    it("is empty when the live entry has a null template (failed read)", () => {
      const ctx = emptyContext({ liveConfig: { "site-a": makeLiveEntry({ template: null }) } });
      expect(col.csv(site, ctx)).toBe("");
    });
  });

  describe("tracking columns", () => {
    const site = makeSite({ domain: "site-a" });

    it("ga4/facebookPixel/gtm/googleAds read straight through, empty when null", () => {
      const ctx = emptyContext({
        liveConfig: {
          "site-a": makeLiveEntry({
            ga4: "G-123",
            facebook_pixel: "FB-1",
            gtm: "GTM-1",
            google_ads: "AW-1",
          }),
        },
      });
      expect(getColumnById("ga4")!.csv(site, ctx)).toBe("G-123");
      expect(getColumnById("facebookPixel")!.csv(site, ctx)).toBe("FB-1");
      expect(getColumnById("gtm")!.csv(site, ctx)).toBe("GTM-1");
      expect(getColumnById("googleAds")!.csv(site, ctx)).toBe("AW-1");

      expect(getColumnById("ga4")!.csv(site, emptyContext())).toBe("");
    });
  });

  describe("articles/day fallback", () => {
    const col = getColumnById("articlesPerDay")!;
    const site = makeSite({ domain: "site-a" });

    it("uses articles_per_day directly when present", () => {
      const ctx = emptyContext({
        liveConfig: { "site-a": makeLiveEntry({ articles_per_day: 3 }) },
      });
      expect(col.csv(site, ctx)).toBe("3/day · Every day");
    });

    it("is empty when the read failed (null)", () => {
      expect(col.csv(site, emptyContext())).toBe("");
    });

    it("is '0' only if explicitly resolved to 0 (falls through the ?? check)", () => {
      const ctx = emptyContext({
        liveConfig: { "site-a": makeLiveEntry({ articles_per_day: 0 }) },
      });
      expect(col.csv(site, ctx)).toBe("0/day · Every day");
    });

    it("shows the publishing days in week order", () => {
      const ctx = emptyContext({
        liveConfig: {
          "site-a": makeLiveEntry({ articles_per_day: 2, publish_days: ["friday", "Monday", "wednesday"] }),
        },
      });
      expect(col.csv(site, ctx)).toBe("2/day · Mon, Wed, Fri");
    });
  });

  describe("formatSchedule", () => {
    it("summarises every day, weekdays and unknown names", () => {
      expect(formatSchedule(1, null)).toBe("1/day · Every day");
      expect(formatSchedule(1, [])).toBe("1/day · Every day");
      expect(
        formatSchedule(1, ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
      ).toBe("1/day · Every day");
      expect(formatSchedule(4, ["monday", "tuesday", "wednesday", "thursday", "friday"])).toBe("4/day · Weekdays");
      expect(formatSchedule(1, ["sunday", "funday"])).toBe("1/day · Sun, funday");
      expect(formatSchedule(null, ["monday"])).toBe("");
    });
  });

  it("lastSync reads the raw ISO syncedAt value", () => {
    const col = getColumnById("lastSync")!;
    const site = makeSite({ domain: "site-a" });
    const ctx = emptyContext({
      liveConfig: { "site-a": makeLiveEntry({ last_synced_at: "2026-01-05T10:00:00Z" }) },
    });
    expect(col.csv(site, ctx)).toBe("2026-01-05T10:00:00Z");
    expect(col.csv(site, emptyContext())).toBe("");
  });
});

describe("loadVisibleColumnIds / saveVisibleColumnIds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("returns the defaults when nothing is stored", () => {
    expect(loadVisibleColumnIds()).toEqual(DEFAULT_VISIBLE_COLUMN_IDS);
  });

  it("round-trips a saved selection", () => {
    saveVisibleColumnIds(["company", "template"]);
    expect(loadVisibleColumnIds()).toEqual(["company", "template"]);
    expect(window.localStorage.getItem(COLUMN_STORAGE_KEY)).toBe(
      JSON.stringify(["company", "template"]),
    );
  });

  it("drops unknown ids and falls back to defaults if nothing valid remains", () => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(["not-a-real-column"]));
    expect(loadVisibleColumnIds()).toEqual([]);
  });

  it("falls back to defaults on corrupt JSON", () => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, "{not json");
    expect(loadVisibleColumnIds()).toEqual(DEFAULT_VISIBLE_COLUMN_IDS);
  });

  it("falls back to defaults when localStorage.getItem throws", () => {
    vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadVisibleColumnIds()).toEqual(DEFAULT_VISIBLE_COLUMN_IDS);
  });

  it("saveVisibleColumnIds does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveVisibleColumnIds(["company"])).not.toThrow();
  });
});
