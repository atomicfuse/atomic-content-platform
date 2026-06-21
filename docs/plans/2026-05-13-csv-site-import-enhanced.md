# Enhanced CSV Site Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bare-bones CSV site creator with a full wizard-equivalent flow that creates complete sites (branch, config, bundle, theme, logo, dashboard-index, KV sync) then offers inline article import.

**Architecture:** The content-pipeline backend does all heavy lifting via a new SSE endpoint (`POST /wp-migrate/create-sites-full`). It processes sites sequentially, streaming progress per site. The dashboard frontend (`CsvSiteCreator.tsx`) consumes SSE, shows per-site results, and offers "Import Articles" buttons that trigger the existing WP migration SSE flow inline.

**Tech Stack:** TypeScript, Node HTTP server (content-pipeline), React (dashboard), GitHub Git Data API (Octokit), Content Aggregator REST API, SSE streaming.

---

### Task 1: Add category resolution + bundle creation to content-pipeline

**Files:**

- Create: `services/content-pipeline/src/agents/migration/category-resolver.ts`
- Test: `services/content-pipeline/src/__tests__/migration/category-resolver.test.ts`

**Context:** The content aggregator API at `CONTENT_API_BASE_URL ?? CONTENT_AGGREGATOR_URL` (with `/api` suffix) has these endpoints:

- `GET /api/categories?parent_id=null` — list verticals (tier-1 categories)
- `GET /api/categories?parent_id={id}` — list subcategories under a vertical
- `POST /api/bundles` — create content bundle

The CSV has `Website Category` (e.g. "Style & Fashion"), `IAB Top Categories (Vertical)` (e.g. "Style & Fashion, Healthy Living"), and `Sub Categories` (e.g. "Hair Care, Makeup and Accessories"). We need to match these strings to real aggregator IDs.

**Step 1: Create `category-resolver.ts`**

