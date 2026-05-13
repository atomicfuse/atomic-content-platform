import { stringify } from "yaml";
import type { CsvSiteRow } from "./types.js";
import { expandThemeColors } from "./theme-builder.js";

/**
 * Convert a domain like "travelbeautytips.com" into a site ID
 * by stripping the TLD, removing non-alphanumeric chars, and lowercasing.
 */
export function domainToSiteId(domain: string): string {
  const lower = domain.trim().toLowerCase();
  const stripped = lower
    .replace(/\.(co\.uk|co\.nz|com\.au)$/, "")  // multi-part TLDs first
    .replace(/\.[a-z]{2,}$/, "");                // then any single-part TLD

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
    ga4?: string;
    gtm?: string;
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

  const { gaMeasurementId, gtmId } = row.gaInfo;
  if (gaMeasurementId || gtmId) {
    const tracking: NonNullable<SiteYamlShape["tracking"]> = {};
    if (gaMeasurementId) tracking.ga4 = gaMeasurementId;
    if (gtmId) tracking.gtm = gtmId;
    doc.tracking = tracking;
  }

  return stringify(doc);
}

// ---------------------------------------------------------------------------
// New wizard-equivalent helpers
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "James","Sarah","Michael","Elena","David","Olivia","Daniel","Sophia","Andrew","Maya",
  "Nathan","Rachel","Marcus","Ava","Ethan","Lily","Ryan","Chloe","Lucas","Emma",
  "Alex","Zoe","Ben","Mia","Sam","Julia","Leo","Hannah","Max","Nora",
];

const LAST_NAMES = [
  "Mitchell","Carter","Rodriguez","Chen","Bennett","Brooks","Sullivan","Kim","Parker","Hayes",
  "Foster","Reed","Morgan","Torres","Cooper","Bell","Ward","Rivera","Gray","Scott",
  "Adams","Murphy","Price","Ross","Perry","Powell","Long","Hughes","Sanders","West",
];

export function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]!;
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]!;
  return `${first} ${last}`;
}

export interface FullSiteConfig {
  domain: string;
  site_name: string;
  site_tagline: null;
  author: string;
  groups: string[];
  active: boolean;
  bundle_id?: string;
  brief: {
    audiences: string[];
    tone: string;
    article_types: Record<string, number>;
    topics: string[];
    seo_keywords_focus: string[];
    content_guidelines: string[];
    vertical?: string;
    vertical_id?: string;
    category_ids?: string[];
    tag_ids: string[];
    review_percentage: number;
    schedule: {
      articles_per_day: number;
      preferred_days: string[];
      preferred_time: string;
    };
  };
  theme: {
    base: string;
    colors: Record<string, string>;
    fonts: { heading: string; body: string };
    logo?: string;
    favicon?: string;
  };
  layout: {
    hero: { enabled: boolean; count: number };
    must_reads: { enabled: boolean; count: number };
    sidebar_topics: { auto: boolean; explicit: string[] };
    load_more: { page_size: number };
  };
  tracking?: {
    ga4?: string;
    gtm?: string;
  };
}

export function buildFullSiteConfig(
  row: CsvSiteRow,
  resolved: { verticalId: string; verticalName: string; categoryIds: string[]; bundleId: string | null } | null,
  author: string,
  hasLogo: boolean,
  hasFavicon: boolean,
): FullSiteConfig {
  const siteId = row.domain ? domainToSiteId(row.domain) : domainToSiteId(row.name);

  const config: FullSiteConfig = {
    domain: siteId,
    site_name: row.name || siteId,
    site_tagline: null,
    author,
    groups: ["mock-ads"],
    active: true,
    ...(resolved?.bundleId ? { bundle_id: resolved.bundleId } : {}),
    brief: {
      audiences: [`${row.websiteCategory || "General"} enthusiasts`],
      tone: "Engaging, informative, conversational",
      article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
      topics: row.menuItems.length > 0 ? row.menuItems : [row.websiteCategory || "General"],
      seo_keywords_focus: [],
      content_guidelines: [
        `Focus on ${row.websiteCategory || "general"} content`,
        "Maintain an engaging, reader-friendly tone",
      ],
      ...(resolved?.verticalName ?? row.websiteCategory
        ? { vertical: resolved?.verticalName ?? row.websiteCategory ?? undefined }
        : {}),
      ...(resolved?.verticalId ? { vertical_id: resolved.verticalId } : {}),
      ...(resolved
        ? { category_ids: [resolved.verticalId, ...resolved.categoryIds.filter((id) => id !== resolved.verticalId)] }
        : {}),
      tag_ids: [],
      review_percentage: 5,
      schedule: {
        articles_per_day: 2,
        preferred_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        preferred_time: "10:00",
      },
    },
    theme: {
      base: "modern",
      colors: expandThemeColors(row.colorPalette),
      fonts: { heading: "Poppins", body: "Inter" },
      ...(hasLogo ? { logo: "/assets/logo.png" } : {}),
      ...(hasFavicon ? { favicon: "/assets/favicon.png" } : {}),
    },
    layout: {
      hero: { enabled: true, count: 4 },
      must_reads: { enabled: true, count: 5 },
      sidebar_topics: { auto: true, explicit: [] },
      load_more: { page_size: 10 },
    },
  };

  const { gaMeasurementId, gtmId } = row.gaInfo;
  if (gaMeasurementId || gtmId) {
    const tracking: NonNullable<FullSiteConfig["tracking"]> = {};
    if (gaMeasurementId) tracking.ga4 = gaMeasurementId;
    if (gtmId) tracking.gtm = gtmId;
    config.tracking = tracking;
  }

  return config;
}

export function buildSkillMd(siteName: string, topics: string[], category: string): string {
  return `# Content Agent Instructions for ${siteName}

## Target Audiences
${category} enthusiasts

## Tone
Engaging, informative, conversational

## Topics
${topics.map((t) => `- ${t}`).join("\n")}

## Content Guidelines
Focus on ${category} content. Maintain an engaging, reader-friendly tone.

## Schedule
- 2 article(s) per day
- Preferred days: Monday, Tuesday, Wednesday, Thursday, Friday
`;
}
