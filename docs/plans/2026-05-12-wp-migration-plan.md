# WordPress Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate 50 WordPress sites to the ATL content network — CSV-driven site scaffolding, article ingestion (turndown + Claude + Gemini), and DNS cutover.

**Architecture:** Three-phase pipeline in `content-pipeline/src/agents/migration/`. Phase 1 parses CSV and creates site folders in the network repo. Phase 2 fetches WP REST API articles, converts HTML→MD via turndown, cleans up with Claude, generates images with Gemini, uploads to R2, and commits `.md` files. Phase 3 is manual QA + DNS cutover. A new `/import` dashboard page provides the UI.

**Tech Stack:** turndown (HTML→MD), @anthropic-ai/sdk (Claude cleanup), Gemini REST API (image gen), @aws-sdk/client-s3 (R2 upload), Octokit (git commits), Next.js 15 (dashboard UI), Vitest (tests).

**Design doc:** `docs/plans/2026-05-12-wp-migration-design.md`

---

## Task 1: Install dependencies and create migration module scaffold

**Files:**
- Modify: `services/content-pipeline/package.json`
- Create: `services/content-pipeline/src/agents/migration/index.ts`
- Create: `services/content-pipeline/src/agents/migration/types.ts`

**Step 1: Install turndown**

```bash
cd services/content-pipeline && pnpm add turndown && pnpm add -D @types/turndown
```

**Step 2: Create types file**

Create `services/content-pipeline/src/agents/migration/types.ts`:

```typescript
export interface CsvSiteRow {
  name: string;                    // domain, e.g. "travelbeautytips.com"
  websiteCategory: string;         // e.g. "Style & Fashion"
  menuItems: string[];             // parsed from comma-separated
  iabCategories: string[];         // parsed from comma-separated
  subCategories: string[];         // parsed from comma-separated
  colorPalette: Record<string, string>; // parsed: { primary, secondary, accent, text, background }
  logoUrl: string;                 // WP URL to download
  faviconUrl: string;              // WP URL to download
  postsApiUrl: string;             // e.g. "https://domain/wp-json/wp/v2/posts?per_page=75"
  gaInfo: GaInfo;                  // parsed from comma-separated
}

export interface GaInfo {
  gaPropertyId?: string;           // numeric, e.g. "328395426"
  gaMeasurementId?: string;        // e.g. "G-HL2D8CQ0Z9"
  gtmId?: string;                  // e.g. "GT-5R65N74B"
}

export interface WpArticle {
  id: number;
  slug: string;
  date: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  author: number;
  featured_media: number;
  categories: number[];
  tags: number[];
  yoast_head_json?: {
    title?: string;
    og_title?: string;
    og_description?: string;
    canonical?: string;
    twitter_card?: string;
    author?: string;
    article_published_time?: string;
    og_image?: Array<{ url?: string }>;
    twitter_misc?: Record<string, string>;
  };
}

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

export interface CategoryMapping {
  wpCategoryId: number;
  wpCategoryName: string;
  atlMenuItemName: string;
}

export interface MigrationProgress {
  site: string;
  phase: "fetching" | "converting" | "generating-images" | "uploading-r2" | "committing" | "syncing" | "complete" | "error";
  totalArticles: number;
  processedArticles: number;
  currentArticleSlug?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface MigrationArticleResult {
  slug: string;
  title: string;
  status: "success" | "error";
  error?: string;
  imageGenerated: boolean;
}

export interface MigrationReport {
  site: string;
  totalArticles: number;
  successful: number;
  failed: number;
  results: MigrationArticleResult[];
  durationMs: number;
}
```

**Step 3: Create index.ts scaffold**

Create `services/content-pipeline/src/agents/migration/index.ts`:

```typescript
export { parseCsvRow, parseColorPalette, parseGaInfo } from "./csv-parser.js";
export { fetchWpArticles, fetchWpCategories } from "./wp-fetcher.js";
export { wpHtmlToMarkdown } from "./html-to-md.js";
export { cleanupArticle } from "./article-cleanup.js";
export { buildSiteYaml } from "./site-scaffolder.js";
export { runMigration } from "./orchestrator.js";
export type * from "./types.js";
```

**Step 4: Commit**

```bash
git add services/content-pipeline/package.json services/content-pipeline/pnpm-lock.yaml services/content-pipeline/src/agents/migration/
git commit -m "feat(migration): scaffold migration module with types and turndown dependency"
```

---

## Task 2: CSV parser — parse spreadsheet rows into typed site data

**Files:**
- Create: `services/content-pipeline/src/agents/migration/csv-parser.ts`
- Create: `services/content-pipeline/src/__tests__/migration/csv-parser.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/csv-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCsvRow, parseColorPalette, parseGaInfo } from "../../agents/migration/csv-parser.js";

describe("parseColorPalette", () => {
  it("parses color string into object", () => {
    const input = "primary: #F43656, secondary: #C87137, accent: #B80000, text: #000000, background: #FFFFFF";
    const result = parseColorPalette(input);
    expect(result).toEqual({
      primary: "#F43656",
      secondary: "#C87137",
      accent: "#B80000",
      text: "#000000",
      background: "#FFFFFF",
    });
  });

  it("handles extra whitespace", () => {
    const result = parseColorPalette("primary:  #ABC123 ,  secondary:#DEF456 ");
    expect(result.primary).toBe("#ABC123");
    expect(result.secondary).toBe("#DEF456");
  });
});

describe("parseGaInfo", () => {
  it("parses all three GA fields", () => {
    const result = parseGaInfo("328395426, G-HL2D8CQ0Z9, GT-5R65N74B");
    expect(result).toEqual({
      gaPropertyId: "328395426",
      gaMeasurementId: "G-HL2D8CQ0Z9",
      gtmId: "GT-5R65N74B",
    });
  });

  it("handles missing GTM", () => {
    const result = parseGaInfo("328395426, G-HL2D8CQ0Z9");
    expect(result.gaPropertyId).toBe("328395426");
    expect(result.gaMeasurementId).toBe("G-HL2D8CQ0Z9");
    expect(result.gtmId).toBeUndefined();
  });

  it("handles empty string", () => {
    const result = parseGaInfo("");
    expect(result.gaPropertyId).toBeUndefined();
  });
});

describe("parseCsvRow", () => {
  it("parses a full row into CsvSiteRow", () => {
    const row = {
      Name: "travelbeautytips.com",
      "Website Category": "Style & Fashion",
      "Menu Items": "Beauty, Fashion, Hair, Makeup Hacks",
      "IAB Top Categories (Vertical)": "Style & Fashion, Healthy Living",
      "Sub Categories": "Hair Care, Makeup and Accessories",
      "Color Palette": "primary: #F43656, secondary: #C87137, accent: #B80000, text: #000000, background: #FFFFFF",
      Logo: "https://travelbeautytips.com/wp-content/uploads/2017/08/logo.png",
      Favicon: "https://travelbeautytips.com/wp-content/uploads/2017/08/favicon.png",
      "Posts REST API (articles)": "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=75",
      "GA Info": "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
    };
    const result = parseCsvRow(row);
    expect(result.name).toBe("travelbeautytips.com");
    expect(result.menuItems).toEqual(["Beauty", "Fashion", "Hair", "Makeup Hacks"]);
    expect(result.colorPalette.primary).toBe("#F43656");
    expect(result.gaInfo.gtmId).toBe("GT-5R65N74B");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/csv-parser.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement csv-parser.ts**

Create `services/content-pipeline/src/agents/migration/csv-parser.ts`:

```typescript
import type { CsvSiteRow, GaInfo } from "./types.js";