```typescript
// services/content-pipeline/src/agents/migration/category-resolver.ts

interface AggregatorCategory {
  _id: string;
  name: string;
  iab_code?: string;
  parent_id: string | null;
}

interface ResolvedCategories {
  verticalId: string | null;
  verticalName: string | null;
  categoryIds: string[];
  bundleId: string | null;
}

/**
 * Get the effective aggregator base URL.
 * CONTENT_API_BASE_URL takes priority over CONTENT_AGGREGATOR_URL
 * (the latter is auto-injected by CloudGrid and stale).
 */
function getAggregatorUrl(): string {
  const raw =
    process.env.CONTENT_API_BASE_URL ??
    process.env.CONTENT_AGGREGATOR_URL ??
    "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";
  return raw.replace(/\/api\/?$/, "");
}

/**
 * Fetch all verticals (tier-1 categories with parent_id=null).
 */
export async function fetchVerticals(): Promise<AggregatorCategory[]> {
  const url = `${getAggregatorUrl()}/api/categories?parent_id=null&active=true&page_size=200`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(
      `[category-resolver] Failed to fetch verticals: ${res.status}`,
    );
    return [];
  }
  const data = (await res.json()) as { results?: AggregatorCategory[] };
  return data.results ?? [];
}

/**
 * Fetch subcategories under a vertical.
 */
export async function fetchSubcategories(
  parentId: string,
): Promise<AggregatorCategory[]> {
  const url = `${getAggregatorUrl()}/api/categories?parent_id=${parentId}&active=true&page_size=200`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: AggregatorCategory[] };
  return data.results ?? [];
}

/**
 * Match a CSV "Website Category" string to a vertical by fuzzy name match.
 * Tries exact match first, then case-insensitive includes.
 */
export function matchVertical(
  name: string,
  verticals: AggregatorCategory[],
): AggregatorCategory | null {
  const lower = name.trim().toLowerCase();
  // Exact match
  const exact = verticals.find((v) => v.name.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  const partial = verticals.find(
    (v) =>
      v.name.toLowerCase().includes(lower) ||
      lower.includes(v.name.toLowerCase()),
  );
  return partial ?? null;
}

/**
 * Match CSV subcategory strings to real subcategory IDs under a vertical.
 */
export function matchSubcategories(
  names: string[],
  available: AggregatorCategory[],
): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const lower = name.trim().toLowerCase();
    const match = available.find(
      (c) =>
        c.name.toLowerCase() === lower ||
        c.name.toLowerCase().includes(lower) ||
        lower.includes(c.name.toLowerCase()),
    );
    if (match) ids.push(match._id);
  }
  return ids;
}

/**
 * Create a content bundle on the aggregator.
 * Returns the bundle ID or null on failure.
 */
export async function createBundle(
  name: string,
  verticalId: string,
  categoryIds: string[],
): Promise<string | null> {
  const allCategoryIds = [
    verticalId,
    ...categoryIds.filter((id) => id !== verticalId),
  ];
  const payload = {
    name,
    description: `Auto-created content bundle for ${name}`,
    active: true,
    rules: { category_ids: allCategoryIds, tag_ids: [] },
  };

  const url = `${getAggregatorUrl()}/api/bundles`;

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Handle 409 duplicate
  if (res.status === 409) {
    payload.name = `${name} (2)`;
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  if (res.ok) {
    const bundle = (await res.json()) as { id?: string; _id?: string };
    return bundle.id ?? bundle._id ?? null;
  }

  console.warn(`[category-resolver] Bundle creation failed: ${res.status}`);
  return null;
}

/**
 * Full resolution pipeline for one CSV row:
 * 1. Match Website Category → vertical
 * 2. Fetch subcategories, match Sub Categories → category IDs
 * 3. Create bundle
 */
export async function resolveCategories(
  websiteCategory: string,
  subCategoryNames: string[],
  siteName: string,
): Promise<ResolvedCategories> {
  const verticals = await fetchVerticals();
  const vertical = matchVertical(websiteCategory, verticals);

  if (!vertical) {
    console.warn(
      `[category-resolver] No vertical match for "${websiteCategory}"`,
    );
    return {
      verticalId: null,
      verticalName: null,
      categoryIds: [],
      bundleId: null,
    };
  }

  const subcategories = await fetchSubcategories(vertical._id);
  const categoryIds = matchSubcategories(subCategoryNames, subcategories);

  // If no subcategories matched, use all available subcategory IDs
  const finalCategoryIds =
    categoryIds.length > 0 ? categoryIds : subcategories.map((c) => c._id);

  let bundleId: string | null = null;
  if (finalCategoryIds.length > 0) {
    bundleId = await createBundle(siteName, vertical._id, finalCategoryIds);
  }

  return {
    verticalId: vertical._id,
    verticalName: vertical.name,
    categoryIds: finalCategoryIds,
    bundleId,
  };
}
```

**Step 2: Write tests**

```typescript
// services/content-pipeline/src/__tests__/migration/category-resolver.test.ts

import { describe, it, expect } from "vitest";
import {
  matchVertical,
  matchSubcategories,
  domainToSiteId,
} from "../../agents/migration/category-resolver.js";

const MOCK_VERTICALS = [
  { _id: "v1", name: "Style & Fashion", parent_id: null },
  { _id: "v2", name: "Technology & Computing", parent_id: null },
  { _id: "v3", name: "Healthy Living", parent_id: null },
];

const MOCK_SUBCATEGORIES = [
  { _id: "c1", name: "Hair Care", parent_id: "v1" },
  { _id: "c2", name: "Makeup and Accessories", parent_id: "v1" },
  { _id: "c3", name: "Nail Care", parent_id: "v1" },
  { _id: "c4", name: "Skin Care", parent_id: "v1" },
];

describe("matchVertical", () => {
  it("matches exact name", () => {
    const result = matchVertical("Style & Fashion", MOCK_VERTICALS);
    expect(result?._id).toBe("v1");
  });

  it("matches case-insensitive", () => {
    const result = matchVertical("style & fashion", MOCK_VERTICALS);
    expect(result?._id).toBe("v1");
  });

  it("returns null for no match", () => {
    const result = matchVertical("Nonexistent", MOCK_VERTICALS);
    expect(result).toBeNull();
  });
});

describe("matchSubcategories", () => {
  it("matches multiple subcategories by name", () => {
    const ids = matchSubcategories(
      ["Hair Care", "Skin Care"],
      MOCK_SUBCATEGORIES,
    );
    expect(ids).toEqual(["c1", "c4"]);
  });

  it("returns empty array for no matches", () => {
    const ids = matchSubcategories(["Nonexistent"], MOCK_SUBCATEGORIES);
    expect(ids).toEqual([]);
  });
});
```

