import { FlowProducer, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { createOctokit, readFile, readFileBase64, commitFile, listFilesRecursive, commitBatch, clearTreeCache, parseRepo } from "../lib/github.js";
import type { BatchFileEntry, BatchBinaryEntry } from "../lib/github.js";
import type { Octokit } from "@octokit/rest";
import type { AgentConfig } from "../lib/config.js";
import type { SiteRunResult } from "../agents/scheduled-publisher/history.js";
import { listActiveSites } from "../lib/site-brief.js";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import {
  GENERATE_QUEUE,
  SCHEDULER_RUN_QUEUE,
  DEFAULT_JOB_OPTIONS,
} from "./types.js";
import type { GenerateJobData, SchedulerRunData } from "./types.js";
import { notifyError, notifySummary } from "../lib/notifications.js";
import { updateWeeklySummary } from "../stats/weekly-summary.js";
import matter from "gray-matter";
import { upsertArticlesBatch, deleteArticlesForSiteBranch } from "../lib/db/articles.js";

const HISTORY_PATH = "scheduler/history.json";
const MAX_ENTRIES = 50;
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://dashboard-app";
const CACHE_INVALIDATE_SECRET = process.env.CACHE_INVALIDATE_SECRET;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function invalidateDashboardCache(domain: string, branch?: string): Promise<void> {
  if (!CACHE_INVALIDATE_SECRET) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/cache/invalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CACHE_INVALIDATE_SECRET}`,
      },
      body: JSON.stringify({ domain, branch }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn(`[scheduler] Failed to invalidate dashboard cache for ${domain}:`, err);
  }
}

/** Deterministic run ID — hourly granularity. */
export function buildRunId(): string {
  return new Date().toISOString().slice(0, 13);
}

// ---------------------------------------------------------------------------
// Flow creation
// ---------------------------------------------------------------------------

export interface SchedulerSite {
  domain: string;
  branch: string;
  count: number;
  briefJson?: string;
}

/**
 * Create a BullMQ Flow: one parent `scheduler-run` job with N child `generate` jobs.
 * Uses deterministic `jobId` to prevent double-enqueue from overlapping cron ticks.
 *
 * The first argument is a pre-built FlowProducer (created once at boot in
 * `setupSchedulerFlow`). Reusing it avoids leaking a Redis connection per tick.
 */
export async function createSchedulerFlow(
  flowProducer: FlowProducer,
  runId: string,
  timezone: string,
  forced: boolean,
  sites: SchedulerSite[],
  skipped: Array<{ domain: string; reason: string }>,
): Promise<{ runId: string; enqueued: number }> {
  const children = sites.map((site) => ({
    name: "generate",
    queueName: GENERATE_QUEUE,
    data: {
      siteDomain: site.domain,
      count: site.count,
      branch: site.branch,
      runId,
      triggeredBy: (forced ? "scheduled-forced" : "scheduled") as GenerateJobData["triggeredBy"],
      briefJson: site.briefJson,
      timezone,
    },
    opts: DEFAULT_JOB_OPTIONS,
  }));

  await flowProducer.add({
    name: "scheduler-run",
    queueName: SCHEDULER_RUN_QUEUE,
    data: {
      runId,
      timezone,
      forced,
      enqueuedDomains: sites.map((s) => ({ domain: s.domain, count: s.count })),
      skipped,
    } satisfies SchedulerRunData,
    opts: {
      jobId: `scheduler-run-${runId}`,
    },
    children,
  });

  return { runId, enqueued: sites.length };
}

// ---------------------------------------------------------------------------
// Auto-publish helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a site's staging should auto-publish to main after a scheduler run.
 * Conditions: site is Live AND at least one article was created successfully.
 */
export function shouldAutoPublish(
  result: SiteRunResult,
  siteStatus: string,
): boolean {
  if (siteStatus !== "live") return false;
  if (result.articlesCreated === 0) return false;
  if (result.status === "error") return false;
  return true;
}

/** File extensions whose bytes must be preserved as base64, never decoded
 *  as UTF-8. Decoding binary as text corrupts it (~1.8x inflation) — this is
 *  what mangled every site logo during auto-publish. Mirrors the dashboard's
 *  BINARY_EXTENSIONS in actions/wizard.ts. */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip",
]);

export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Image assets (logos, favicons, footer logos, article images) are
 *  R2-native — they live in R2 directly and must NEVER be committed to git.
 *  auto-publish skips them so it can't carry (or corrupt) image bytes. */
const IMAGE_ASSET_RE = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i;
export function isImageAsset(path: string): boolean {
  return IMAGE_ASSET_RE.test(path);
}

/**
 * Partition site files into text (UTF-8) and binary (base64) sets for commit,
 * reading each via the appropriate binary-safe primitive. Pure aside from the
 * injected readers, so it's unit-testable without a live Octokit.
 */
export async function collectFilesForPublish(
  filePaths: string[],
  readText: (path: string) => Promise<string>,
  readBinaryBase64: (path: string) => Promise<string>,
): Promise<{ files: BatchFileEntry[]; binaryFiles: BatchBinaryEntry[] }> {
  const files: BatchFileEntry[] = [];
  const binaryFiles: BatchBinaryEntry[] = [];
  for (const filePath of filePaths) {
    // Image assets are R2-native — never copy them into a git commit.
    if (isImageAsset(filePath)) continue;
    if (isBinaryPath(filePath)) {
      binaryFiles.push({ path: filePath, base64: await readBinaryBase64(filePath) });
    } else {
      files.push({ path: filePath, content: await readText(filePath) });
    }
  }
  return { files, binaryFiles };
}

/**
 * Copy sites/<domain>/ from staging branch to main, then reset staging branch.
 * This is the content-pipeline equivalent of the dashboard's publishStagingToProduction.
 */
export async function autoPublishSite(
  octokit: Octokit,
  repo: string,
  domain: string,
  stagingBranch: string,
): Promise<void> {
  const { owner, repo: repoName } = parseRepo(repo);

  // Force a fresh tree fetch — child jobs (content generation) may have committed
  // new articles to the staging branch. If the tree was cached earlier (e.g.,
  // during brief reading, or in a different worker process), the cached snapshot
  // would be stale and auto-publish would silently miss new articles, permanently
  // losing them when staging is force-reset below.
  clearTreeCache(stagingBranch);

  const siteDir = `sites/${domain}`;
  const filePaths = await listFilesRecursive(octokit, repo, siteDir, stagingBranch);

  if (filePaths.length === 0) {
    console.warn(`[auto-publish] No files found in ${siteDir} on ${stagingBranch}`);
    return;
  }

  // Binary assets (logos, favicons, images) MUST be read as base64 and
  // committed as base64 blobs — reading them as UTF-8 corrupts the bytes.
  const { files, binaryFiles } = await collectFilesForPublish(
    filePaths,
    (p) => readFile(octokit, repo, p, stagingBranch),
    (p) => readFileBase64(octokit, repo, p, stagingBranch),
  );
  const totalFiles = files.length + binaryFiles.length;

  await commitBatch(
    octokit,
    repo,
    files,
    binaryFiles,
    `scheduler: auto-publish ${domain} (${totalFiles} files)`,
    "main",
  );

  // Dual-write: copy article metadata to MongoDB under branch "main"
  const articleFiles = files.filter((f) => f.path.includes("/articles/"));
  if (articleFiles.length > 0) {
    const articleDocs = articleFiles.map((f) => {
      const slug = f.path.split("/articles/")[1]?.replace(/\.md$/, "") ?? "";
      const parsed = matter(f.content);
      return {
        domain,
        slug,
        branch: "main",
        frontmatter: {
          title: parsed.data.title,
          description: parsed.data.description,
          status: parsed.data.status,
          type: parsed.data.type,
          publish_date: parsed.data.publishDate ?? parsed.data.publish_date,
          author: parsed.data.author,
          tags: parsed.data.tags,
          featured_image: parsed.data.featuredImage ?? parsed.data.featured_image,
          quality_score: parsed.data.quality_score,
          videos: parsed.data.videos,
          scripts: parsed.data.scripts,
        },
      };
    });
    await upsertArticlesBatch(articleDocs);
    console.log(`[auto-publish] Dual-write: upserted ${articleDocs.length} article(s) to MongoDB (main) for ${domain}`);
  }

  // Reset staging branch to main HEAD.
  // Use force-update instead of delete+recreate — the atomic ref update avoids
  // a window where the branch doesn't exist, which races with n8n image
  // callbacks trying to read from the staging branch.
  const mainRef = await octokit.rest.git.getRef({ owner, repo: repoName, ref: "heads/main" });
  const mainSha = mainRef.data.object.sha;

  try {
    await octokit.rest.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${stagingBranch}`,
      sha: mainSha,
      force: true,
    });
  } catch {
    // Branch may not exist yet — create it
    await octokit.rest.git.createRef({
      owner,
      repo: repoName,
      ref: `refs/heads/${stagingBranch}`,
      sha: mainSha,
    });
  }

  // Dual-write: staging branch was reset — remove stale staging article docs
  await deleteArticlesForSiteBranch(domain, stagingBranch);

  clearTreeCache(stagingBranch);
  clearTreeCache("main");
  await invalidateDashboardCache(domain, stagingBranch);
  await invalidateDashboardCache(domain, "main");
  console.log(`[auto-publish] Published ${domain}: ${totalFiles} files → main, staging reset`);
}