export function parseColorPalette(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split(":").map((s) => s.trim());
    if (key && value) result[key] = value;
  }
  return result;
}

export function parseGaInfo(raw: string): GaInfo {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const info: GaInfo = {};
  for (const part of parts) {
    if (part.startsWith("G-")) info.gaMeasurementId = part;
    else if (part.startsWith("GT-")) info.gtmId = part;
    else if (/^\d+$/.test(part)) info.gaPropertyId = part;
  }
  return info;
}

function splitCommaTrimmed(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseCsvRow(row: Record<string, string>): CsvSiteRow {
  return {
    name: row["Name"]?.trim() ?? "",
    websiteCategory: row["Website Category"]?.trim() ?? "",
    menuItems: splitCommaTrimmed(row["Menu Items"] ?? ""),
    iabCategories: splitCommaTrimmed(row["IAB Top Categories (Vertical)"] ?? ""),
    subCategories: splitCommaTrimmed(row["Sub Categories"] ?? ""),
    colorPalette: parseColorPalette(row["Color Palette"] ?? ""),
    logoUrl: row["Logo"]?.trim() ?? "",
    faviconUrl: row["Favicon"]?.trim() ?? "",
    postsApiUrl: row["Posts REST API (articles)"]?.trim() ?? "",
    gaInfo: parseGaInfo(row["GA Info"] ?? ""),
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/csv-parser.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/csv-parser.ts services/content-pipeline/src/__tests__/migration/
git commit -m "feat(migration): CSV parser with color palette and GA info parsing"
```

---

## Task 3: Site scaffolder — generate site.yaml from CSV data

**Files:**
- Create: `services/content-pipeline/src/agents/migration/site-scaffolder.ts`
- Create: `services/content-pipeline/src/__tests__/migration/site-scaffolder.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/site-scaffolder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSiteYaml, domainToSiteId } from "../../agents/migration/site-scaffolder.js";
import type { CsvSiteRow } from "../../agents/migration/types.js";
import yaml from "yaml";

const SAMPLE_ROW: CsvSiteRow = {
  name: "travelbeautytips.com",
  websiteCategory: "Style & Fashion",
  menuItems: ["Beauty", "Fashion", "Hair", "Makeup Hacks"],
  iabCategories: ["Style & Fashion", "Healthy Living"],
  subCategories: ["Hair Care", "Makeup and Accessories"],
  colorPalette: { primary: "#F43656", secondary: "#C87137", accent: "#B80000", text: "#000000", background: "#FFFFFF" },
  logoUrl: "https://travelbeautytips.com/wp-content/uploads/2017/08/logo.png",
  faviconUrl: "https://travelbeautytips.com/wp-content/uploads/2017/08/favicon.png",
  postsApiUrl: "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=75",
  gaInfo: { gaPropertyId: "328395426", gaMeasurementId: "G-HL2D8CQ0Z9", gtmId: "GT-5R65N74B" },
};

describe("domainToSiteId", () => {
  it("strips .com and special chars", () => {
    expect(domainToSiteId("travelbeautytips.com")).toBe("travelbeautytips");
  });

  it("handles subdomains", () => {
    expect(domainToSiteId("www.example.co.uk")).toBe("wwwexamplecouk");
  });
});

describe("buildSiteYaml", () => {
  it("produces valid YAML string", () => {
    const yamlStr = buildSiteYaml(SAMPLE_ROW);
    const parsed = yaml.parse(yamlStr);
    expect(parsed.domain).toBe("travelbeautytips");
    expect(parsed.active).toBe(true);
  });

  it("maps menu items to layout.categories", () => {
    const parsed = yaml.parse(buildSiteYaml(SAMPLE_ROW));
    expect(parsed.layout.categories).toEqual(["Beauty", "Fashion", "Hair", "Makeup Hacks"]);
  });

  it("maps colors from CSV", () => {
    const parsed = yaml.parse(buildSiteYaml(SAMPLE_ROW));
    expect(parsed.theme.colors.primary).toBe("#F43656");
  });

  it("includes tracking from GA info", () => {
    const parsed = yaml.parse(buildSiteYaml(SAMPLE_ROW));
    expect(parsed.tracking.ga_measurement_id).toBe("G-HL2D8CQ0Z9");
    expect(parsed.tracking.gtm_id).toBe("GT-5R65N74B");
  });

  it("sets brief.topics from menu items", () => {
    const parsed = yaml.parse(buildSiteYaml(SAMPLE_ROW));
    expect(parsed.brief.topics).toEqual(SAMPLE_ROW.menuItems);
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/site-scaffolder.test.ts
```

**Step 3: Implement site-scaffolder.ts**

Create `services/content-pipeline/src/agents/migration/site-scaffolder.ts`:

```typescript
import yaml from "yaml";
import type { CsvSiteRow } from "./types.js";

export function domainToSiteId(domain: string): string {
  return domain.replace(/\.(com|net|org|io|co\.uk|dev|info|tv)$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function buildSiteYaml(row: CsvSiteRow): string {
  const siteId = domainToSiteId(row.name);

  const config = {
    domain: siteId,
    active: true,
    groups: [],
    brief: {
      siteName: row.name,
      vertical: row.websiteCategory,
      language: "EN",
      topics: row.menuItems,
      iab_categories: row.iabCategories,
      sub_categories: row.subCategories,
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
      colors: row.colorPalette,
    },
    site_name: row.name,
    layout: {
      hero: { enabled: true, count: 4 },
      must_reads: { enabled: true, count: 5 },
      categories: row.menuItems,
    },
    tracking: {
      ...(row.gaInfo.gaMeasurementId && { ga_measurement_id: row.gaInfo.gaMeasurementId }),
      ...(row.gaInfo.gtmId && { gtm_id: row.gaInfo.gtmId }),
      ...(row.gaInfo.gaPropertyId && { ga_property_id: row.gaInfo.gaPropertyId }),
    },
  };

  return yaml.stringify(config, { lineWidth: 120 });
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/site-scaffolder.ts services/content-pipeline/src/__tests__/migration/site-scaffolder.test.ts
git commit -m "feat(migration): site scaffolder — generate site.yaml from CSV row"
```

---

## Task 4: WP fetcher — fetch articles and categories from WordPress REST API

**Files:**
- Create: `services/content-pipeline/src/agents/migration/wp-fetcher.ts`
- Create: `services/content-pipeline/src/__tests__/migration/wp-fetcher.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/wp-fetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWpArticles, fetchWpCategories, extractBaseUrl } from "../../agents/migration/wp-fetcher.js";

describe("extractBaseUrl", () => {
  it("extracts base from posts API URL", () => {
    expect(extractBaseUrl("https://tvshowbox.com/wp-json/wp/v2/posts?per_page=75"))
      .toBe("https://tvshowbox.com");
  });
});

describe("fetchWpArticles", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("fetches single page of articles", async () => {
    const mockArticles = [
      { id: 1, slug: "test-article", title: { rendered: "Test" }, content: { rendered: "<p>Body</p>" } },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockArticles), {
        headers: { "X-WP-TotalPages": "1", "X-WP-Total": "1" },
      }),
    );

    const result = await fetchWpArticles("https://example.com/wp-json/wp/v2/posts?per_page=100");
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("test-article");
  });

  it("paginates when X-WP-TotalPages > 1", async () => {
    const page1 = [{ id: 1, slug: "a", title: { rendered: "A" }, content: { rendered: "" } }];
    const page2 = [{ id: 2, slug: "b", title: { rendered: "B" }, content: { rendered: "" } }];

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), {
        headers: { "X-WP-TotalPages": "2", "X-WP-Total": "2" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), {
        headers: { "X-WP-TotalPages": "2", "X-WP-Total": "2" },
      }));

    const result = await fetchWpArticles("https://example.com/wp-json/wp/v2/posts?per_page=100");
    expect(result).toHaveLength(2);
    expect(result[1].slug).toBe("b");
  });
});

describe("fetchWpCategories", () => {
  it("fetches categories by IDs", async () => {
    const cats = [{ id: 5, name: "News", slug: "news", parent: 0 }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(cats)),
    );

    const result = await fetchWpCategories("https://example.com", [5]);
    expect(result.get(5)?.name).toBe("News");
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement wp-fetcher.ts**

Create `services/content-pipeline/src/agents/migration/wp-fetcher.ts`:

```typescript
import type { WpArticle, WpCategory } from "./types.js";

export function extractBaseUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  return `${url.protocol}//${url.host}`;
}

export async function fetchWpArticles(postsApiUrl: string): Promise<WpArticle[]> {
  const url = new URL(postsApiUrl);
  url.searchParams.set("per_page", "100");
  url.searchParams.delete("page");

  const articles: WpArticle[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    url.searchParams.set("page", String(page));
    console.log(`[wp-fetch] GET ${url.toString()} (page ${page}/${totalPages})`);

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AtomicBot/1.0)" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`WP API error: ${response.status} ${response.statusText}`);
    }

    totalPages = parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10);
    const batch: WpArticle[] = await response.json();
    articles.push(...batch);
    page++;
  } while (page <= totalPages);

  console.log(`[wp-fetch] Fetched ${articles.length} articles total`);
  return articles;
}

export async function fetchWpCategories(
  baseUrl: string,
  categoryIds: number[],
): Promise<Map<number, WpCategory>> {
  const unique = [...new Set(categoryIds)];
  if (unique.length === 0) return new Map();

  const map = new Map<number, WpCategory>();
  const batchSize = 100;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const url = `${baseUrl}/wp-json/wp/v2/categories?include=${batch.join(",")}&per_page=100`;

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AtomicBot/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[wp-fetch] Categories fetch failed: ${response.status}`);
      continue;
    }

    const cats: WpCategory[] = await response.json();
    for (const cat of cats) map.set(cat.id, cat);
  }

  return map;
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/wp-fetcher.ts services/content-pipeline/src/__tests__/migration/wp-fetcher.test.ts
git commit -m "feat(migration): WP REST API fetcher with pagination and category lookup"
```

---

## Task 5: HTML→MD converter — turndown with WP-specific cleanup

**Files:**
- Create: `services/content-pipeline/src/agents/migration/html-to-md.ts`
- Create: `services/content-pipeline/src/__tests__/migration/html-to-md.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/html-to-md.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { wpHtmlToMarkdown } from "../../agents/migration/html-to-md.js";

describe("wpHtmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const html = "<h2>Title</h2><p>Paragraph text.</p>";
    const md = wpHtmlToMarkdown(html);
    expect(md).toContain("## Title");
    expect(md).toContain("Paragraph text.");
  });

  it("converts lists", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const md = wpHtmlToMarkdown(html);
    expect(md).toContain("- Item 1");
    expect(md).toContain("- Item 2");
  });

  it("strips WP shortcodes", () => {
    const html = '<p>[gallery ids="1,2,3"]</p><p>Real content.</p>';
    const md = wpHtmlToMarkdown(html);
    expect(md).not.toContain("[gallery");
    expect(md).toContain("Real content.");
  });

  it("strips Elementor wrapper divs", () => {
    const html = '<div class="elementor-widget-container"><p>Content inside.</p></div>';
    const md = wpHtmlToMarkdown(html);
    expect(md).toContain("Content inside.");
    expect(md).not.toContain("elementor");
  });

  it("removes inline images (they will be regenerated)", () => {
    const html = '<p>Text before.</p><img src="https://example.com/image.jpg" /><p>Text after.</p>';
    const md = wpHtmlToMarkdown(html);
    expect(md).not.toContain("image.jpg");
    expect(md).toContain("Text before.");
    expect(md).toContain("Text after.");
  });

  it("preserves links", () => {
    const html = '<p>Visit <a href="https://example.com">this site</a>.</p>';
    const md = wpHtmlToMarkdown(html);
    expect(md).toContain("[this site](https://example.com)");
  });

  it("handles empty content gracefully", () => {
    expect(wpHtmlToMarkdown("")).toBe("");
    expect(wpHtmlToMarkdown("<div></div>")).toBe("");
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement html-to-md.ts**

Create `services/content-pipeline/src/agents/migration/html-to-md.ts`:

```typescript
import TurndownService from "turndown";

const SHORTCODE_REGEX = /\[[\w_-]+(?:\s[^\]]*)?](?:[\s\S]*?\[\/[\w_-]+])?/g;

function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  // Remove all images — hero images are regenerated by Gemini
  td.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });

  // Remove iframes (YouTube embeds, etc.)
  td.addRule("removeIframes", {
    filter: "iframe",
    replacement: () => "",
  });

  // Remove figure/figcaption wrappers (keep inner text)
  td.addRule("stripFigcaption", {
    filter: "figcaption",
    replacement: () => "",
  });

  return td;
}

