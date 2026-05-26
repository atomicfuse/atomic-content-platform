import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { createOctokit } from "../lib/github.js";
import { IMPORT_ARTICLES_QUEUE } from "./types.js";
import type { ImportArticlesJobData, ImportArticlesResult } from "./types.js";
import { runMigration } from "../agents/migration/orchestrator.js";
import type { MigrationConfig } from "../agents/migration/orchestrator.js";
import type { CsvSiteRow, MigrationProgress } from "../agents/migration/types.js";
import { writeArticleImportProgress } from "../agents/migration/import-status.js";

export async function processImportArticlesJob(
  job: Job<ImportArticlesJobData>,
  redisConnection: Redis,
): Promise<ImportArticlesResult> {
  const {
    jobId,
    siteDomain,
    wpApiUrl,
    branch,
    alsoCommitTo,
    menuItems,
    websiteCategory,
  } = job.data;

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  if (!githubToken || !anthropicApiKey || !geminiApiKey) {
    const missing = [
      !githubToken && "GITHUB_TOKEN",
      !anthropicApiKey && "ANTHROPIC_API_KEY",
      !geminiApiKey && "GEMINI_API_KEY",
    ].filter(Boolean).join(", ");
    throw new Error(`Missing env vars: ${missing}`);
  }

  const site: CsvSiteRow = {
    name: siteDomain,
    domain: siteDomain,
    company: "",
    websiteCategory: websiteCategory ?? "General",
    menuItems: menuItems ?? [],
    iabCategories: [],
    subCategories: [],
    colorPalette: {},
    logoUrl: "",
    faviconUrl: "",
    postsApiUrl: wpApiUrl,
    gaInfo: {},
  };

  const octokit = createOctokit(githubToken);

  const config: MigrationConfig = {
    anthropicApiKey,
    geminiApiKey,
    octokit,
    networkRepo,
    branch,
    alsoCommitTo,
    n8nImageWebhookUrl: process.env.N8N_IMAGE_WEBHOOK_URL,
    imageCallbackUrl: process.env.IMAGE_CALLBACK_URL,
  };

  // Release the dedup lock helper
  const releaseLock = async (): Promise<void> => {
    try {
      await redisConnection.del(`article-import-active:${siteDomain}`);
    } catch { /* best-effort */ }
  };

  // Track last known progress so the error handler can preserve partial progress
  let lastKnownCounts = { totalArticles: 0, processedArticles: 0, successfulArticles: 0, failedArticles: 0 };

  const onProgress = async (progress: MigrationProgress): Promise<void> => {
    lastKnownCounts = {
      totalArticles: progress.totalArticles,
      processedArticles: progress.processedArticles,
      successfulArticles: progress.successfulArticles,
      failedArticles: progress.failedArticles,
    };
    await writeArticleImportProgress(redisConnection, jobId, {
      jobId,
      site: progress.site,
      status: "running",
      phase: progress.phase,
      totalArticles: progress.totalArticles,
      processedArticles: progress.processedArticles,
      successfulArticles: progress.successfulArticles,
      failedArticles: progress.failedArticles,
      currentArticleSlug: progress.currentArticleSlug,
      startedAt: new Date(progress.startedAt).toISOString(),
    });
  };

  try {
    console.log(`[import-articles] Starting article import for ${siteDomain} → ${branch}`);

    const report = await runMigration(site, config, (p) => {
      void onProgress(p).catch((err) => {
        console.warn(`[import-articles] Progress write failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    // Write final "complete" status
    await writeArticleImportProgress(redisConnection, jobId, {
      jobId,
      site: siteDomain,
      status: "complete",
      phase: "complete",
      totalArticles: report.totalArticles,
      processedArticles: report.totalArticles,
      successfulArticles: report.successful,
      failedArticles: report.failed,
      completedAt: new Date().toISOString(),
    });

    await releaseLock();

    console.log(`[import-articles] Done: ${report.successful}/${report.totalArticles} articles for ${siteDomain}`);

    return {
      jobId,
      site: siteDomain,
      totalArticles: report.totalArticles,
      successful: report.successful,
      failed: report.failed,
      durationMs: report.durationMs,
      n8nImagesTriggered: report.n8nImagesTriggered,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await writeArticleImportProgress(redisConnection, jobId, {
      jobId,
      site: siteDomain,
      status: "failed",
      error: message,
      ...lastKnownCounts,
    });

    await releaseLock();

    console.error(`[import-articles] Failed for ${siteDomain}: ${message}`);
    throw err;
  }
}

export function createImportArticlesQueue(
  connection: Redis,
): Queue<ImportArticlesJobData, ImportArticlesResult> {
  return new Queue(IMPORT_ARTICLES_QUEUE, { connection });
}

export function createImportArticlesWorker(
  connection: Redis,
  concurrency: number,
): Worker<ImportArticlesJobData, ImportArticlesResult> {
  return new Worker(
    IMPORT_ARTICLES_QUEUE,
    async (job) => processImportArticlesJob(job, connection),
    { connection, concurrency },
  );
}
