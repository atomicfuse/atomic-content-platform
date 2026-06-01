# Bulk Image Generation API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /bulk-generate-images` endpoint to the content-pipeline that scans articles for default general images and triggers n8n image generation in batches of 3 with 3-minute pauses.

**Architecture:** New `bulk-image.ts` module in content-pipeline handles scanning (via GitHub API), filtering (isGeneralImage), and batched webhook dispatch (reusing existing `triggerN8nImage`). A dashboard proxy route forwards requests. Auth via `X-API-Key` header validated against `BULK_IMAGE_API_KEY` env var.

**Tech Stack:** Node.js (content-pipeline), Next.js App Router (dashboard proxy), Vitest (tests), GitHub API via Octokit, n8n webhooks.

**Spec:** `docs/superpowers/specs/2026-05-26-bulk-image-generation-api-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `services/content-pipeline/src/lib/config.ts` | Add `bulkImageApiKey` field to `AgentConfig` |
| `services/content-pipeline/src/agents/content-generation/bulk-image.ts` | **New.** Core module: `isGeneralImage()`, `scanArticlesForGeneralImages()`, `startBulkImageGeneration()`, concurrency guard, batch runner |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Wire `POST /bulk-generate-images` route |
| `services/content-pipeline/src/__tests__/bulk-image.test.ts` | **New.** Tests for bulk-image module |
| `services/dashboard/src/app/api/agent/bulk-generate-images/route.ts` | **New.** Thin proxy to content-pipeline |
| `services/dashboard/public/guide/19-bulk-image-api.md` | **New.** User-facing API docs |
| `services/dashboard/src/app/guide/page.tsx` | Register guide page |

---

### Task 1: Add `bulkImageApiKey` to AgentConfig

**Files:**
- Modify: `services/content-pipeline/src/lib/config.ts`

- [ ] **Step 1: Add field to AgentConfig interface**

In `services/content-pipeline/src/lib/config.ts`, add `bulkImageApiKey` to the `AgentConfig` interface:

```typescript
export interface AgentConfig {
  github: GitHubConfig;
  networkRepo: string;
  localNetworkPath: string | undefined;
  geminiApiKey: string | undefined;
  contentAggregatorUrl: string;
  port: number;
  redisUrl?: string;
  n8nImageWebhookUrl?: string;
  imageCallbackUrl?: string;
  bulkImageApiKey?: string;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
}
```

- [ ] **Step 2: Read env var in loadConfig()**

In the `return` block of `loadConfig()`, add:

```typescript
    bulkImageApiKey: process.env.BULK_IMAGE_API_KEY,
```

Place it after the `imageCallbackUrl` line.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/lib/config.ts
git commit -m "feat(content-pipeline): add bulkImageApiKey to AgentConfig"
```

---