export function wpHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";

  // Pre-processing: strip WP shortcodes
  let cleaned = html.replace(SHORTCODE_REGEX, "");

  // Strip Elementor wrapper divs (keep inner content)
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor[^"]*"[^>]*>/gi, "");
  cleaned = cleaned.replace(/<\/div>/gi, "");

  // Strip wp-block wrappers
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*wp-block[^"]*"[^>]*>/gi, "");

  const td = createTurndownService();
  let md = td.turndown(cleaned);

  // Post-processing: collapse excessive newlines
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/html-to-md.ts services/content-pipeline/src/__tests__/migration/html-to-md.test.ts
git commit -m "feat(migration): HTML to Markdown converter with WP shortcode and Elementor cleanup"
```

---

## Task 6: Claude article cleanup agent — fix descriptions, map categories

**Files:**
- Create: `services/content-pipeline/src/agents/migration/article-cleanup.ts`
- Create: `services/content-pipeline/src/__tests__/migration/article-cleanup.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/article-cleanup.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCleanupPrompt, parseCleanupResponse, mapCategoriesToTags } from "../../agents/migration/article-cleanup.js";

describe("mapCategoriesToTags", () => {
  it("maps WP category IDs to menu item names", () => {
    const wpCategories = new Map([
      [5, { id: 5, name: "News", slug: "news", parent: 0 }],
      [12, { id: 12, name: "Reviews", slug: "reviews", parent: 0 }],
    ]);
    const menuItems = ["News", "Reviews", "Streaming"];
    const articleCatIds = [5, 12];

    const tags = mapCategoriesToTags(articleCatIds, wpCategories, menuItems);
    expect(tags).toEqual(["News", "Reviews"]);
  });

  it("does case-insensitive matching", () => {
    const wpCategories = new Map([
      [5, { id: 5, name: "news", slug: "news", parent: 0 }],
    ]);
    const tags = mapCategoriesToTags([5], wpCategories, ["News"]);
    expect(tags).toEqual(["News"]);
  });

  it("falls back to WP category name if no menu match", () => {
    const wpCategories = new Map([
      [99, { id: 99, name: "Uncategorized", slug: "uncategorized", parent: 0 }],
    ]);
    const tags = mapCategoriesToTags([99], wpCategories, ["News"]);
    expect(tags).toEqual(["Uncategorized"]);
  });
});