// ---------------------------------------------------------------------------
// Parent processor — runs after all children complete
// ---------------------------------------------------------------------------

/**
 * Process the parent `scheduler-run` job.
 * Reads each child's returnvalue/failedReason, builds a SchedulerRunEntry,
 * and writes it to `scheduler/history.json` on GitHub — one commit total.
 */
export async function processSchedulerRun(
  job: Job<SchedulerRunData>,
  config: AgentConfig,
): Promise<void> {
  const { runId, timezone, forced, skipped } = job.data;

  // Collect child results — getChildrenValues() only returns COMPLETED children.
  // Children return BatchContentGenerationResult, mapped to SiteRunResult.
  const childrenValues = (await job.getChildrenValues()) as Record<
    string,
    BatchContentGenerationResult | null
  >;
  const sites: SiteRunResult[] = [];
  for (const [, genResult] of Object.entries(childrenValues)) {
    if (!genResult) continue;

    const created = genResult.results.filter((r) => r.status === "created").length;
    const genErrors = genResult.results.filter((r) => r.status === "error");
    let siteStatus: SiteRunResult["status"];
    let siteMessage: string | undefined;

    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      if (genResult.eligibleTopicCount === 0) {
        siteMessage = "No topics eligible to run today (check per-topic preferred_days)";
      } else {
        siteMessage = `Aggregator returned 0 items for ${genResult.eligibleTopicCount ?? "all"} eligible topic(s)`;
      }
    } else if (created === 0 && genErrors.length > 0) {
      siteStatus = "error";
      siteMessage = genErrors
        .map((e) => (e.message ?? e.reason ?? "unknown"))
        .join("; ");
    } else if (created === 0 && genErrors.length === 0) {
      siteStatus = "no_content";
      siteMessage = `All ${genResult.totalSourced} item(s) checked were duplicates`;
    } else if (created < genResult.requested && genErrors.length > 0) {
      siteStatus = "partial";
      siteMessage = `${genErrors.length} article(s) failed`;
    } else {
      siteStatus = "success";
    }

    sites.push({
      domain: genResult.siteDomain,
      status: siteStatus,
      articlesCreated: created,
      articlesRequested: genResult.requested,
      message: siteMessage,
    });
  }

  // Also record FAILED children — getChildrenValues() only returns completed
  // children. We know which domains were enqueued from enqueuedDomains in the
  // parent's data. Any domain not in the completed set permanently failed.
  const { enqueuedDomains } = job.data;
  const completedDomains = new Set(sites.map((s) => s.domain));
  for (const entry of enqueuedDomains) {
    if (!completedDomains.has(entry.domain)) {
      sites.push({
        domain: entry.domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: entry.count,
        message: "Child job failed (all retries exhausted)",
      });
    }
  }

  // Build history entry
  const entry = {
    timestamp: new Date().toISOString(),
    timezone,
    forced,
    sites,
    skipped,
  };

  // Write to GitHub — clear main tree cache first so we read the latest
  // history.json, not a stale version cached during brief reading or an
  // earlier auto-publish in this same run.
  const octokit = createOctokit(config.github);
  clearTreeCache("main");
  let history: unknown[] = [];
  try {
    const raw = await readFile(octokit, config.networkRepo, HISTORY_PATH);
    history = JSON.parse(raw) as unknown[];
  } catch {
    // First run or missing file — start fresh
  }

  history.unshift(entry);
  const trimmed = history.slice(0, MAX_ENTRIES);

  await commitFile(octokit, config.networkRepo, {
    path: HISTORY_PATH,
    content: JSON.stringify(trimmed, null, 2),
    message: `scheduler: update run history (${runId})`,
    branch: "main",
  });

  console.log(
    `[scheduler-run] History written: ${sites.length} site(s), ${skipped.length} skipped`,
  );

  // Fetch all active sites (used by weekly summary + auto-publish)
  const activeSites = await listActiveSites(octokit, config.networkRepo);

  // Update weekly summary in MongoDB
  await updateWeeklySummary({
    allSiteDomains: activeSites.map((s) => s.domain),
    siteResults: sites.map((s) => ({
      domain: s.domain,
      articlesRequested: s.articlesRequested,
      articlesCreated: s.articlesCreated,
    })),
    skipped,
    timezone,
  });

  // Auto-publish: merge staging → main for Live sites with new articles
  const siteStatusMap = new Map(activeSites.map((s) => [s.domain, s.status]));
  const siteBranchMap = new Map(activeSites.map((s) => [s.domain, s.branch]));

  const autoPublished: string[] = [];
  for (const siteResult of sites) {
    const status = siteStatusMap.get(siteResult.domain) ?? "";
    if (!shouldAutoPublish(siteResult, status)) continue;

    const branch = siteBranchMap.get(siteResult.domain);
    if (!branch) continue;

    try {
      await autoPublishSite(octokit, config.networkRepo, siteResult.domain, branch);
      autoPublished.push(siteResult.domain);
    } catch (pubErr) {
      const msg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      console.error(`[auto-publish] Failed for ${siteResult.domain}: ${msg}`);
    }
  }

  if (autoPublished.length > 0) {
    console.log(`[scheduler-run] Auto-published ${autoPublished.length} site(s): ${autoPublished.join(", ")}`);
  }

  // Invalidate dashboard caches for sites that had new content (non-published
  // sites — autoPublishSite already invalidates for published ones)
  const autoPublishedSet = new Set(autoPublished);
  for (const siteResult of sites) {
    if (siteResult.articlesCreated > 0 && !autoPublishedSet.has(siteResult.domain)) {
      const branch = siteBranchMap.get(siteResult.domain);
      if (branch) void invalidateDashboardCache(siteResult.domain, branch);
    }
  }

  // Notify if any sites errored or produced zero articles
  const errorSites = sites
    .filter((s) => s.status === "error")
    .map((s) => ({ domain: s.domain, error: s.message ?? "unknown" }));
  const zeroArticleSites = sites
    .filter((s) => s.status !== "error" && s.articlesCreated === 0)
    .map((s) => s.domain);

  void notifySummary(config.notifications, {
    runId,
    triggered: sites.length,
    errors: errorSites,
    zeroArticleSites,
  });
}