### Task 2: Create bulk-image.ts — isGeneralImage + scan + batch runner

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/bulk-image.ts`
- Create: `services/content-pipeline/src/__tests__/bulk-image.test.ts`

This is the core module. It exports:
- `isGeneralImage(featuredImage, domain)` — detection utility
- `scanArticlesForGeneralImages(config, scope, domain?)` — scan phase
- `startBulkImageGeneration(config, articles)` — background batch runner
- `getBulkJobStatus()` — concurrency guard state for 409 responses

- [ ] **Step 1: Write the complete test file**

Create `services/content-pipeline/src/__tests__/bulk-image.test.ts` with the full test file content. This file is written once and contains all tests — `isGeneralImage`, `scanArticlesForGeneralImages`, `buildResponse`, `getBulkJobStatus`, and `startBulkImageGeneration`.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isGeneralImage,
  scanArticlesForGeneralImages,
  buildResponse,
  getBulkJobStatus,
  startBulkImageGeneration,
  SiteNotFoundError,
  type ScanResult,
} from "../agents/content-generation/bulk-image.js";
import type { AgentConfig } from "../lib/config.js";

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => ({ _mock: "octokit" })),
  readFile: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock("../lib/site-brief.js", () => ({
  listActiveSites: vi.fn(),
  readSiteBriefWithFallback: vi.fn(),
}));

vi.mock("../agents/content-generation/n8n-image.js", () => ({
  triggerN8nImage: vi.fn(),
}));

import { createGitHubClient, readFile, listFiles } from "../lib/github.js";
import { listActiveSites, readSiteBriefWithFallback } from "../lib/site-brief.js";
import { triggerN8nImage } from "../agents/content-generation/n8n-image.js";

// ── Fixtures ───────────────────────────────────────────────────────
const fakeConfig: AgentConfig = {
  github: { token: "ghp_test", repo: "atomicfuse/atomic-labs-network" },
  networkRepo: "atomicfuse/atomic-labs-network",
  localNetworkPath: undefined,
  geminiApiKey: undefined,
  contentAggregatorUrl: "",
  port: 5000,
  n8nImageWebhookUrl: "https://n8n.example.com/webhook/test",
  imageCallbackUrl: "https://example.com/api/agent/image-callback",
  bulkImageApiKey: "test-api-key",
  notifications: {},
};

const articleWithGeneralImage = [
  "---",
  "title: Best Travel Gear 2026",
  "slug: best-travel-gear-2026",
  "description: A guide to travel gear",
  "featuredImage: /assets/images/travelswire-general-article.webp",
  "---",
  "",
  "Article body content here for summary extraction.",
].join("\n");

const articleWithRealImage = [
  "---",
  "title: Wine Regions of France",
  "slug: wine-regions-france",
  "description: Explore French wine regions",
  "featuredImage: /assets/images/wine-regions-france.webp",
  "---",
  "",
  "Body text about wine.",
].join("\n");

const articleWithNoImage = [
  "---",
  "title: No Image Article",
  "slug: no-image-article",
  "description: This article has no featured image",
  "---",
  "",
  "Body without image.",
].join("\n");

const articleWithNoTitle = [
  "---",
  "slug: no-title-article",
  "featuredImage: /assets/images/travelswire-general-article.webp",
  "---",
  "",
  "Body text.",
].join("\n");

// ── isGeneralImage ─────────────────────────────────────────────────
describe("isGeneralImage", () => {
  it("returns true when featuredImage is undefined", () => {
    expect(isGeneralImage(undefined, "travelswire")).toBe(true);
  });

  it("returns true when featuredImage is empty string", () => {
    expect(isGeneralImage("", "travelswire")).toBe(true);
  });

  it("returns true when featuredImage contains domain-general-article", () => {
    expect(
      isGeneralImage("/assets/images/travelswire-general-article.webp", "travelswire"),
    ).toBe(true);
  });

  it("returns true when featuredImage contains general-article without domain", () => {
    expect(isGeneralImage("/assets/images/general-article.webp", "travelswire")).toBe(true);
  });

  it("returns false when featuredImage is a real article image", () => {
    expect(
      isGeneralImage("/assets/images/best-travel-gear-2026.webp", "travelswire"),
    ).toBe(false);
  });

  it("returns false when featuredImage is an external URL", () => {
    expect(isGeneralImage("https://cdn.example.com/photo.jpg", "travelswire")).toBe(false);
  });
});

// ── scanArticlesForGeneralImages ───────────────────────────────────
describe("scanArticlesForGeneralImages", () => {
  beforeEach(() => {
    vi.mocked(createGitHubClient).mockReturnValue({ _mock: "octokit" } as never);
    vi.mocked(listActiveSites).mockResolvedValue([
      { domain: "travelswire", branch: "staging/travelswire" },
    ]);
    vi.mocked(listFiles).mockResolvedValue([
      "best-travel-gear-2026.md",
      "wine-regions-france.md",
    ]);
    vi.mocked(readFile).mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path.includes("best-travel-gear")) return articleWithGeneralImage;
      if (path.includes("wine-regions")) return articleWithRealImage;
      throw new Error("not found");
    });
  });

  it("returns articles with general images and skips those with real images", async () => {
    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].slug).toBe("best-travel-gear-2026");
    expect(result.articles[0].branch).toBe("staging/travelswire");
    expect(result.skipped).toHaveLength(0);
  });

  it("includes articles with no featuredImage field", async () => {
    vi.mocked(listFiles).mockResolvedValue(["no-image-article.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithNoImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].slug).toBe("no-image-article");
  });

  it("skips articles missing title", async () => {
    vi.mocked(listFiles).mockResolvedValue(["no-title-article.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithNoTitle);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("missing title");
  });

  it("throws SiteNotFoundError for unknown domain", async () => {
    vi.mocked(listActiveSites).mockResolvedValue([]);

    await expect(
      scanArticlesForGeneralImages(fakeConfig, "site", "nonexistent"),
    ).rejects.toThrow(SiteNotFoundError);
  });

  it("requires domain when scope is site", async () => {
    await expect(
      scanArticlesForGeneralImages(fakeConfig, "site"),
    ).rejects.toThrow("domain is required");
  });

  it("scans all sites when scope is all", async () => {
    vi.mocked(listActiveSites).mockResolvedValue([
      { domain: "travelswire", branch: "staging/travelswire" },
      { domain: "wineoceans", branch: "staging/wineoceans" },
    ]);
    vi.mocked(listFiles).mockResolvedValue(["best-travel-gear-2026.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithGeneralImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "all");

    expect(result.articles).toHaveLength(2);
  });

  it("falls back to main branch when staging branch fails", async () => {
    vi.mocked(listFiles)
      .mockRejectedValueOnce(new Error("branch not found"))
      .mockResolvedValueOnce(["best-travel-gear-2026.md"]);
    vi.mocked(readFile).mockResolvedValue(articleWithGeneralImage);

    const result = await scanArticlesForGeneralImages(fakeConfig, "site", "travelswire");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].branch).toBe("main");
  });
});

// ── buildResponse ──────────────────────────────────────────────────
describe("buildResponse", () => {
  it("calculates batch info correctly", () => {
    const scan: ScanResult = {
      articles: Array.from({ length: 10 }, (_, i) => ({
        domain: "travelswire",
        slug: `article-${i}`,
        title: `Article ${i}`,
        description: `Description ${i}`,
        summary: `Summary ${i}`,
        branch: "staging/travelswire",
      })),
      skipped: [{ domain: "travelswire", slug: "bad", reason: "missing title" }],
    };

    const response = buildResponse({ scope: "site", domain: "travelswire" }, scan);

    expect(response.queued).toBe(10);
    expect(response.skipped).toBe(1);
    expect(response.batch_size).toBe(3);
    expect(response.batch_pause_seconds).toBe(180);
    expect(response.total_batches).toBe(4);
    expect(response.estimated_total_seconds).toBe(540);
    expect(response.articles).toHaveLength(10);
    expect(response.dry_run).toBe(false);
  });

  it("returns 0 estimated time for empty queue", () => {
    const response = buildResponse(
      { scope: "site", domain: "travelswire", dry_run: true },
      { articles: [], skipped: [] },
    );

    expect(response.queued).toBe(0);
    expect(response.total_batches).toBe(0);
    expect(response.estimated_total_seconds).toBe(0);
    expect(response.dry_run).toBe(true);
  });
});

// ── concurrency guard + startBulkImageGeneration ───────────────────
describe("getBulkJobStatus", () => {
  it("returns not in progress by default", () => {
    const status = getBulkJobStatus();
    expect(status.inProgress).toBe(false);
    expect(status.remaining).toBe(0);
  });
});

describe("startBulkImageGeneration", () => {
  beforeEach(() => {
    vi.mocked(triggerN8nImage).mockResolvedValue(true);
    vi.mocked(readSiteBriefWithFallback).mockResolvedValue({
      data: {
        domain: "travelswire",
        siteName: "TravelsWire",
        group: "travel",
        brief: { vertical: "Travel" } as never,
      },
      branch: "staging/travelswire",
    });
  });

  it("does nothing for empty article list", () => {
    startBulkImageGeneration(fakeConfig, []);
    expect(getBulkJobStatus().inProgress).toBe(false);
  });

  it("sets concurrency guard when started", () => {
    const articles = [
      {
        domain: "travelswire",
        slug: "test-article",
        title: "Test",
        description: "Desc",
        summary: "Sum",
        branch: "staging/travelswire",
      },
    ];

    startBulkImageGeneration(fakeConfig, articles);

    const status = getBulkJobStatus();
    expect(status.inProgress).toBe(true);
    expect(status.remaining).toBe(1);
    expect(status.totalBatches).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/bulk-image.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write isGeneralImage + type definitions + concurrency guard + scan + batch runner**

Create `services/content-pipeline/src/agents/content-generation/bulk-image.ts`:

```typescript
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import type { AgentConfig } from "../../lib/config.js";
import { createGitHubClient, readFile, listFiles } from "../../lib/github.js";
import { listActiveSites, readSiteBriefWithFallback } from "../../lib/site-brief.js";
import { triggerN8nImage } from "./n8n-image.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BulkImageRequest {
  scope: "site" | "all";
  domain?: string;
  dry_run?: boolean;
}