**Step 3: Run tests**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/category-resolver.test.ts
```

**Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/migration/category-resolver.ts \
      services/content-pipeline/src/__tests__/migration/category-resolver.test.ts
git commit -m "feat(migration): add category resolver for CSV site import"
```

---

### Task 2: Add theme color expansion utility

**Files:**

- Create: `services/content-pipeline/src/agents/migration/theme-builder.ts`
- Test: `services/content-pipeline/src/__tests__/migration/theme-builder.test.ts`

**Context:** The CSV provides 5 colors (primary, secondary, accent, text, background). The site-worker needs 19 color keys. The wizard uses preset definitions in `services/dashboard/src/components/wizard/StepTheme.tsx:35-102`. The backend needs to derive the 14 missing colors from the 5 provided.

**Step 1: Create `theme-builder.ts`**

```typescript
// services/content-pipeline/src/agents/migration/theme-builder.ts

/**
 * Determine if a hex color is dark using relative luminance.
 */
function isDark(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/**
 * Lighten or darken a hex color by a factor (-1 to 1).
 * Positive = lighter, negative = darker.
 */
function adjustBrightness(hex: string, factor: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);

  const adjust = (v: number): number => {
    if (factor > 0) return Math.round(v + (255 - v) * factor);
    return Math.round(v * (1 + factor));
  };

  const rr = Math.min(255, Math.max(0, adjust(r)))
    .toString(16)
    .padStart(2, "0");
  const gg = Math.min(255, Math.max(0, adjust(g)))
    .toString(16)
    .padStart(2, "0");
  const bb = Math.min(255, Math.max(0, adjust(b)))
    .toString(16)
    .padStart(2, "0");

  return `#${rr}${gg}${bb}`;
}

/**
 * Mix two hex colors by a ratio (0 = all color1, 1 = all color2).
 */
function mixColors(hex1: string, hex2: string, ratio: number): string {
  const c1 = hex1.replace("#", "");
  const c2 = hex2.replace("#", "");
  const r1 = parseInt(c1.slice(0, 2), 16);
  const g1 = parseInt(c1.slice(2, 4), 16);
  const b1 = parseInt(c1.slice(4, 6), 16);
  const r2 = parseInt(c2.slice(0, 2), 16);
  const g2 = parseInt(c2.slice(2, 4), 16);
  const b2 = parseInt(c2.slice(4, 6), 16);
  const r = Math.round(r1 + (r2 - r1) * ratio)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(g1 + (g2 - g1) * ratio)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(b1 + (b2 - b1) * ratio)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

interface CsvColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  text?: string;
  background?: string;
}

/**
 * Expand 5 CSV colors into the full 19-color theme palette.
 * Derives missing colors intelligently from the provided ones.
 */
export function expandThemeColors(csv: CsvColors): Record<string, string> {
  const primary = csv.primary ?? "#1a1a2e";
  const secondary = csv.secondary ?? primary;
  const accent = csv.accent ?? "#f4c542";
  const text = csv.text ?? "#1a1a2e";
  const background = csv.background ?? "#ffffff";

  const bgIsDark = isDark(background);
  const muted = mixColors(text, background, 0.5);
  const surface = bgIsDark
    ? adjustBrightness(background, 0.1)
    : adjustBrightness(background, -0.03);
  const border = bgIsDark
    ? adjustBrightness(background, 0.2)
    : adjustBrightness(background, -0.1);

  return {
    primary,
    secondary,
    accent,
    background,
    text,
    muted,
    surface,
    border,
    footer_bg: isDark(primary) ? primary : secondary,
    hero_title: "#ffffff",
    must_reads_title: "#ffffff",
    must_reads_bg: isDark(primary) ? primary : secondary,
    article_hero_title: "#ffffff",
    feed_title: text,
    feed_desc: mixColors(text, background, 0.2),
    feed_date: accent,
    category_header_text: bgIsDark ? "#ffffff" : "#1a1a1a",
    prose_heading: text,
    prose_body: mixColors(text, background, 0.15),
  };
}