describe("buildCleanupPrompt", () => {
  it("includes article title and markdown body", () => {
    const prompt = buildCleanupPrompt("Test Title", "## Body\n\nSome content", "Short excerpt");
    expect(prompt).toContain("Test Title");
    expect(prompt).toContain("## Body");
  });
});

describe("parseCleanupResponse", () => {
  it("extracts cleaned markdown and description", () => {
    const response = `<description>A clean SEO description here.</description>
<markdown>
## Clean Heading

Clean body text.
</markdown>`;
    const result = parseCleanupResponse(response);
    expect(result.description).toBe("A clean SEO description here.");
    expect(result.markdown).toContain("## Clean Heading");
  });

  it("returns originals if parsing fails", () => {
    const result = parseCleanupResponse("malformed response");
    expect(result.description).toBe("");
    expect(result.markdown).toBe("malformed response");
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement article-cleanup.ts**

Create `services/content-pipeline/src/agents/migration/article-cleanup.ts`:

```typescript
import type { WpCategory } from "./types.js";

export function mapCategoriesToTags(
  articleCategoryIds: number[],
  wpCategories: Map<number, WpCategory>,
  menuItems: string[],
): string[] {
  const menuLower = menuItems.map((m) => m.toLowerCase());

  return articleCategoryIds.map((id) => {
    const cat = wpCategories.get(id);
    if (!cat) return null;

    const matchIdx = menuLower.indexOf(cat.name.toLowerCase());
    return matchIdx >= 0 ? menuItems[matchIdx] : cat.name;
  }).filter((t): t is string => t !== null);
}

export function buildCleanupPrompt(
  title: string,
  markdownBody: string,
  excerpt: string,
): string {
  return `You are cleaning up a WordPress article that was converted from HTML to Markdown.

Article title: "${title}"
WP excerpt: "${excerpt}"

Tasks:
1. Clean up any remaining HTML artifacts, broken shortcodes, or formatting issues in the markdown.
2. Remove any "Read more", "Related posts", "Share this" sections at the end.
3. If the excerpt below is empty or under 50 characters, write a 1-2 sentence SEO meta description. Otherwise, clean up the excerpt and use it as the description.
4. Do NOT change the actual content, meaning, or structure. Only clean formatting.

Return your response in this exact format:
<description>The SEO meta description here</description>
<markdown>
The cleaned markdown body here
</markdown>

Here is the markdown body to clean:

${markdownBody}`;
}

export function parseCleanupResponse(response: string): {
  description: string;
  markdown: string;
} {
  const descMatch = response.match(/<description>([\s\S]*?)<\/description>/);
  const mdMatch = response.match(/<markdown>\n?([\s\S]*?)\n?<\/markdown>/);

  return {
    description: descMatch?.[1]?.trim() ?? "",
    markdown: mdMatch?.[1]?.trim() ?? response.trim(),
  };
}

export async function cleanupArticle(
  anthropicApiKey: string,
  title: string,
  markdownBody: string,
  excerpt: string,
): Promise<{ description: string; markdown: string }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: anthropicApiKey });

  const prompt = buildCleanupPrompt(title, markdownBody, excerpt);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseCleanupResponse(text);
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/article-cleanup.ts services/content-pipeline/src/__tests__/migration/article-cleanup.test.ts
git commit -m "feat(migration): Claude article cleanup agent with category mapping"
```

---

## Task 7: R2 upload utility for content-pipeline

**Files:**
- Create: `services/content-pipeline/src/lib/r2-upload.ts`
- Create: `services/content-pipeline/src/__tests__/migration/r2-upload.test.ts`

**Step 1: Install @aws-sdk/client-s3 in content-pipeline**

```bash
cd services/content-pipeline && pnpm add @aws-sdk/client-s3
```

**Step 2: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/r2-upload.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildR2Key } from "../../lib/r2-upload.js";

describe("buildR2Key", () => {
  it("builds correct key for article image", () => {
    expect(buildR2Key("tvshowbox", "my-article-slug", "webp"))
      .toBe("tvshowbox/assets/images/my-article-slug.webp");
  });
});
```

**Step 3: Implement r2-upload.ts**

Create `services/content-pipeline/src/lib/r2-upload.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

function getClient(accountId: string, accessKeyId: string, secretAccessKey: string): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export function buildR2Key(siteId: string, slug: string, extension: string): string {
  return `${siteId}/assets/images/${slug}.${extension}`;
}

export async function uploadImageToR2(
  config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string },
  siteId: string,
  slug: string,
  imageBuffer: Buffer,
  contentType: string = "image/webp",
): Promise<string> {
  const client = getClient(config.accountId, config.accessKeyId, config.secretAccessKey);
  const key = buildR2Key(siteId, slug, "webp");

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: imageBuffer,
    ContentType: contentType,
  }));

  console.log(`[r2] Uploaded ${key} (${imageBuffer.length} bytes)`);
  return `/assets/images/${slug}.webp`;
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/package.json services/content-pipeline/pnpm-lock.yaml services/content-pipeline/src/lib/r2-upload.ts services/content-pipeline/src/__tests__/migration/r2-upload.test.ts
git commit -m "feat(migration): R2 upload utility for article images via S3 API"
```

---

## Task 8: Frontmatter builder — assemble article .md file from all sources

**Files:**
- Create: `services/content-pipeline/src/agents/migration/frontmatter-builder.ts`
- Create: `services/content-pipeline/src/__tests__/migration/frontmatter-builder.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/frontmatter-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildArticleMd, stripHtmlTags, estimateReadingTime } from "../../agents/migration/frontmatter-builder.js";
import matter from "gray-matter";

describe("stripHtmlTags", () => {
  it("removes HTML from excerpt", () => {
    expect(stripHtmlTags("<p>Hello <strong>world</strong>.</p>")).toBe("Hello world.");
  });
});

describe("estimateReadingTime", () => {
  it("calculates reading time from word count", () => {
    const words = Array(500).fill("word").join(" ");
    expect(estimateReadingTime(words)).toBe(3); // ~200 wpm
  });
});