// ---------------------------------------------------------------------------
// Worker + Flow setup
// ---------------------------------------------------------------------------

export interface SchedulerFlowInstances {
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
}

export function setupSchedulerFlow(
  connection: Redis,
  config: AgentConfig,
): SchedulerFlowInstances {
  const flowProducer = new FlowProducer({ connection });
  flowProducer.on("error", (err) => {
    console.error(`[flow-producer] Connection error: ${err.message}`);
  });

  const schedulerRunWorker = new Worker<SchedulerRunData>(
    SCHEDULER_RUN_QUEUE,
    async (job) => processSchedulerRun(job, config),
    { connection },
  );

  schedulerRunWorker.on("error", (err) => {
    console.error(`[scheduler-run] Worker connection error: ${err.message}`);
  });

  schedulerRunWorker.on("failed", (job, err) => {
    console.error(
      `[scheduler-run] Parent job ${job?.id} failed: ${err.message}`,
    );
    void notifyError(config.notifications, {
      agent: "scheduler-run",
      error: `Run ${job?.data?.runId ?? job?.id} failed: ${err.message}`,
    });
  });

  schedulerRunWorker.on("completed", (job) => {
    console.log(`[scheduler-run] Run ${job.data.runId} completed`);
  });

  return { flowProducer, schedulerRunWorker };
}
