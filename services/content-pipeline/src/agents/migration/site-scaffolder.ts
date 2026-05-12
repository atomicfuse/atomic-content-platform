import { stringify } from "yaml";
import type { CsvSiteRow } from "./types.js";

/**
 * Convert a domain like "travelbeautytips.com" into a site ID
 * by stripping the TLD, removing non-alphanumeric chars, and lowercasing.
 */
export function domainToSiteId(domain: string): string {
  const stripped = domain
    .trim()
    .toLowerCase()
    // Multi-part TLDs first, then single-part
    .replace(/\.(co\.uk)$/, "")
    .replace(/\.(com|net|org|io|tv|info|dev)$/, "");

  return stripped.replace(/[^a-z0-9]/g, "");
}

interface SiteYamlShape {
  domain: string;
  active: boolean;
  groups: string[];
  brief: {
    siteName: string;
    vertical: string;
    language: string;
    topics: string[];
    schedule: {
      articles_per_day: number;
      preferred_days: string[];
    };
    quality_threshold: number;
  };
  theme: {
    base: string;
    logo: string;
    favicon: string;
    colors: Record<string, string>;
  };
  site_name: string;
  layout: {
    hero: { enabled: boolean; count: number };
    must_reads: { enabled: boolean; count: number };
    categories: string[];
  };
  tracking?: {
    ga_property_id?: string;
    ga_measurement_id?: string;
    gtm_id?: string;
  };
}

/**
 * Build a site.yaml string from a parsed CSV row.
 */
export function buildSiteYaml(row: CsvSiteRow): string {
  const siteId = domainToSiteId(row.name);
  const siteName = row.name.replace(/\.[^.]+$/, ""); // strip last TLD segment for display

  const doc: SiteYamlShape = {
    domain: siteId,
    active: true,
    groups: [],
    brief: {
      siteName: row.name,
      vertical: row.websiteCategory || "General",
      language: "EN",
      topics: row.iabCategories.length > 0 ? row.iabCategories : [row.websiteCategory || "General"],
      schedule: {
        articles_per_day: 3,
        preferred_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      quality_threshold: 75,
    },
    theme: {
      base: "modern",
      logo: "/assets/logo.png",
      favicon: "/assets/favicon.png",
      colors: Object.keys(row.colorPalette).length > 0
        ? row.colorPalette
        : { primary: "#333333", secondary: "#666666" },
    },
    site_name: row.name,
    layout: {
      hero: { enabled: true, count: 4 },
      must_reads: { enabled: true, count: 5 },
      categories: row.menuItems.length > 0 ? row.menuItems : [],
    },
  };

  // Add tracking if GA info is present
  const { gaPropertyId, gaMeasurementId, gtmId } = row.gaInfo;
  if (gaPropertyId || gaMeasurementId || gtmId) {
    const tracking: NonNullable<SiteYamlShape["tracking"]> = {};
    if (gaPropertyId) tracking.ga_property_id = gaPropertyId;
    if (gaMeasurementId) tracking.ga_measurement_id = gaMeasurementId;
    if (gtmId) tracking.gtm_id = gtmId;
    doc.tracking = tracking;
  }

  return stringify(doc);
}