describe("buildArticleMd", () => {
  it("produces valid frontmatter + body", () => {
    const md = buildArticleMd({
      title: "Test Article",
      description: "A test description.",
      slug: "test-article",
      publishDate: "2026-05-11",
      author: "John Doe",
      tags: ["News"],
      markdownBody: "## Heading\n\nBody text here.",
      featuredImage: "/assets/images/test-article.webp",
      wpOriginalId: 123,
      sourceUrl: "https://example.com/test-article/",
      seo: {
        canonical: "https://example.com/test-article/",
        og_title: "Test Article - Example",
        og_description: "A test description.",
        twitter_card: "summary_large_image",
      },
    });

    const parsed = matter(md);
    expect(parsed.data.title).toBe("Test Article");
    expect(parsed.data.slug).toBe("test-article");
    expect(parsed.data.imported_from).toBe("wordpress");
    expect(parsed.data.wp_original_id).toBe(123);
    expect(parsed.data.seo.canonical).toBe("https://example.com/test-article/");
    expect(parsed.content.trim()).toContain("## Heading");
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Implement frontmatter-builder.ts**

Create `services/content-pipeline/src/agents/migration/frontmatter-builder.ts`:

```typescript
import yaml from "yaml";

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

interface ArticleMdInput {
  title: string;
  description: string;
  slug: string;
  publishDate: string;
  author: string;
  tags: string[];
  markdownBody: string;
  featuredImage?: string;
  wpOriginalId: number;
  sourceUrl: string;
  seo: {
    canonical?: string;
    og_title?: string;
    og_description?: string;
    og_image?: string;
    twitter_card?: string;
  };
}

export function buildArticleMd(input: ArticleMdInput): string {
  const frontmatter: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    type: "standard",
    status: "published",
    publishDate: input.publishDate,
    author: input.author,
    tags: input.tags,
    slug: input.slug,
    featuredImage: input.featuredImage ?? null,
    reading_time: estimateReadingTime(input.markdownBody),
    source_url: input.sourceUrl,
    imported_from: "wordpress",
    wp_original_id: input.wpOriginalId,
    seo: {
      ...(input.seo.canonical && { canonical: input.seo.canonical }),
      ...(input.seo.og_title && { og_title: input.seo.og_title }),
      ...(input.seo.og_description && { og_description: input.seo.og_description }),
      ...(input.seo.og_image && { og_image: input.seo.og_image }),
      ...(input.seo.twitter_card && { twitter_card: input.seo.twitter_card }),
    },
  };

  const yamlStr = yaml.stringify(frontmatter, { lineWidth: 120 });
  return `---\n${yamlStr}---\n\n${input.markdownBody}\n`;
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/frontmatter-builder.ts services/content-pipeline/src/__tests__/migration/frontmatter-builder.test.ts
git commit -m "feat(migration): frontmatter builder — assemble article .md from WP data + cleanup output"
```

---

## Task 9: Migration orchestrator — end-to-end per-site pipeline

**Files:**
- Create: `services/content-pipeline/src/agents/migration/orchestrator.ts`

This is the main function that wires all components together. No unit test needed — covered by integration tests (Task 11).

**Step 1: Implement orchestrator.ts**

Create `services/content-pipeline/src/agents/migration/orchestrator.ts`:

```typescript
import type { CsvSiteRow, WpArticle, MigrationProgress, MigrationReport, MigrationArticleResult, CategoryMapping } from "./types.js";
import { fetchWpArticles, fetchWpCategories, extractBaseUrl } from "./wp-fetcher.js";
import { wpHtmlToMarkdown } from "./html-to-md.js";
import { cleanupArticle, mapCategoriesToTags } from "./article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "./frontmatter-builder.js";
import { domainToSiteId } from "./site-scaffolder.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { optimizeImage } from "../../lib/image-optimizer.js";
import { uploadImageToR2, buildR2Key } from "../../lib/r2-upload.js";
import { commitBatch } from "../../lib/github.js";
import type { Octokit } from "@octokit/rest";

export interface MigrationConfig {
  anthropicApiKey: string;
  geminiApiKey: string;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  octokit: Octokit;
  networkRepo: string;
  branch: string;
}

export async function runMigration(
  site: CsvSiteRow,
  config: MigrationConfig,
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationReport> {
  const startTime = Date.now();
  const siteId = domainToSiteId(site.name);
  const results: MigrationArticleResult[] = [];

  const progress: MigrationProgress = {
    site: site.name,
    phase: "fetching",
    totalArticles: 0,
    processedArticles: 0,
    startedAt: startTime,
  };
  onProgress?.(progress);

  // 1. Fetch all WP articles
  const articles = await fetchWpArticles(site.postsApiUrl);
  progress.totalArticles = articles.length;
  onProgress?.(progress);

  // 2. Fetch WP categories for mapping
  const allCatIds = [...new Set(articles.flatMap((a) => a.categories))];
  const baseUrl = extractBaseUrl(site.postsApiUrl);
  const wpCategories = await fetchWpCategories(baseUrl, allCatIds);

  // 3. Process each article
  progress.phase = "converting";
  onProgress?.(progress);

  const mdFiles: Array<{ path: string; content: string }> = [];

  for (const article of articles) {
    progress.currentArticleSlug = article.slug;
    onProgress?.(progress);

    try {
      // 3a. HTML → Markdown (deterministic, free)
      const rawMd = wpHtmlToMarkdown(article.content.rendered);

      // 3b. Claude cleanup (description + formatting)
      const excerpt = stripHtmlTags(article.excerpt?.rendered ?? "");
      const { description, markdown: cleanedMd } = await cleanupArticle(
        config.anthropicApiKey,
        article.title.rendered,
        rawMd,
        excerpt,
      );

      // 3c. Map WP categories → site menu tags
      const tags = mapCategoriesToTags(article.categories, wpCategories, site.menuItems);

      // 3d. Generate hero image with Gemini
      let featuredImage: string | undefined;
      let imageGenerated = false;

      progress.phase = "generating-images";
      onProgress?.(progress);

      const vertical = site.websiteCategory || "general";
      const imagePromptTitle = article.title.rendered;
      const imagePromptDesc = description || excerpt;
      const prompt = `Create a professional editorial illustration for a ${vertical} article. Article title: "${imagePromptTitle}". Topic: ${imagePromptDesc}. Style: clean, modern hero image for a news/content website. Wide landscape format (16:9). Web-optimized, moderate detail. Do NOT include any text, watermarks, logos, or identifiable real people.`;

      const imageResult = await generateImageWithGemini(config.geminiApiKey, prompt);

      if (imageResult.ok) {
        progress.phase = "uploading-r2";
        onProgress?.(progress);

        const optimized = await optimizeImage(imageResult.data, { format: "webp", width: 1200 });
        const imagePath = await uploadImageToR2(
          config.r2,
          siteId,
          article.slug,
          optimized,
          "image/webp",
        );
        featuredImage = imagePath;
        imageGenerated = true;
      } else {
        console.warn(`[migration] Image gen failed for ${article.slug}: ${imageResult.reason}`);
      }

      // 3e. Extract SEO from Yoast
      const yoast = article.yoast_head_json;
      const author = yoast?.author ?? "Editorial Team";
      const publishDate = article.date.split("T")[0] ?? article.date;

      // 3f. Build final .md
      const articleMd = buildArticleMd({
        title: article.title.rendered,
        description: description || excerpt,
        slug: article.slug,
        publishDate,
        author,
        tags,
        markdownBody: cleanedMd,
        featuredImage,
        wpOriginalId: article.id,
        sourceUrl: article.link ?? `${baseUrl}/${article.slug}/`,
        seo: {
          canonical: yoast?.canonical,
          og_title: yoast?.og_title,
          og_description: yoast?.og_description,
          og_image: featuredImage,
          twitter_card: yoast?.twitter_card,
        },
      });

      mdFiles.push({
        path: `sites/${siteId}/articles/${article.slug}.md`,
        content: articleMd,
      });

      results.push({ slug: article.slug, title: article.title.rendered, status: "success", imageGenerated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[migration] Failed to process ${article.slug}: ${msg}`);
      results.push({ slug: article.slug, title: article.title.rendered, status: "error", error: msg, imageGenerated: false });
    }

    progress.processedArticles++;
    progress.phase = "converting";
    onProgress?.(progress);
  }

  // 4. Batch commit all .md files to git
  progress.phase = "committing";
  onProgress?.(progress);

  if (mdFiles.length > 0) {
    await commitBatch(
      config.octokit,
      config.networkRepo,
      mdFiles,
      [],
      `feat(migration): import ${mdFiles.length} articles for ${site.name} from WordPress`,
      config.branch,
    );
  }

  progress.phase = "complete";
  progress.completedAt = Date.now();
  onProgress?.(progress);

  return {
    site: site.name,
    totalArticles: articles.length,
    successful: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
    durationMs: Date.now() - startTime,
  };
}
```

**Step 2: Commit**

```bash
git add services/content-pipeline/src/agents/migration/orchestrator.ts
git commit -m "feat(migration): orchestrator — end-to-end per-site migration pipeline"
```

---

## Task 10: HTTP endpoint — expose migration via content-pipeline API

**Files:**
- Create: `services/content-pipeline/src/agents/migration/handler.ts`
- Modify: `services/content-pipeline/src/index.ts` — register route

**Step 1: Create handler.ts**

Create `services/content-pipeline/src/agents/migration/handler.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "../../lib/config.js";
import { parseCsvRow } from "./csv-parser.js";
import { buildSiteYaml, domainToSiteId } from "./site-scaffolder.js";
import { runMigration } from "./orchestrator.js";
import type { MigrationProgress } from "./types.js";

