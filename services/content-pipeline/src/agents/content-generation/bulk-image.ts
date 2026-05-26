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
  _domain: string,
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
    const allSites = await listActiveSites(octokit, config.github.repo);
    apiCalls++;
    const found = allSites.find((s) => s.domain === domain);
    if (!found) throw new SiteNotFoundError(domain);
    sites = [found];
  } else {
    sites = await listActiveSites(octokit, config.github.repo);
    apiCalls++;
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
        continue;
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

  const queue = [...articles];

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
      const raw = briefResult.data.brief?.image_guidelines;
      imageGuidelines = Array.isArray(raw) ? raw.join("\n") : raw ?? null;
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
