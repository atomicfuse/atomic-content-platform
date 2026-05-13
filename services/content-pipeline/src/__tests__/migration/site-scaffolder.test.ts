import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
  domainToSiteId,
  buildSiteYaml,
} from "../../agents/migration/site-scaffolder.js";
import type { CsvSiteRow } from "../../agents/migration/types.js";

describe("domainToSiteId", () => {
  it("strips .com and lowercases", () => {
    expect(domainToSiteId("Muvizz.com")).toBe("muvizz");
  });

  it("strips .net", () => {
    expect(domainToSiteId("example.net")).toBe("example");
  });

  it("strips .org", () => {
    expect(domainToSiteId("nonprofit.org")).toBe("nonprofit");
  });

  it("strips .io", () => {
    expect(domainToSiteId("startup.io")).toBe("startup");
  });

  it("strips .tv", () => {
    expect(domainToSiteId("stream.tv")).toBe("stream");
  });

  it("strips .info", () => {
    expect(domainToSiteId("data.info")).toBe("data");
  });

  it("strips .co.uk", () => {
    expect(domainToSiteId("shop.co.uk")).toBe("shop");
  });

  it("strips .dev", () => {
    expect(domainToSiteId("coolnews.dev")).toBe("coolnews");
  });

  it("removes non-alphanumeric characters", () => {
    expect(domainToSiteId("travel-beauty-tips.com")).toBe("travelbeautytips");
  });

  it("handles domains with hyphens and numbers", () => {
    expect(domainToSiteId("my-site-123.net")).toBe("mysite123");
  });

  it("trims whitespace", () => {
    expect(domainToSiteId("  example.com  ")).toBe("example");
  });
});

describe("buildSiteYaml", () => {
  const fullRow: CsvSiteRow = {
    name: "travelbeautytips.com",
    domain: "travelbeautytips.com",
    websiteCategory: "Style & Fashion",
    menuItems: ["Beauty", "Fashion", "Hair", "Nails"],
    iabCategories: ["Style & Fashion", "Health & Fitness"],
    subCategories: ["Beauty", "Skincare"],
    colorPalette: {
      primary: "#F43656",
      secondary: "#C87137",
    },
    logoUrl: "https://travelbeautytips.com/wp-content/uploads/logo.png",
    faviconUrl: "https://travelbeautytips.com/wp-content/uploads/favicon.png",
    postsApiUrl: "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=75",
    gaInfo: {
      gaPropertyId: "328395426",
      gaMeasurementId: "G-HL2D8CQ0Z9",
      gtmId: "GT-5R65N74B",
    },
  };

  it("produces valid YAML that can be parsed", () => {
    const yamlStr = buildSiteYaml(fullRow);
    const parsed = parse(yamlStr);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("sets domain to the site ID (stripped TLD, lowercased)", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.domain).toBe("travelbeautytips");
  });

  it("sets active to true", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.active).toBe(true);
  });

  it("includes brief with vertical and topics from iabCategories", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.brief.vertical).toBe("Style & Fashion");
    expect(parsed.brief.topics).toEqual(["Style & Fashion", "Health & Fitness"]);
  });

  it("includes schedule in brief", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.brief.schedule.articles_per_day).toBe(3);
    expect(parsed.brief.schedule.preferred_days).toContain("monday");
  });

  it("includes theme with colors from colorPalette", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.theme.colors.primary).toBe("#F43656");
    expect(parsed.theme.colors.secondary).toBe("#C87137");
  });

  it("includes layout with categories from menuItems", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.layout.categories).toEqual(["Beauty", "Fashion", "Hair", "Nails"]);
    expect(parsed.layout.hero.enabled).toBe(true);
    expect(parsed.layout.must_reads.enabled).toBe(true);
  });

  it("includes tracking from gaInfo", () => {
    const parsed = parse(buildSiteYaml(fullRow));
    expect(parsed.tracking.ga4).toBe("G-HL2D8CQ0Z9");
    expect(parsed.tracking.gtm).toBe("GT-5R65N74B");
  });

  it("omits tracking when gaInfo is empty", () => {
    const row: CsvSiteRow = { ...fullRow, gaInfo: {} };
    const parsed = parse(buildSiteYaml(row));
    expect(parsed.tracking).toBeUndefined();
  });

  it("includes only present GA fields in tracking", () => {
    const row: CsvSiteRow = {
      ...fullRow,
      gaInfo: { gaMeasurementId: "G-ABC123" },
    };
    const parsed = parse(buildSiteYaml(row));
    expect(parsed.tracking).toEqual({ ga4: "G-ABC123" });
  });

  it("falls back to websiteCategory for topics when iabCategories is empty", () => {
    const row: CsvSiteRow = { ...fullRow, iabCategories: [] };
    const parsed = parse(buildSiteYaml(row));
    expect(parsed.brief.topics).toEqual(["Style & Fashion"]);
  });

  it("uses default colors when colorPalette is empty", () => {
    const row: CsvSiteRow = { ...fullRow, colorPalette: {} };
    const parsed = parse(buildSiteYaml(row));
    expect(parsed.theme.colors.primary).toBe("#333333");
    expect(parsed.theme.colors.secondary).toBe("#666666");
  });
});