export interface ScannedArticle {
  domain: string;
  slug: string;
  title: string;
  description: string;
  summary: string;
  branch: string;
}

interface SkippedArticle {
  domain: string;
  slug: string;
  reason: string;
}

export interface ScanResult {
  articles: ScannedArticle[];
  skipped: SkippedArticle[];
}

export interface BulkImageResponse {
  dry_run: boolean;
  scope: "site" | "all";
  domain?: string;
  queued: number;
  skipped: number;
  skipped_reasons: SkippedArticle[];
  batch_size: number;
  batch_pause_seconds: number;
  total_batches: number;
  estimated_total_seconds: number;
  articles: Array<{ domain: string; slug: string; title: string }>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BATCH_SIZE = 3;
const BATCH_PAUSE_MS = 3 * 60 * 1000; // 3 minutes

/* ------------------------------------------------------------------ */
/*  Concurrency guard                                                  */
/* ------------------------------------------------------------------ */

interface BulkJobState {
  inProgress: boolean;
  remaining: number;
  currentBatch: number;
  totalBatches: number;
}

const bulkJob: BulkJobState = {
  inProgress: false,
  remaining: 0,
  currentBatch: 0,
  totalBatches: 0,
};

export function getBulkJobStatus(): BulkJobState {
  return { ...bulkJob };
}

function setBulkJobActive(total: number): void {
  bulkJob.inProgress = true;
  bulkJob.remaining = total;
  bulkJob.currentBatch = 0;
  bulkJob.totalBatches = Math.ceil(total / BATCH_SIZE);
}

function decrementRemaining(): void {
  bulkJob.remaining = Math.max(0, bulkJob.remaining - 1);
}

function advanceBatch(): void {
  bulkJob.currentBatch++;
}

function clearBulkJob(): void {
  bulkJob.inProgress = false;
  bulkJob.remaining = 0;
  bulkJob.currentBatch = 0;
  bulkJob.totalBatches = 0;
}

/* ------------------------------------------------------------------ */
/*  General image detection                                            */
/* ------------------------------------------------------------------ */

/** Returns true if the article uses the site's default general image or has no image. */
export function isGeneralImage(
  featuredImage: string | undefined,
  domain: string,
): boolean {
  if (!featuredImage) return true;
  return featuredImage.includes("general-article");
}

/* ------------------------------------------------------------------ */
/*  Scan phase                                                         */
/* ------------------------------------------------------------------ */

/**
 * Scan articles across one or all sites, returning those with general images.
 * Reads from staging branch with fallback to main.
 * Logs total GitHub API calls for rate limit monitoring.
 */
export async function scanArticlesForGeneralImages(
  config: AgentConfig,
  scope: "site" | "all",
  domain?: string,
): Promise<ScanResult> {
  const octokit = createGitHubClient(config.github);
  const articles: ScannedArticle[] = [];
  const skipped: SkippedArticle[] = [];
  let apiCalls = 0;

  // Determine which sites to scan
  let sites: Array<{ domain: string; branch: string }>;

  if (scope === "site") {
    if (!domain) throw new Error("domain is required when scope is site");
    // Verify site exists in dashboard-index
    const allSites = await listActiveSites(octokit, config.github.repo);
    apiCalls++; // dashboard-index.yaml read
    const found = allSites.find((s) => s.domain === domain);
    if (!found) throw new SiteNotFoundError(domain);
    sites = [found];
  } else {
    sites = await listActiveSites(octokit, config.github.repo);
    apiCalls++; // dashboard-index.yaml read
  }

  // Scan each site
  for (const site of sites) {
    let articleFiles: string[];
    let branch = site.branch;

    try {
      articleFiles = await listFiles(
        octokit,
        config.github.repo,
        `sites/${site.domain}/articles`,
        branch,
      );
      apiCalls++;
    } catch {
      // Try main as fallback
      try {
        articleFiles = await listFiles(
          octokit,
          config.github.repo,
          `sites/${site.domain}/articles`,
        );
        apiCalls++;
        branch = "main";
      } catch {
        apiCalls++;
        // No articles directory at all — skip site
        continue;
      }
    }

    const mdFiles = articleFiles.filter((f) => f.endsWith(".md"));

    for (const file of mdFiles) {
      const slug = file.replace(/\.md$/, "");
      const articlePath = `sites/${site.domain}/articles/${file}`;

      let content: string;
      try {
        content = await readFile(octokit, config.github.repo, articlePath, branch);
        apiCalls++;
      } catch {
        apiCalls++;
        skipped.push({ domain: site.domain, slug, reason: "could not read file" });
        continue;
      }

      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(content);
      } catch {
        skipped.push({ domain: site.domain, slug, reason: "invalid frontmatter" });
        continue;
      }

      const featuredImage = parsed.data.featuredImage as string | undefined;

      if (!isGeneralImage(featuredImage, site.domain)) {
        continue; // Already has a real image
      }

      const title = parsed.data.title as string | undefined;
      if (!title) {
        skipped.push({ domain: site.domain, slug, reason: "missing title" });
        continue;
      }

      const description = (parsed.data.description as string) ?? title;
      const summary = parsed.content.slice(0, 500);

      articles.push({
        domain: site.domain,
        slug,
        title,
        description,
        summary,
        branch,
      });
    }
  }