/**
 * Build the full theme object for site.yaml.
 */
export function buildTheme(csvColors: CsvColors): {
  base: string;
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
} {
  return {
    base: "modern",
    colors: expandThemeColors(csvColors),
    fonts: { heading: "Poppins", body: "Inter" },
  };
}
```

**Step 2: Write tests**

```typescript
// services/content-pipeline/src/__tests__/migration/theme-builder.test.ts

import { describe, it, expect } from "vitest";
import { expandThemeColors } from "../../agents/migration/theme-builder.js";

describe("expandThemeColors", () => {
  it("returns all 19 color keys", () => {
    const colors = expandThemeColors({
      primary: "#F43656",
      secondary: "#C87137",
      accent: "#B80000",
      text: "#000000",
      background: "#FFFFFF",
    });
    const keys = Object.keys(colors);
    expect(keys).toHaveLength(19);
    expect(keys).toContain("primary");
    expect(keys).toContain("footer_bg");
    expect(keys).toContain("prose_body");
  });

  it("preserves provided colors", () => {
    const colors = expandThemeColors({ primary: "#FF0000" });
    expect(colors.primary).toBe("#FF0000");
  });

  it("uses defaults for missing colors", () => {
    const colors = expandThemeColors({});
    expect(colors.primary).toBe("#1a1a2e");
    expect(colors.hero_title).toBe("#ffffff");
  });
});
```

**Step 3: Run tests and commit**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/theme-builder.test.ts
git add services/content-pipeline/src/agents/migration/theme-builder.ts \
      services/content-pipeline/src/__tests__/migration/theme-builder.test.ts
git commit -m "feat(migration): add theme color expansion for CSV import"
```

---

### Task 3: Rewrite `handleCreateSites` as SSE endpoint with full wizard flow

**Files:**

- Modify: `services/content-pipeline/src/agents/migration/handler.ts` — rewrite `handleCreateSites`
- Modify: `services/content-pipeline/src/agents/migration/site-scaffolder.ts` — add `buildFullSiteConfig`, `buildSkillMd`
- Modify: `services/content-pipeline/src/agents/migration/csv-parser.ts` — add `domain` field to `CsvSiteRow`

**Context:** The current `handleCreateSites` creates bare site.yaml files in a batch commit. The new version must:

1. Stream SSE progress events per site
2. For each site: resolve categories, create bundle, expand theme, fetch logo/favicon, build full site.yaml + skill.md, create staging branch, commit all files, update dashboard-index on main, trigger KV sync
3. Match the exact structure of `wizard.ts:createSiteAndBuildStaging`

The content-pipeline already has Octokit and `commitBatch` (supports binary files via `BatchBinaryEntry`). It needs a `createBranch` helper since the existing one is in the dashboard.

**Step 1: Update `csv-parser.ts` — add `domain` field to `CsvSiteRow`**

In `services/content-pipeline/src/agents/migration/types.ts`, add `domain` field to `CsvSiteRow` if not present. Check what it currently has.

In `services/content-pipeline/src/agents/migration/csv-parser.ts:70`, update `parseCsvRow` to also read the `domain` column:

```typescript
domain: (row["domain"] ?? "").trim(),
```

**Step 2: Update `site-scaffolder.ts` — add full site config builder**

Replace the current `buildSiteYaml` with a comprehensive `buildFullSiteConfig` function that produces the exact same structure as `wizard.ts:createSiteAndBuildStaging`. The key differences from the current implementation:

```typescript
import { stringify } from "yaml";
import type { CsvSiteRow } from "./types.js";
import type { ResolvedCategories } from "./category-resolver.js";
import { expandThemeColors } from "./theme-builder.js";

// Keep existing domainToSiteId

interface FullSiteConfig {
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
    article_types: {
      listicle: number;
      standard: number;
      "how-to": number;
      review: number;
    };
    topics: string[];
    seo_keywords_focus: string[];
    content_guidelines: string[];
    vertical?: string;
    vertical_id?: string;
    category_ids?: string[];
    tag_ids?: string[];
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
  tracking?: Record<string, string>;
}

export function buildFullSiteConfig(
  row: CsvSiteRow,
  resolved: ResolvedCategories,
  author: string,
  hasLogo: boolean,
  hasFavicon: boolean,
): FullSiteConfig {
  const siteId = domainToSiteId(row.name);

  const config: FullSiteConfig = {
    domain: siteId,
    site_name: row.name,
    site_tagline: null,
    author,
    groups: ["mock-ads"],
    active: true,
    bundle_id: resolved.bundleId ?? undefined,
    brief: {
      audiences: [`${row.websiteCategory} enthusiasts`],
      tone: "Engaging, informative, conversational",
      article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
      topics:
        row.menuItems.length > 0
          ? row.menuItems
          : [row.websiteCategory || "General"],
      seo_keywords_focus: [],
      content_guidelines: [
        `Focus on ${row.websiteCategory} content`,
        "Maintain an engaging, reader-friendly tone",
      ],
      vertical: resolved.verticalName ?? row.websiteCategory ?? undefined,
      vertical_id: resolved.verticalId ?? undefined,
      category_ids: resolved.verticalId
        ? [
            resolved.verticalId,
            ...resolved.categoryIds.filter((id) => id !== resolved.verticalId),
          ]
        : resolved.categoryIds.length > 0
          ? resolved.categoryIds
          : undefined,
      tag_ids: [],
      review_percentage: 5,
      schedule: {
        articles_per_day: 2,
        preferred_days: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
        ],
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

  // Add tracking if GA info present
  const { gaPropertyId, gaMeasurementId, gtmId } = row.gaInfo;
  if (gaPropertyId || gaMeasurementId || gtmId) {
    config.tracking = {};
    if (gaPropertyId) config.tracking.ga_property_id = gaPropertyId;
    if (gaMeasurementId) config.tracking.ga_measurement_id = gaMeasurementId;
    if (gtmId) config.tracking.gtm_id = gtmId;
  }

  return config;
}

export function buildSkillMd(
  siteName: string,
  topics: string[],
  category: string,
): string {
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

// Keep existing buildSiteYaml for backward compat (remove later)
```

**Step 3: Rewrite `handleCreateSites` in `handler.ts`**

The new handler:

- Accepts same `{ rows, branch }` body
- Responds with SSE (`text/event-stream`)
- Processes sites sequentially, emitting events:
  - `{ type: "site-progress", domain, phase, message }` — phase updates per site
  - `{ type: "site-complete", domain, siteId, status, previewUrl?, warnings? }` — per-site result
  - `{ type: "all-complete", created, failed, results }` — final summary

Phases per site: `resolving-categories` → `creating-bundle` → `fetching-assets` → `building-config` → `creating-branch` → `committing` → `updating-index` → `triggering-sync` → `done`

Key implementation details:

- Use `commitBatch` with `BatchBinaryEntry` for logo/favicon (binary files)
- Create branch via Octokit `git.createRef` (content-pipeline doesn't have the dashboard's `createBranch` helper — use Octokit directly)
- Update dashboard-index on main: read it, add entry, commitBatch to main
- Trigger KV sync: commitBatch a `.build-trigger` file to the staging branch via Contents API (or just push any file — the Git Data API push doesn't trigger Actions, so use Octokit `repos.createOrUpdateFileContents`)
- Logo/favicon: HTTP GET the URL, check content-type is image, convert to base64. 5s timeout per fetch. On failure, skip with warning.
- Author: generate random name from same pool as `services/dashboard/src/lib/author-names.ts` (duplicate the arrays — they're small, and the content-pipeline can't import from dashboard)
- Preview URL: `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site={siteId}`

```typescript
// Pseudocode for the new handleCreateSites:

export async function handleCreateSites(req, res): Promise<void> {
  // Parse body
  // Validate rows

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const octokit = new Octokit({ auth: githubToken });
  const results = [];

  for (const row of body.rows) {
    const site = parseCsvRow(row);
    const siteId = domainToSiteId(site.name);
    const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // 1. Resolve categories
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "resolving-categories",
      });
      const resolved = await resolveCategories(
        site.websiteCategory,
        site.subCategories,
        site.name,
      );

      // 2. Fetch logo/favicon
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "fetching-assets",
      });
      const { logoBase64, faviconBase64, warnings } = await fetchAssets(
        site.logoUrl,
        site.faviconUrl,
      );

      // 3. Build config
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "building-config",
      });
      const author = generateAuthorName();
      const config = buildFullSiteConfig(
        site,
        resolved,
        author,
        !!logoBase64,
        !!faviconBase64,
      );
      const skillMd = buildSkillMd(
        site.name,
        config.brief.topics,
        site.websiteCategory,
      );

      // 4. Create staging branch
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "creating-branch",
      });
      const stagingBranch = `staging/${siteId}`;
      // Create branch from main via Octokit git.createRef (catch 422 = already exists)

      // 5. Commit files
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "committing",
      });
      const files = [
        { path: `sites/${siteId}/site.yaml`, content: stringify(config) },
        { path: `sites/${siteId}/skill.md`, content: skillMd },
        { path: `sites/${siteId}/assets/.gitkeep`, content: "" },
        { path: `sites/${siteId}/articles/.gitkeep`, content: "" },
      ];
      const binaryFiles = [];
      if (logoBase64)
        binaryFiles.push({
          path: `sites/${siteId}/assets/logo.png`,
          base64: logoBase64,
        });
      if (faviconBase64)
        binaryFiles.push({
          path: `sites/${siteId}/assets/favicon.png`,
          base64: faviconBase64,
        });
      await commitBatch(
        octokit,
        networkRepo,
        files,
        binaryFiles,
        commitMsg,
        stagingBranch,
      );

      // 6. Update dashboard-index on main
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "updating-index",
      });
      // Read dashboard-index.yaml from main, parse, add entry, commitBatch to main

      // 7. Trigger KV sync
      emit({
        type: "site-progress",
        domain: site.name,
        siteId,
        phase: "triggering-sync",
      });
      // Push .build-trigger via Contents API to staging branch

      const previewUrl = `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=${siteId}`;
      emit({
        type: "site-complete",
        domain: site.name,
        siteId,
        status: "created",
        previewUrl,
        warnings,
      });
      results.push({
        domain: site.name,
        siteId,
        status: "created",
        previewUrl,
        warnings,
      });
    } catch (err) {
      emit({
        type: "site-complete",
        domain: site.name,
        siteId,
        status: "error",
        error: err.message,
      });
      results.push({
        domain: site.name,
        siteId,
        status: "error",
        error: err.message,
      });
    }
  }

  res.write(`data: ${JSON.stringify({ type: "all-complete", results })}\n\n`);
  res.end();
}
```

**Important:** The dashboard-index.yaml update must be done carefully to avoid race conditions. Read the file from main, parse YAML, add the new entry, commit back. For batch CSV imports, read once before the loop, accumulate entries, then write once after all sites are processed (or write per-site if sequential is acceptable).

**Step 4: Register new route**

In `services/content-pipeline/src/agents/content-generation/index.ts`, the route `POST /wp-migrate/create-sites` already points to `handleCreateSites`. The rewritten function will now use SSE instead of JSON, so the dashboard proxy route also needs updating (Task 5).

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/handler.ts \
      services/content-pipeline/src/agents/migration/site-scaffolder.ts \
      services/content-pipeline/src/agents/migration/csv-parser.ts \
      services/content-pipeline/src/agents/migration/types.ts
git commit -m "feat(migration): full wizard-equivalent site creation via SSE"
```

---

### Task 4: Update dashboard proxy to stream SSE

**Files:**

- Modify: `services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts`

**Context:** The current proxy route returns JSON. The new backend streams SSE. The proxy must forward the SSE stream to the browser, same pattern as the existing `services/dashboard/src/app/api/agent/wp-migrate/route.ts`.

**Step 1: Rewrite the proxy route**

Reference the existing SSE proxy at `services/dashboard/src/app/api/agent/wp-migrate/route.ts` for the streaming pattern. The key is to use `ReadableStream` to pipe the backend SSE through Next.js:

```typescript
// services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts

import { NextRequest } from "next/server";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json();
  const agentUrl = getAgentUrl();

  const response = await fetch(`${agentUrl}/wp-migrate/create-sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    return new Response(text, { status: response.status });
  }

  // Stream SSE through
  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Step 2: Commit**

```bash
git add services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts
git commit -m "feat(dashboard): stream SSE from create-sites proxy"
```

---

### Task 5: Rewrite `CsvSiteCreator.tsx` for SSE progress + article import

**Files:**

- Modify: `services/dashboard/src/components/import/CsvSiteCreator.tsx`

**Context:** The current component does a simple POST and shows results. The new version must:

1. Parse CSV (keep existing logic)
2. Show preview table (keep)
3. On "Create Sites": POST to create-sites, consume SSE, show per-site progress
4. After all sites created: show results with staging preview links + warnings
5. For each site with a `Posts REST API` URL: show "Import Articles" button
6. Clicking import: run the WP migration inline (POST to `/api/agent/wp-migrate`, consume SSE, show progress)

**Key UI states:**

```
IDLE → CREATING (SSE progress per site) → RESULTS (per-site cards with Import buttons) → IMPORTING (SSE for article import)
```

**Per-site result card structure:**

```
┌─────────────────────────────────────────────────────┐
│ ✅ travelbeautytips.com (travelbeautytips)          │
│ Category: Style & Fashion  •  Bundle: created       │
│ ⚠️ Could not fetch favicon                         │
│ Preview: https://.../?_atl_site=travelbeautytips    │
│                                                      │
│ [Import Articles from https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=2] │
│                                                      │
│ (after clicking import: SSE progress shown here)     │
└─────────────────────────────────────────────────────┘
```

**Implementation:** Keep the component self-contained. The article import per-site can reuse the SSE consumption pattern from `ImportPanel.tsx` — extract the SSE-reading logic into a shared helper or just duplicate the ~30 lines of SSE parsing inline (it's not complex enough to warrant a shared module).

**Step 1: Implement the component**

Major changes:

- Replace `handleCreate` with SSE-consuming version
- Add `SiteResult` interface with `previewUrl`, `warnings`, `postsApiUrl`
- Add per-site "Import Articles" button + inline SSE progress
- Remove the `target` selector (always staging for this flow)

**Step 2: Commit**

```bash
git add services/dashboard/src/components/import/CsvSiteCreator.tsx
git commit -m "feat(dashboard): CSV site creator with SSE progress + article import"
```

---

### Task 6: End-to-end test with the real CSV

**Files:** None (manual testing)

**Steps:**

1. Start both services: `cloudgrid dev` (or manual: dashboard on 3000, content-pipeline on 5000)
2. Navigate to `/import`
3. Upload the CSV: `/Users/michal/Downloads/site-import-template new - site-import-template.csv`
4. Verify preview table shows `travelbeautytips.com` with category, menu items
5. Click "Create Sites"
6. Verify SSE progress events stream in real-time (category resolution, bundle, branch, commit, index, sync)
7. Verify result shows staging preview link
8. Verify result shows warning if logo/favicon couldn't be fetched
9. Click "Import Articles" button
10. Verify article import starts (SSE progress from WP migration)
11. Check network repo: `staging/travelbeautytips` branch should have `site.yaml`, `skill.md`, `articles/.gitkeep`, `assets/`
12. Check dashboard-index.yaml on main: new entry for `travelbeautytips`
13. After KV sync: staging preview URL should load the site

---

## Summary of files touched

| File                                                           | Action | Purpose                                                  |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `content-pipeline/src/agents/migration/category-resolver.ts`   | Create | Category matching + bundle creation via aggregator API   |
| `content-pipeline/src/agents/migration/theme-builder.ts`       | Create | 5→19 color expansion                                     |
| `content-pipeline/src/agents/migration/handler.ts`             | Modify | Rewrite `handleCreateSites` as SSE with full wizard flow |
| `content-pipeline/src/agents/migration/site-scaffolder.ts`     | Modify | Add `buildFullSiteConfig`, `buildSkillMd`                |
| `content-pipeline/src/agents/migration/csv-parser.ts`          | Modify | Add `domain` field                                       |
| `content-pipeline/src/agents/migration/types.ts`               | Modify | Add `domain` to `CsvSiteRow`                             |
| `dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts` | Modify | SSE streaming proxy                                      |
| `dashboard/src/components/import/CsvSiteCreator.tsx`           | Modify | SSE progress + article import UI                         |
| Tests: `category-resolver.test.ts`, `theme-builder.test.ts`    | Create | Unit tests                                               |