export async function handleMigrationRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const body = await readBody(req);
  const { siteRow, branch } = JSON.parse(body) as {
    siteRow: Record<string, string>;
    branch: string;
  };

  const site = parseCsvRow(siteRow);
  const config = loadConfig();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const octokit = new Octokit({ auth: config.githubToken });
    const report = await runMigration(site, {
      anthropicApiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      geminiApiKey: process.env.GEMINI_API_KEY ?? "",
      r2: {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
        bucket: process.env.R2_BUCKET ?? "atl-assets-staging",
      },
      octokit,
      networkRepo: config.networkRepo ?? process.env.NETWORK_REPO ?? "",
      branch,
    }, (progress: MigrationProgress) => {
      sendEvent({ type: "progress", ...progress });
    });

    sendEvent({ type: "complete", report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent({ type: "error", error: msg });
  }

  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
```

**Step 2: Register route in index.ts**

Add to `services/content-pipeline/src/index.ts`, alongside existing route handlers:

```typescript
import { handleMigrationRequest } from "./agents/migration/handler.js";
```

In the request handler switch/if block, add:

```typescript
if (url.pathname === "/wp-migrate" && req.method === "POST") {
  return handleMigrationRequest(req, res);
}
```

**Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/migration/handler.ts services/content-pipeline/src/index.ts
git commit -m "feat(migration): HTTP endpoint POST /wp-migrate with SSE progress streaming"
```

---

## Task 11: Integration test — verify full pipeline with mock data

**Files:**
- Create: `services/content-pipeline/src/__tests__/migration/integration.test.ts`

**Step 1: Write integration test**

Create `services/content-pipeline/src/__tests__/migration/integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCsvRow } from "../../agents/migration/csv-parser.js";
import { buildSiteYaml, domainToSiteId } from "../../agents/migration/site-scaffolder.js";
import { wpHtmlToMarkdown } from "../../agents/migration/html-to-md.js";
import { mapCategoriesToTags } from "../../agents/migration/article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "../../agents/migration/frontmatter-builder.js";
import type { WpArticle, WpCategory } from "../../agents/migration/types.js";
import matter from "gray-matter";
import yaml from "yaml";

const SAMPLE_CSV_ROW = {
  Name: "tvshowbox.com",
  "Website Category": "Entertainment",
  "Menu Items": "News, Reviews, Streaming",
  "IAB Top Categories (Vertical)": "Entertainment",
  "Sub Categories": "Television, Movies",
  "Color Palette": "primary: #f5d580, secondary: #2a1810, accent: #d4a04c, text: #2a1810, background: #f8e8d4",
  Logo: "https://tvshowbox.com/logo.png",
  Favicon: "https://tvshowbox.com/favicon.png",
  "Posts REST API (articles)": "https://tvshowbox.com/wp-json/wp/v2/posts?per_page=75",
  "GA Info": "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
};

const SAMPLE_WP_ARTICLE: WpArticle = {
  id: 24108,
  slug: "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
  date: "2026-05-11T11:36:54",
  title: { rendered: "Newsom Slams Trump Secretary Sean Duffy Over Reality TV" },
  content: { rendered: "<h2>The Clash</h2><p>Gavin Newsom has publicly taken aim at Sean Duffy.</p><p>[gallery ids='1,2']</p>" },
  excerpt: { rendered: "<p>Gavin Newsom criticized Sean Duffy&#8217;s road trip media project.</p>" },
  author: 3,
  featured_media: 24107,
  categories: [5],
  tags: [],
  yoast_head_json: {
    title: "Newsom Slams Trump Secretary Sean Duffy Over Reality TV - TV Show Box",
    og_title: "Newsom Slams Trump Secretary Sean Duffy Over Reality TV - TV Show Box",
    og_description: "Gavin Newsom criticized Sean Duffy.",
    canonical: "https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/",
    twitter_card: "summary_large_image",
    author: "Taylor Winters",
  },
};

describe("end-to-end article conversion (no network calls)", () => {
  it("converts WP article JSON → valid .md file", () => {
    // Parse CSV row
    const site = parseCsvRow(SAMPLE_CSV_ROW);
    expect(site.name).toBe("tvshowbox.com");

    // Generate site.yaml
    const siteYaml = buildSiteYaml(site);
    const parsedYaml = yaml.parse(siteYaml);
    expect(parsedYaml.domain).toBe("tvshowbox");
    expect(parsedYaml.tracking.ga_measurement_id).toBe("G-HL2D8CQ0Z9");

    // Convert HTML → Markdown
    const md = wpHtmlToMarkdown(SAMPLE_WP_ARTICLE.content.rendered);
    expect(md).toContain("## The Clash");
    expect(md).toContain("Gavin Newsom");
    expect(md).not.toContain("[gallery");

    // Map categories
    const wpCats = new Map<number, WpCategory>([
      [5, { id: 5, name: "News", slug: "news", parent: 0 }],
    ]);
    const tags = mapCategoriesToTags([5], wpCats, site.menuItems);
    expect(tags).toEqual(["News"]);

    // Build final .md
    const excerpt = stripHtmlTags(SAMPLE_WP_ARTICLE.excerpt.rendered);
    const articleMd = buildArticleMd({
      title: SAMPLE_WP_ARTICLE.title.rendered,
      description: excerpt,
      slug: SAMPLE_WP_ARTICLE.slug,
      publishDate: "2026-05-11",
      author: "Taylor Winters",
      tags,
      markdownBody: md,
      featuredImage: "/assets/images/newsom-slams-trump-secretary-sean-duffy-over-reality-tv.webp",
      wpOriginalId: SAMPLE_WP_ARTICLE.id,
      sourceUrl: "https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/",
      seo: {
        canonical: SAMPLE_WP_ARTICLE.yoast_head_json?.canonical,
        og_title: SAMPLE_WP_ARTICLE.yoast_head_json?.og_title,
        og_description: SAMPLE_WP_ARTICLE.yoast_head_json?.og_description,
        twitter_card: SAMPLE_WP_ARTICLE.yoast_head_json?.twitter_card,
      },
    });

    // Verify final output
    const parsed = matter(articleMd);
    expect(parsed.data.title).toBe("Newsom Slams Trump Secretary Sean Duffy Over Reality TV");
    expect(parsed.data.slug).toBe("newsom-slams-trump-secretary-sean-duffy-over-reality-tv");
    expect(parsed.data.imported_from).toBe("wordpress");
    expect(parsed.data.wp_original_id).toBe(24108);
    expect(parsed.data.tags).toEqual(["News"]);
    expect(parsed.data.seo.canonical).toBe("https://tvshowbox.com/newsom-slams-trump-secretary-sean-duffy-over-reality-tv/");
    expect(parsed.data.featuredImage).toBe("/assets/images/newsom-slams-trump-secretary-sean-duffy-over-reality-tv.webp");
    expect(parsed.content).toContain("## The Clash");
    expect(parsed.content).not.toContain("[gallery");
  });

  it("preserves slug exactly for SEO", () => {
    const slugs = [
      "newsom-slams-trump-secretary-sean-duffy-over-reality-tv",
      "best-thriller-movies-2026",
      "michael-jackson-biopic-streaming-guide-2026",
    ];
    for (const slug of slugs) {
      const md = buildArticleMd({
        title: "Test",
        description: "Test",
        slug,
        publishDate: "2026-05-11",
        author: "Test",
        tags: [],
        markdownBody: "Body",
        wpOriginalId: 1,
        sourceUrl: `https://example.com/${slug}/`,
        seo: {},
      });
      const parsed = matter(md);
      expect(parsed.data.slug).toBe(slug);
    }
  });
});
```

**Step 2: Run integration test**

```bash
cd services/content-pipeline && pnpm vitest run src/__tests__/migration/integration.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add services/content-pipeline/src/__tests__/migration/integration.test.ts
git commit -m "test(migration): integration test — full WP article → .md conversion pipeline"
```

---

## Task 12: Dashboard — Import page UI

**Files:**
- Create: `services/dashboard/src/app/import/page.tsx`
- Create: `services/dashboard/src/components/import/ImportPanel.tsx`
- Modify: `services/dashboard/src/components/layout/Sidebar.tsx` — add nav item

**Step 1: Add Import to sidebar**

In `services/dashboard/src/components/layout/Sidebar.tsx`, add to `NAV_ITEMS` array (after "Review Queue", before "Deleted"):

```typescript
{ label: "Import", href: "/import", icon: <ArrowDownTrayIcon className="h-5 w-5" /> },
```

Import `ArrowDownTrayIcon` from `@heroicons/react/24/outline` (or use an existing icon pattern from the file).

**Step 2: Create page.tsx**

Create `services/dashboard/src/app/import/page.tsx`:

```typescript
"use client";