  console.log(
    `[bulk-image] Scan complete: ${articles.length} articles with general images, ` +
      `${skipped.length} skipped, ${apiCalls} GitHub API calls`,
  );

  return { articles, skipped };
}

export class SiteNotFoundError extends Error {
  constructor(domain: string) {
    super(`Site not found: ${domain}`);
    this.name = "SiteNotFoundError";
  }
}

/* ------------------------------------------------------------------ */
/*  Batch queue runner (background)                                    */
/* ------------------------------------------------------------------ */

/**
 * Start the background batch runner. Fires webhooks in batches of 3
 * with a 3-minute pause between batches. Returns immediately.
 */
export function startBulkImageGeneration(
  config: AgentConfig,
  articles: ScannedArticle[],
): void {
  if (articles.length === 0) return;

  const webhookUrl = config.n8nImageWebhookUrl!;
  const callbackUrl =
    config.imageCallbackUrl ??
    "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

  setBulkJobActive(articles.length);

  // Clone the array so callers can't mutate it
  const queue = [...articles];

  // Start async processing (fire and forget)
  void processBatches(config, queue, webhookUrl, callbackUrl);
}

async function processBatches(
  config: AgentConfig,
  queue: ScannedArticle[],
  webhookUrl: string,
  callbackUrl: string,
): Promise<void> {
  let triggered = 0;
  let failed = 0;
  const octokit = createGitHubClient(config.github);

  // Cache site briefs per-domain to avoid redundant GitHub API calls
  // (all articles from the same site share the same brief)
  const briefCache = new Map<string, { vertical: string; imageGuidelines: string | null }>();

  async function getSiteBrief(
    domain: string,
    branch: string,
  ): Promise<{ vertical: string; imageGuidelines: string | null }> {
    const cached = briefCache.get(domain);
    if (cached) return cached;

    let vertical = "";
    let imageGuidelines: string | null = null;
    try {
      const briefResult = await readSiteBriefWithFallback(
        octokit,
        config.github.repo,
        domain,
        branch,
      );
      vertical = briefResult.data.brief?.vertical ?? "";
      imageGuidelines = briefResult.data.brief?.image_guidelines ?? null;
    } catch {
      // Use defaults if brief can't be read
    }

    const entry = { vertical, imageGuidelines };
    briefCache.set(domain, entry);
    return entry;
  }

  try {
    while (queue.length > 0) {
      advanceBatch();
      const batch = queue.splice(0, BATCH_SIZE);

      console.log(
        `[bulk-image] Batch ${bulkJob.currentBatch}/${bulkJob.totalBatches}: ` +
          `firing ${batch.length} webhooks, ${queue.length} remaining`,
      );

      for (const article of batch) {
        try {
          const { vertical, imageGuidelines } = await getSiteBrief(
            article.domain,
            article.branch,
          );

          const accepted = await triggerN8nImage(webhookUrl, {
            request_id: randomUUID(),
            callback_url: callbackUrl,
            job_id: "",
            site_domain: article.domain,
            slug: article.slug,
            branch: article.branch,
            article: {
              title: article.title,
              description: article.description,
              summary: article.summary,
              vertical,
              source_thumbnail_url: null,
              image_guidelines: imageGuidelines ?? null,
            },
          });

          if (accepted) {
            triggered++;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          console.error(
            `[bulk-image] Error triggering image for ${article.domain}/${article.slug}:`,
            err instanceof Error ? err.message : err,
          );
        }

        decrementRemaining();
      }

      // Pause between batches (skip pause after last batch)
      if (queue.length > 0) {
        console.log(
          `[bulk-image] Waiting ${BATCH_PAUSE_MS / 1000}s before next batch...`,
        );
        await sleep(BATCH_PAUSE_MS);
      }
    }
  } catch (err) {
    console.error("[bulk-image] Batch processing error:", err);
  } finally {
    console.log(
      `[bulk-image] Complete: ${triggered} triggered, ${failed} failed`,
    );
    clearBulkJob();
  }
}

/* ------------------------------------------------------------------ */
/*  Response builder                                                   */
/* ------------------------------------------------------------------ */

export function buildResponse(
  request: BulkImageRequest,
  scan: ScanResult,
): BulkImageResponse {
  const totalBatches = Math.ceil(scan.articles.length / BATCH_SIZE);
  return {
    dry_run: request.dry_run ?? false,
    scope: request.scope,
    domain: request.domain,
    queued: scan.articles.length,
    skipped: scan.skipped.length,
    skipped_reasons: scan.skipped,
    batch_size: BATCH_SIZE,
    batch_pause_seconds: BATCH_PAUSE_MS / 1000,
    total_batches: totalBatches,
    estimated_total_seconds:
      totalBatches > 0 ? (totalBatches - 1) * (BATCH_PAUSE_MS / 1000) : 0,
    articles: scan.articles.map((a) => ({
      domain: a.domain,
      slug: a.slug,
      title: a.title,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/bulk-image.test.ts`
Expected: All tests PASS (isGeneralImage, scanArticlesForGeneralImages, buildResponse, getBulkJobStatus, startBulkImageGeneration)

- [ ] **Step 5: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/bulk-image.ts services/content-pipeline/src/__tests__/bulk-image.test.ts
git commit -m "feat(content-pipeline): add bulk image scan, batch runner, and tests"
```

---

### Task 3: Wire up POST /bulk-generate-images route

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

- [ ] **Step 1: Add the route handler**

In `services/content-pipeline/src/agents/content-generation/index.ts`, add the following route **before** the existing fallback 404 handler. Find the pattern where routes are checked (the chain of `if (req.method === ... && req.url === ...)` blocks) and add this new block:

```typescript
  // ─── Bulk image generation ───────────────────────────────────────
  if (req.method === "POST" && req.url === "/bulk-generate-images") {
    // Auth check
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!config.bulkImageApiKey || apiKey !== config.bulkImageApiKey) {
      sendJson(res, 401, { error: "Invalid or missing API key" });
      return;
    }

    // Parse body
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { error: "Payload too large" });
      return;
    }

    let payload: BulkImageRequest;
    try {
      payload = JSON.parse(rawBody) as BulkImageRequest;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    // Validate scope
    if (!payload.scope || !["site", "all"].includes(payload.scope)) {
      sendJson(res, 400, { error: "scope is required (site | all)" });
      return;
    }

    if (payload.scope === "site" && !payload.domain) {
      sendJson(res, 400, { error: "domain is required when scope is site" });
      return;
    }

    const isDryRun = payload.dry_run ?? false;

    // n8n check (skip for dry runs)
    if (!isDryRun && !config.n8nImageWebhookUrl) {
      sendJson(res, 503, { error: "N8N_IMAGE_WEBHOOK_URL not configured" });
      return;
    }

    // Concurrency guard
    const jobStatus = getBulkJobStatus();
    if (!isDryRun && jobStatus.inProgress) {
      sendJson(res, 409, {
        error: "Bulk image generation already in progress",
        queued_remaining: jobStatus.remaining,
        current_batch: jobStatus.currentBatch,
        total_batches: jobStatus.totalBatches,
      });
      return;
    }

    // Scan
    try {
      const scan = await scanArticlesForGeneralImages(
        config,
        payload.scope,
        payload.domain,
      );

      const response = buildResponse(payload, scan);

      // Start background processing if not dry run and there are articles
      if (!isDryRun && scan.articles.length > 0) {
        startBulkImageGeneration(config, scan.articles);
      }

      sendJson(res, 200, response as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof SiteNotFoundError) {
        sendJson(res, 404, { error: err.message });
      } else {
        console.error("[bulk-generate-images] Error:", err);
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : "Internal error",
        });
      }
    }
    return;
  }
```

- [ ] **Step 2: Add imports at the top of index.ts**

Add to the imports at the top of the file:

```typescript
import {
  type BulkImageRequest,
  scanArticlesForGeneralImages,
  startBulkImageGeneration,
  buildResponse,
  getBulkJobStatus,
  SiteNotFoundError,
} from "./bulk-image.js";
```

- [ ] **Step 3: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Run all tests to make sure nothing broke**

Run: `cd services/content-pipeline && pnpm test`
Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): wire up POST /bulk-generate-images route"
```

---

### Task 4: Create dashboard proxy route

**Files:**
- Create: `services/dashboard/src/app/api/agent/bulk-generate-images/route.ts`

- [ ] **Step 1: Create the proxy route**

Create `services/dashboard/src/app/api/agent/bulk-generate-images/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.text();

    const res = await fetch(`${getAgentUrl()}/bulk-generate-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("x-api-key")
          ? { "X-API-Key": req.headers.get("x-api-key")! }
          : {}),
      },
      body,
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach content pipeline";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/agent/bulk-generate-images/route.ts
git commit -m "feat(dashboard): add proxy route for bulk image generation API"
```

---

### Task 5: Create guide documentation + register page

**Files:**
- Create: `services/dashboard/public/guide/19-bulk-image-api.md`
- Modify: `services/dashboard/src/app/guide/page.tsx`

- [ ] **Step 1: Create guide markdown**

Create `services/dashboard/public/guide/19-bulk-image-api.md`:

````markdown
# Bulk Image Generation API

Trigger AI image generation for all articles that still use the default site image. Works per-site or across all sites.

## How It Works

1. The API scans articles and identifies those using the default general image (`{site}-general-article.webp`) or with no image at all.
2. For each matching article, it triggers the n8n image generation pipeline.
3. Images are generated in **batches of 3** with a **3-minute pause** between batches to avoid overloading n8n.
4. The API returns immediately after scanning. Image generation happens in the background.
5. Generated images go through the standard pipeline: n8n generates → optimize → upload to R2 → update article in Git.

## Authentication

All requests require an `X-API-Key` header matching the `BULK_IMAGE_API_KEY` environment variable configured on the content-pipeline service.

## Endpoints

### Content Pipeline (direct)

```
POST http://localhost:5000/bulk-generate-images
```

### Dashboard Proxy (production)

```
POST https://sites-platform-e297.atomic.cloudgrid.io/api/agent/bulk-generate-images
```

## Request

```json
{
  "scope": "site",
  "domain": "travelswire",
  "dry_run": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `"site"` or `"all"` | Yes | Process one site or all active sites |
| `domain` | string | When scope=site | Site ID (e.g. `travelswire`, `wineoceans`) |
| `dry_run` | boolean | No (default: false) | Preview which articles would be queued without triggering generation |

## Response

```json
{
  "dry_run": false,
  "scope": "site",
  "domain": "travelswire",
  "queued": 47,
  "skipped": 3,
  "skipped_reasons": [
    { "domain": "travelswire", "slug": "broken-article", "reason": "missing title" }
  ],
  "batch_size": 3,
  "batch_pause_seconds": 180,
  "total_batches": 16,
  "estimated_total_seconds": 2700,
  "articles": [
    { "domain": "travelswire", "slug": "best-travel-gear-2026", "title": "Best Travel Gear 2026" }
  ]
}
```

## Examples

### Dry run (preview)

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "site", "domain": "travelswire", "dry_run": true}'
```

### Generate for one site

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "site", "domain": "travelswire"}'
```

### Generate for all sites

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "all"}'
```

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid request fields |
| 401 | Invalid or missing API key |
| 404 | Site not found |
| 409 | Another bulk job is already running |
| 503 | n8n webhook URL not configured (non-dry-run only) |

## Notes

- Only one bulk job can run at a time. If a job is running, you'll get a 409 with progress info.
- Dry runs work even when n8n is not configured — useful for previewing scope.
- Each image takes ~46 seconds for n8n to generate. A batch of 3 articles queues in seconds, then the API waits 3 minutes before the next batch.
- The existing n8n callback pipeline handles everything after the webhook fires — no changes needed.
````

- [ ] **Step 2: Register in GUIDE_PAGES**

In `services/dashboard/src/app/guide/page.tsx`, add to the end of the `GUIDE_PAGES` array:

```typescript
  { slug: "19-bulk-image-api", title: "Bulk Image Generation API" },
```

- [ ] **Step 3: Typecheck dashboard**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/public/guide/19-bulk-image-api.md services/dashboard/src/app/guide/page.tsx
git commit -m "docs: add bulk image generation API guide"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run content-pipeline tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: All tests pass

- [ ] **Step 2: Typecheck both services**

Run: `cd services/content-pipeline && pnpm typecheck && cd ../dashboard && pnpm typecheck`
Expected: No errors in either service

- [ ] **Step 3: Run full monorepo typecheck**

Run: `pnpm typecheck`
Expected: No errors