import { ImportPanel } from "@/components/import/ImportPanel";

export default function ImportPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import Sites from WordPress</h1>
        <p className="text-muted-foreground mt-1">
          Migrate WordPress articles to the ATL content network.
        </p>
      </div>
      <ImportPanel />
    </div>
  );
}
```

**Step 3: Create ImportPanel.tsx**

Create `services/dashboard/src/components/import/ImportPanel.tsx`. This follows the `ContentGenerationPanel` pattern:

- Site selector dropdown (from dashboard-index.yaml)
- Staging/Live radio toggle
- WP API URL text input
- Category mapping section (auto-fetched, editable dropdowns)
- Progress panel with step indicators
- Start Import button

**Implementation:** This is a large UI component (~300 lines). The key pattern to follow is:

1. Fetch site list from `/api/sites` on mount
2. When user selects a site, pre-fill WP API URL if available
3. "Fetch Categories" button calls WP categories API client-side (CORS allowed on WP REST API)
4. "Start Import" POSTs to `/api/agent/wp-migrate` (dashboard proxy → content-pipeline)
5. Read SSE stream for progress updates
6. Display progress with step indicators matching `MigrationProgress.phase`

**Step 4: Create dashboard API proxy route**

Create `services/dashboard/src/app/api/agent/wp-migrate/route.ts`:

```typescript
import { NextRequest } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
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
  const url = `${getAgentUrl()}/wp-migrate`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

**Step 5: Commit**

```bash
git add services/dashboard/src/app/import/ services/dashboard/src/components/import/ services/dashboard/src/app/api/agent/wp-migrate/ services/dashboard/src/components/layout/Sidebar.tsx
git commit -m "feat(dashboard): Import page with WP migration UI and SSE progress"
```

---

## Task 13: Migration verification script

**Files:**
- Create: `services/content-pipeline/src/agents/migration/verify.ts`
- Create: `services/content-pipeline/src/__tests__/migration/verify.test.ts`

**Step 1: Write failing tests**

Create `services/content-pipeline/src/__tests__/migration/verify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateArticleFrontmatter } from "../../agents/migration/verify.js";

describe("validateArticleFrontmatter", () => {
  it("passes for valid frontmatter", () => {
    const errors = validateArticleFrontmatter({
      title: "Test",
      description: "A description",
      slug: "test-slug",
      publishDate: "2026-05-11",
      author: "Author",
      tags: ["News"],
      status: "published",
      type: "standard",
      imported_from: "wordpress",
      wp_original_id: 123,
    });
    expect(errors).toHaveLength(0);
  });

  it("reports missing required fields", () => {
    const errors = validateArticleFrontmatter({ title: "Test" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => e.includes("slug"))).toBe(true);
  });

  it("reports empty description", () => {
    const errors = validateArticleFrontmatter({
      title: "Test", description: "", slug: "test", publishDate: "2026-05-11",
      author: "A", tags: [], status: "published", type: "standard",
    });
    expect(errors.some((e: string) => e.includes("description"))).toBe(true);
  });
});
```

**Step 2: Implement verify.ts**

Create `services/content-pipeline/src/agents/migration/verify.ts`:

```typescript
import matter from "gray-matter";

const REQUIRED_FIELDS = ["title", "description", "slug", "publishDate", "author", "tags", "status", "type"];

export function validateArticleFrontmatter(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof data.description === "string" && data.description.length === 0) {
    errors.push("Empty description — SEO risk");
  }

  if (typeof data.slug === "string" && !/^[a-z0-9][a-z0-9-]*$/.test(data.slug)) {
    errors.push(`Invalid slug format: ${data.slug}`);
  }

  return errors;
}

export interface VerificationReport {
  site: string;
  totalArticles: number;
  checks: Array<{ name: string; passed: boolean; details?: string }>;
  passed: boolean;
}

export function verifyMigrationFiles(
  mdContents: Array<{ path: string; content: string }>,
  expectedSlugs: string[],
  menuItems: string[],
): VerificationReport {
  const checks: Array<{ name: string; passed: boolean; details?: string }> = [];

  // Check 1: Article count
  const countMatch = mdContents.length === expectedSlugs.length;
  checks.push({
    name: "Article count match",
    passed: countMatch,
    details: countMatch ? undefined : `Expected ${expectedSlugs.length}, got ${mdContents.length}`,
  });

  // Check 2: Slug integrity
  const fileSlugs = new Set(mdContents.map((f) => f.path.split("/").pop()?.replace(".md", "")));
  const missingSlugs = expectedSlugs.filter((s) => !fileSlugs.has(s));
  checks.push({
    name: "Slug integrity",
    passed: missingSlugs.length === 0,
    details: missingSlugs.length > 0 ? `Missing: ${missingSlugs.slice(0, 5).join(", ")}` : undefined,
  });

  // Check 3: Frontmatter completeness
  let frontmatterErrors = 0;
  for (const file of mdContents) {
    const { data } = matter(file.content);
    const errors = validateArticleFrontmatter(data);
    if (errors.length > 0) frontmatterErrors++;
  }
  checks.push({
    name: "Frontmatter completeness",
    passed: frontmatterErrors === 0,
    details: frontmatterErrors > 0 ? `${frontmatterErrors} articles with missing fields` : undefined,
  });

  // Check 4: No empty bodies
  const emptyBodies = mdContents.filter((f) => matter(f.content).content.trim().length < 100);
  checks.push({
    name: "No empty bodies",
    passed: emptyBodies.length === 0,
    details: emptyBodies.length > 0 ? `${emptyBodies.length} articles with <100 chars body` : undefined,
  });

  // Check 5: Category coverage
  const noTags = mdContents.filter((f) => {
    const { data } = matter(f.content);
    const tags = (data.tags as string[]) ?? [];
    return tags.length === 0 || !tags.some((t) => menuItems.map((m) => m.toLowerCase()).includes(t.toLowerCase()));
  });
  checks.push({
    name: "Category coverage",
    passed: noTags.length === 0,
    details: noTags.length > 0 ? `${noTags.length} articles with no matching menu category` : undefined,
  });

  // Check 6: No duplicate slugs
  const slugs = mdContents.map((f) => matter(f.content).data.slug);
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  checks.push({
    name: "No duplicate slugs",
    passed: dupes.length === 0,
    details: dupes.length > 0 ? `Duplicates: ${[...new Set(dupes)].join(", ")}` : undefined,
  });

  return {
    site: "",
    totalArticles: mdContents.length,
    checks,
    passed: checks.every((c) => c.passed),
  };
}
```

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/migration/verify.ts services/content-pipeline/src/__tests__/migration/verify.test.ts
git commit -m "feat(migration): verification script — validate article count, slugs, frontmatter, categories"
```

---

## Task 14: Update exports and run full test suite

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/index.ts` — ensure all exports
- Modify: `services/content-pipeline/src/index.ts` — register route

**Step 1: Update index.ts exports**

Ensure `services/content-pipeline/src/agents/migration/index.ts` exports everything:

```typescript
export { parseCsvRow, parseColorPalette, parseGaInfo } from "./csv-parser.js";
export { fetchWpArticles, fetchWpCategories, extractBaseUrl } from "./wp-fetcher.js";
export { wpHtmlToMarkdown } from "./html-to-md.js";
export { cleanupArticle, mapCategoriesToTags, buildCleanupPrompt, parseCleanupResponse } from "./article-cleanup.js";
export { buildSiteYaml, domainToSiteId } from "./site-scaffolder.js";
export { buildArticleMd, stripHtmlTags, estimateReadingTime } from "./frontmatter-builder.js";
export { runMigration } from "./orchestrator.js";
export { verifyMigrationFiles, validateArticleFrontmatter } from "./verify.js";
export { handleMigrationRequest } from "./handler.js";
export type * from "./types.js";
```

**Step 2: Run full test suite**

```bash
cd services/content-pipeline && pnpm vitest run
```

Expected: All existing tests + all new migration tests pass.

**Step 3: Run typecheck**

```bash
cd services/content-pipeline && pnpm typecheck
cd services/dashboard && pnpm typecheck
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/migration/index.ts
git commit -m "feat(migration): finalize exports and verify full test suite passes"
```

---

## Task 15: First site test — run pipeline on travelbeautytips.com

This is a manual integration test against the real WP API and dev CF account.

**Step 1: Start services locally**

```bash
cloudgrid dev
```

**Step 2: Test WP API fetch manually**

```bash
curl -s "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=1" | jq '.[0].slug'
```

Verify the API is accessible and returns articles.

**Step 3: Create the site via CSV data (Phase 1)**

Either use the dashboard wizard with data from the CSV, or run site scaffolding directly.

**Step 4: Trigger import via dashboard**

Navigate to `http://localhost:3001/import`, select `travelbeautytips`, paste the WP API URL, review category mappings, click "Start Import".

**Step 5: Verify on staging preview**

Open `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=travelbeautytips`

Run through the manual QA checklist from the design doc:
- Homepage renders with hero + articles
- Click each category — articles filtered correctly
- Open 5 random articles — formatting, image, author, date
- View source — SEO meta tags present
- Compare side-by-side with WP original

**Step 6: Document any issues and iterate**

---

## Summary

| Task | Component | Tests |
|---|---|---|
| 1 | Scaffold + types + turndown dep | — |
| 2 | CSV parser | 3 test suites |
| 3 | Site scaffolder | 2 test suites |
| 4 | WP fetcher | 3 test suites |
| 5 | HTML→MD converter | 7 tests |
| 6 | Claude cleanup agent | 3 test suites |
| 7 | R2 upload utility | 1 test |
| 8 | Frontmatter builder | 3 test suites |
| 9 | Orchestrator | — (covered by integration) |
| 10 | HTTP endpoint + route | — |
| 11 | Integration test | 2 tests (full pipeline) |
| 12 | Dashboard Import page + API proxy | — (UI, manual test) |
| 13 | Verification script | 2 test suites |
| 14 | Final exports + full test suite | — |
| 15 | Live test on travelbeautytips.com | Manual QA |

**Total new test files:** 7
**Total new source files:** ~12
**Estimated implementation time:** 2-3 days
