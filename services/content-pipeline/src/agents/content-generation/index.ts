/**
 * Content Generation Agent — HTTP Server
 *
 * Listens for POST /content-generate requests and runs the content generation agent.
 * The agent autonomously queries the Content Aggregator API using the site's brief
 * to source and rewrite articles.
 *
 * Usage:
 *   pnpm agent:content-generation
 *
 * Then POST to http://localhost:8080/content-generate:
 *   { "siteDomain": "coolnews.dev" }
 *   { "siteDomain": "coolnews.dev", "count": 5 }
 */

import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Resolve .env relative to the service root (2 dirs up from src/agents/content-generation/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: true });
import { loadConfig } from "../../lib/config.js";
import { runContentGeneration } from "./agent.js";
import { recordGeneration } from "../../stats/recorder.js";
import { buildScheduleFromBrief } from "../../stats/schedule.js";
import { runScheduledPublish } from "../scheduled-publisher/index.js";
import { startWorkers } from "../../queue/index.js";
import type { QueueInstances } from "../../queue/index.js";
import {
  handleMigrationRequest,
  handleCreateSites,
  handleImportStatus,
  handleEnqueueArticleImport,
  handleArticleImportStatus,
  handleActiveImport,
} from "../migration/handler.js";
import { handleImageCallback, triggerN8nImage } from "./n8n-image.js";
import type { N8nCallbackPayload } from "./n8n-image.js";
import { parseSiteStatsPath } from "../../stats/route-path.js";
import { getSiteStats, getAllSiteStats } from "../../stats/repo.js";
import { ensureStatsIndexes, ensureCostIndexes, getMongoDb } from "../../lib/mongo.js";
import { COLLECTIONS } from "../../stats/types.js";
import { getSiteCosts, getAllSiteCosts } from "../../costs/repo.js";
import {
  type BulkImageRequest,
  scanArticlesForGeneralImages,
  startBulkImageGeneration,
  buildResponse,
  getBulkJobStatus,
  SiteNotFoundError,
} from "./bulk-image.js";
import { randomUUID } from "node:crypto";
import matter from "gray-matter";
import { createOctokit, readFile } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { getAtlChecks, getAllAtlChecks } from "../../checks/repo.js";
import { runAlerts, runAfterRun } from "../../alerts/run.js";
import { getAttention, getAllAttention } from "../../alerts/repo.js";
import { getR2Usage, incrementR2Tally } from "../../stats/r2-tally.js";

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Read the full request body as a string, with an optional size limit (bytes). */
function readBody(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error(`Body exceeds ${maxBytes} bytes`));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleProposeFilter(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { status: "error", message: "Method not allowed" });
    return;
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 413, { status: "error", message: "Payload too large" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  const p = payload as Record<string, unknown>;
  if (typeof p.siteTheme !== "string" || typeof p.topicName !== "string") {
    sendJson(res, 400, { status: "error", message: "siteTheme and topicName are required strings" });
    return;
  }

  const apiKey = config.anthropicApiKey;
  if (!apiKey) {
    sendJson(res, 500, { status: "error", message: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  try {
    const { proposeFilter } = await import("./propose-filter.js");
    const result = await proposeFilter(
      {
        siteTheme: p.siteTheme,
        topicName: p.topicName,
        topicDescription: typeof p.topicDescription === "string" ? p.topicDescription : undefined,
        categories: Array.isArray(p.categories) ? (p.categories as Parameters<typeof proposeFilter>[0]["categories"]) : [],
        tags: Array.isArray(p.tags) ? (p.tags as Parameters<typeof proposeFilter>[0]["tags"]) : [],
      },
      apiKey,
    );
    sendJson(res, 200, result as unknown as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[propose-filter] Error:", message);
    sendJson(res, 502, { status: "error", message });
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  // Health check — required by CloudGrid
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // Scheduled publish — called by CloudGrid cron job
  if (req.url && req.url.startsWith("/scheduled-publish")) {
    const parsed = new URL(req.url, "http://localhost");
    const force = parsed.searchParams.get("force") === "true";
    console.log(`[server] Scheduled publish triggered${force ? " (forced)" : ""}`);

    const { resetApiStats, formatApiStats } = await import("../../lib/github-stats.js");
    resetApiStats();

    try {
      const result = await runScheduledPublish(config, force, queueInstances);
      const stats = resetApiStats();
      console.log(formatApiStats(stats));
      sendJson(res, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      const stats = resetApiStats();
      console.log(formatApiStats(stats));
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] Scheduled publish error:", message);
      sendJson(res, 500, { status: "error", message });
    }
    return;
  }

  // Active scheduler run — query BullMQ for in-progress state
  if (req.method === "GET" && req.url === "/scheduler/active-run") {
    if (!queueInstances) {
      sendJson(res, 200, { status: "none", message: "Queue not configured" });
      return;
    }
    try {
      const schedulerRunQueue = queueInstances.schedulerRunQueue;
      const active = await schedulerRunQueue.getActive();
      const waiting = await schedulerRunQueue.getWaiting();

      if (active.length === 0 && waiting.length === 0) {
        sendJson(res, 200, { status: "none" });
        return;
      }

      const current = active[0] ?? waiting[0];
      const generateQueue = queueInstances.generateQueue;
      const children = await generateQueue.getActive();
      const completedChildren = await generateQueue.getCompleted(0, 100);
      const failedChildren = await generateQueue.getFailed(0, 100);

      sendJson(res, 200, {
        status: "active",
        runId: current?.data?.runId,
        total: children.length + completedChildren.length + failedChildren.length,
        active: children.length,
        completed: completedChildren.length,
        failed: failedChildren.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { status: "error", message });
    }
    return;
  }

  // Job listing — query BullMQ for recent jobs
  if (req.method === "GET" && req.url && req.url.startsWith("/jobs")) {
    if (!queueInstances) {
      sendJson(res, 200, { jobs: [], error: "Queue not configured — REDIS_URL not set", unavailable: true });
      return;
    }
    try {
      const parsed = new URL(req.url, "http://localhost");
      const statusParam = parsed.searchParams.get("status") ?? "completed,failed,active";
      const VALID_STATUSES = new Set(["completed", "failed", "active", "waiting", "delayed"]);
      const statuses = statusParam
        .split(",")
        .filter((s): s is "completed" | "failed" | "active" | "waiting" | "delayed" =>
          VALID_STATUSES.has(s),
        );
      const limit = Math.min(
        parseInt(parsed.searchParams.get("limit") ?? "50", 10),
        200,
      );

      // --- Pass 1: collect all BullMQ jobs and extract metadata ---
      interface JobSummary {
        id: string | undefined;
        type: "generate" | "import";
        status: string;
        domain: string;
        triggeredBy: string;
        branch?: string;
        count?: number;
        articlesCreated: number;
        articlesErrored: number;
        totalResults: number;
        requested?: number;
        totalSourced?: number;
        duplicateCount?: number;
        n8nImagesTriggered: number;
        failedReason?: string;
        errorReasons?: string[];
        attemptsMade: number;
        timestamp: number;
        processedOn?: number;
        finishedOn?: number;
      }

      const jobSummaries: JobSummary[] = [];

      for (const status of statuses) {
        const jobs = await queueInstances.generateQueue.getJobs(
          [status],
          0,
          limit - 1,
        );
        for (const job of jobs) {
          const rv = job.returnvalue as
            | {
                results?: Array<{ status: string; reason?: string; message?: string }>;
                requested?: number;
                totalSourced?: number;
                duplicateCount?: number;
                n8nImagesTriggered?: number;
              }
            | undefined;
          const results = rv?.results ?? [];
          const errorReasons = results
            .filter((r) => r.status === "error")
            .map((r) => r.message ?? r.reason ?? "unknown")
            .slice(0, 5);

          const data = job.data as {
            siteDomain?: string;
            triggeredBy?: string;
            branch?: string;
            count?: number;
          } | undefined;

          jobSummaries.push({
            id: job.id,
            type: "generate",
            status,
            domain: data?.siteDomain ?? "unknown",
            triggeredBy: data?.triggeredBy ?? "unknown",
            branch: data?.branch,
            count: data?.count,
            articlesCreated: results.filter((r) => r.status === "created").length,
            articlesErrored: results.filter((r) => r.status === "error").length,
            totalResults: results.length,
            requested: rv?.requested,
            totalSourced: rv?.totalSourced,
            duplicateCount: rv?.duplicateCount,
            n8nImagesTriggered: rv?.n8nImagesTriggered ?? 0,
            failedReason: job.failedReason ?? undefined,
            errorReasons: errorReasons.length > 0 ? errorReasons : undefined,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
          });
        }
      }

      // Also query importArticlesQueue for WP article import jobs
      for (const status of statuses) {
        const importJobs = await queueInstances.importArticlesQueue.getJobs(
          [status],
          0,
          limit - 1,
        );
        for (const job of importJobs) {
          const data = job.data as {
            siteDomain?: string;
            branch?: string;
          } | undefined;
          const rv = job.returnvalue as {
            totalArticles?: number;
            successful?: number;
            failed?: number;
            n8nImagesTriggered?: number;
          } | undefined;

          jobSummaries.push({
            id: job.id,
            type: "import",
            status,
            domain: data?.siteDomain ?? "unknown",
            triggeredBy: "wp-import",
            branch: data?.branch,
            articlesCreated: rv?.successful ?? 0,
            articlesErrored: rv?.failed ?? 0,
            totalResults: rv?.totalArticles ?? 0,
            n8nImagesTriggered: rv?.n8nImagesTriggered ?? 0,
            failedReason: job.failedReason ?? undefined,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
          });
        }
      }

      // --- Pass 2: batch-fetch image completion counts from Redis (single MGET) ---
      const imageJobIds = jobSummaries
        .filter((j) => j.n8nImagesTriggered > 0 && j.id)
        .map((j) => j.id!);
      const imageKeys = imageJobIds.map((id) => `img-done:${id}`);
      const imageCounts = imageKeys.length > 0
        ? await queueInstances.connection.mget(...imageKeys)
        : [];
      // Build a lookup: jobId → completed count
      const imageCompletedMap = new Map<string, number>();
      for (let i = 0; i < imageJobIds.length; i++) {
        const jobId = imageJobIds[i]!;     // safe — iterating within bounds
        const count = imageCounts[i] ?? "0";
        imageCompletedMap.set(jobId, parseInt(count, 10));
      }

      // --- Pass 3: build response, merging image counts ---
      const allJobs: Array<Record<string, unknown>> = jobSummaries.map((j) => {
        const hasImages = j.n8nImagesTriggered > 0;
        return {
          ...j,
          n8nImagesTriggered: hasImages ? j.n8nImagesTriggered : undefined,
          n8nImagesCompleted: hasImages ? (imageCompletedMap.get(j.id!) ?? 0) : undefined,
        };
      });

      // Sort by timestamp descending (most recent first)
      allJobs.sort(
        (a, b) => ((b.timestamp as number) ?? 0) - ((a.timestamp as number) ?? 0),
      );

      sendJson(res, 200, { jobs: allJobs.slice(0, limit) } as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { jobs: [], error: message });
    }
    return;
  }

  // Job status — query BullMQ
  if (req.method === "GET" && req.url && req.url.startsWith("/job/")) {
    const jobId = req.url.slice(5);  // "/job/<id>" → "<id>"
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured" });
      return;
    }
    const job = await queueInstances.generateQueue.getJob(jobId);
    if (!job) {
      sendJson(res, 404, { status: "error", message: "Job not found" });
      return;
    }
    const state = await job.getState();
    if (state === "completed") {
      sendJson(res, 200, { status: "completed", result: job.returnvalue as unknown as Record<string, unknown> });
    } else if (state === "failed") {
      sendJson(res, 200, { status: "failed", error: job.failedReason, attempts: job.attemptsMade });
    } else {
      sendJson(res, 200, { status: state, attempts: job.attemptsMade });
    }
    return;
  }

  // n8n image callback — receives generated images asynchronously
  if (req.method === "POST" && req.url === "/image-callback") {
    // Verify shared secret if configured (prevents unauthorized image injection)
    const expectedSecret = process.env.N8N_CALLBACK_SECRET;
    if (expectedSecret) {
      const provided = req.headers["x-callback-secret"];
      if (provided !== expectedSecret) {
        sendJson(res, 401, { status: "error", message: "Invalid callback secret" });
        return;
      }
    }

    // 50 MB limit — images are base64-encoded (~33% overhead)
    let body: string;
    try {
      body = await readBody(req, 50 * 1024 * 1024);
    } catch {
      sendJson(res, 413, { status: "error", message: "Payload too large" });
      return;
    }

    let payload: N8nCallbackPayload;
    try {
      payload = JSON.parse(body) as N8nCallbackPayload;
    } catch {
      sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
      return;
    }

    const cbTag = `[server] [image-callback] [${payload.site_domain ?? "?"}/${payload.slug ?? "?"}]`;
    try {
      const result = await handleImageCallback(payload, config.github, config.notifications);
      if (result.ok) {
        // Track image completion in Redis (keyed by BullMQ job ID).
        // Empty job_id means this was a direct invocation (not via BullMQ) — skip tracking.
        if (payload.job_id && queueInstances) {
          const key = `img-done:${payload.job_id}`;
          const newCount = await queueInstances.connection.incr(key);
          // Set TTL only on the first increment to avoid resetting expiry on each callback
          if (newCount === 1) {
            await queueInstances.connection.expire(key, 7 * 24 * 60 * 60);
          }
        }
        console.log(`${cbTag} → 200 OK`);
        sendJson(res, 200, { status: "ok", message: result.message });
      } else {
        console.error(`${cbTag} → 422 FAIL: ${result.message}`);
        sendJson(res, 422, { status: "error", message: result.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${cbTag} → 500 ERROR: ${message}`);
      sendJson(res, 500, { status: "error", message });
    }
    return;
  }

  // Trigger image generation for an existing article
  if (req.method === "POST" && req.url === "/trigger-image") {
    const webhookUrl = config.n8nImageWebhookUrl;
    if (!webhookUrl) {
      sendJson(res, 503, { status: "error", message: "N8N_IMAGE_WEBHOOK_URL not configured" });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { status: "error", message: "Payload too large" });
      return;
    }

    let payload: { siteDomain?: string; slug?: string; articleTitle?: string; branch?: string };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
      return;
    }

    const { siteDomain, slug, articleTitle, branch } = payload;
    if (!siteDomain || !slug || !articleTitle || !branch) {
      sendJson(res, 400, { status: "error", message: "siteDomain, slug, articleTitle, branch required" });
      return;
    }

    // Read article from Git to get description/summary for the image prompt
    let description = articleTitle;
    let summary = articleTitle;
    let vertical = "";
    try {
      const octokit = createOctokit(config.github);
      const articlePath = `sites/${siteDomain}/articles/${slug}.md`;
      const content = await readFile(octokit, config.github.repo, articlePath, branch);
      const parsed = matter(content);
      description = (parsed.data.description as string) ?? articleTitle;
      summary = parsed.content.slice(0, 500);

      // Style cue for image generation. Prefer the article's primary topic
      // (per-topic sites carry `topics: string[]` in frontmatter); fall back
      // to the site brief's vertical for legacy articles.
      const articleTopics = parsed.data.topics;
      if (Array.isArray(articleTopics) && articleTopics.length > 0 && typeof articleTopics[0] === "string") {
        vertical = articleTopics[0];
      } else {
        const briefData = await readSiteBrief(octokit, config.github.repo, siteDomain, branch);
        vertical = briefData?.brief?.vertical ?? "";
      }
    } catch {
      // Use defaults if article or brief can't be read
    }

    const callbackUrl = config.imageCallbackUrl ?? "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

    const accepted = await triggerN8nImage(webhookUrl, {
      request_id: randomUUID(),
      callback_url: callbackUrl,
      job_id: "",
      site_domain: siteDomain,
      slug,
      branch,
      article: {
        title: articleTitle,
        description,
        summary,
        vertical,
        source_thumbnail_url: null,
        image_guidelines: null,
      },
    });

    if (accepted) {
      sendJson(res, 200, { status: "ok", message: `Image generation triggered for ${slug}` });
    } else {
      sendJson(res, 502, { status: "error", message: "n8n webhook trigger failed" });
    }
    return;
  }

  // WordPress migration — SSE endpoint
  if (req.method === "POST" && req.url === "/wp-migrate") {
    await handleMigrationRequest(req, res);
    return;
  }

  // WordPress migration — create sites from CSV (batch enqueue)
  if (req.method === "POST" && req.url === "/wp-migrate/create-sites") {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleCreateSites(req, res, queueInstances.flowProducer, queueInstances.connection);
    return;
  }

  // WordPress migration — poll import status
  if (req.method === "GET" && req.url?.startsWith("/wp-migrate/import-status/")) {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleImportStatus(req, res, queueInstances.connection);
    return;
  }

  // WordPress migration — enqueue article import (background)
  if (req.method === "POST" && req.url === "/wp-migrate/import-articles") {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleEnqueueArticleImport(req, res, queueInstances.importArticlesQueue, queueInstances.connection);
    return;
  }

  // WordPress migration — poll article import status
  if (req.method === "GET" && req.url?.startsWith("/wp-migrate/article-import-status/")) {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleArticleImportStatus(req, res, queueInstances.connection);
    return;
  }

  // WordPress migration — check active import for a domain (cross-user awareness)
  if (req.method === "GET" && req.url?.startsWith("/wp-migrate/active-import/")) {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleActiveImport(req, res, queueInstances.connection);
    return;
  }

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

  // Site stats — GET /site-stats (all) or GET /site-stats/:domain (one)
  //
  // Enriches sites with null schedule from site briefs (handles both per-topic
  // and legacy schedule models). This ensures the API always returns schedule
  // data when the brief has it, even if MongoDB lacks a snapshot.
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET") {
      const ss = parseSiteStatsPath(pathname);
      if (ss) {
        try {
          const enrichSchedule = async (
            site: Awaited<ReturnType<typeof getSiteStats>>,
          ): Promise<Awaited<ReturnType<typeof getSiteStats>>> => {
            if (site.schedule) return site;
            try {
              const octokit = createOctokit(config.github);
              const branch = `staging/${site.siteDomain}`;
              const briefData = await readSiteBrief(
                octokit, config.github.repo, site.siteDomain, branch,
              );
              const schedule = buildScheduleFromBrief(briefData.brief);
              if (schedule) {
                return {
                  ...site,
                  schedule,
                  thisWeek: { ...site.thisWeek, expected: schedule.weeklyTarget },
                };
              }
            } catch {
              // Brief read failed — return site as-is
            }
            return site;
          };

          if (ss.kind === "all") {
            const sites = await getAllSiteStats(new Date());
            const enriched = await Promise.all(sites.map(enrichSchedule));
            sendJson(res, 200, { status: "ok", sites: enriched });
          } else {
            const site = await getSiteStats(ss.domain, new Date());
            sendJson(res, 200, { status: "ok", site: await enrichSchedule(site) });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 503, { status: "error", message });
        }
        return;
      }
    }
  }

  // Site checks — GET /site-checks (all) or GET /site-checks/:domain (one)
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/site-checks") {
      try {
        sendJson(res, 200, { status: "ok", sites: await getAllAtlChecks(config) });
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/site-checks/")) {
      const domain = decodeURIComponent(pathname.slice("/site-checks/".length));
      try {
        sendJson(res, 200, { status: "ok", site: await getAtlChecks(domain) });
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // Site costs — GET /site-costs (all) or GET /site-costs/:domain (one)
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/site-costs") {
      try {
        sendJson(res, 200, { status: "ok", sites: await getAllSiteCosts(new Date()) } as Record<string, unknown>);
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/site-costs/")) {
      const domain = decodeURIComponent(pathname.slice("/site-costs/".length));
      try {
        sendJson(res, 200, { status: "ok", site: await getSiteCosts(domain, new Date()) } as Record<string, unknown>);
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // Run alerts — called by CloudGrid cron job. Always returns 200 (even on
  // error) so a failed run doesn't mark the cron itself as failed; the error
  // is logged for diagnosis.
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/run-alerts") {
      try {
        await runAlerts(new Date());
        sendJson(res, 200, { status: "ok" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[server] Run alerts error:", message);
        sendJson(res, 200, { status: "error", message });
      }
      return;
    }
  }

  // Attention — GET /attention (all sites) or GET /attention/:domain (one)
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/attention") {
      try {
        sendJson(res, 200, { status: "ok", sites: await getAllAttention(new Date()) } as Record<string, unknown>);
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/attention/")) {
      const domain = decodeURIComponent(pathname.slice("/attention/".length));
      try {
        sendJson(res, 200, { status: "ok", site: await getAttention(domain, new Date()) } as Record<string, unknown>);
      } catch (err) {
        sendJson(res, 503, { status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // GET /r2-usage
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/r2-usage") {
      try {
        const usage = await getR2Usage();
        return sendJson(res, 200, { status: "ok", ...usage });
      } catch (err) {
        return sendJson(res, 503, { status: "error", error: String(err) });
      }
    }
  }

  // POST /r2-tally-increment
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/r2-tally-increment") {
      try {
        const body = await readBody(req);
        const { bytes, count } = JSON.parse(body) as { bytes?: unknown; count?: unknown };
        await incrementR2Tally(Number(bytes) || 0, Number(count) || 0);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err) });
      }
    }
  }

  // POST /seed-kv — trigger KV re-seed via GitHub Actions workflow_dispatch
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/seed-kv") {
      try {
        const body = await readBody(req);
        const { domain } = JSON.parse(body) as { domain?: string };
        if (!domain) {
          return sendJson(res, 400, { ok: false, error: "Missing domain" });
        }
        // Trigger the sync-kv.yml workflow in the network repo via GitHub API
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return sendJson(res, 500, { ok: false, error: "GITHUB_TOKEN not configured" });
        }
        const owner = "atomicfuse";
        const repo = "atomic-labs-network";
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/sync-kv.yml/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref: "main",
              inputs: { site_id: domain, force_all: "false" },
            }),
          },
        );
        if (!resp.ok) {
          const errText = await resp.text();
          return sendJson(res, 502, { ok: false, error: `GitHub API ${resp.status}: ${errText}` });
        }
        return sendJson(res, 200, { ok: true, message: `Triggered sync-kv for ${domain}` });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err) });
      }
    }
  }

  // POST /backfill-history — one-time import of scheduler/history.json into MongoDB
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/backfill-history") {
      try {
        const octokit = createOctokit(config.github);
        const raw = await readFile(octokit, config.github.repo, "scheduler/history.json");
        const history = JSON.parse(raw) as Array<{
          timestamp: string;
          forced: boolean;
          sites: Array<{
            domain: string;
            status: string;
            articlesCreated: number;
            articlesRequested: number;
            message?: string;
          }>;
        }>;

        // Read all briefs for schedule data (from main)
        const briefCache = new Map<string, Awaited<ReturnType<typeof readSiteBrief>> | null>();
        const getBrief = async (domain: string): Promise<ReturnType<typeof readSiteBrief> | null> => {
          if (briefCache.has(domain)) return briefCache.get(domain)!;
          try {
            const b = await readSiteBrief(octokit, config.github.repo, domain);
            briefCache.set(domain, b);
            return b;
          } catch {
            briefCache.set(domain, null);
            return null;
          }
        };

        const db = await getMongoDb();
        let eventsInserted = 0;
        let rollupUpserted = 0;

        for (const run of history) {
          const finishedAt = new Date(run.timestamp);
          for (const site of run.sites) {
            // Derive status matching recorder.ts logic
            const created = site.articlesCreated;
            const failed = site.status === "error" ? (site.articlesRequested - created) : 0;
            let status: "success" | "partial" | "error" | "no_content";
            if (site.status === "success") status = "success";
            else if (site.status === "partial") status = "partial";
            else if (site.status === "error") status = "error";
            else status = "no_content";

            const event = {
              siteDomain: site.domain,
              source: "scheduler" as const,
              forced: run.forced,
              topicName: null,
              requested: site.articlesRequested,
              created,
              failed,
              status,
              message: site.message ?? null,
              startedAt: finishedAt,
              finishedAt,
            };

            // Insert event (skip if duplicate by domain+timestamp)
            try {
              await db.collection(COLLECTIONS.generationEvents).insertOne(event as any);
              eventsInserted++;
            } catch {
              // duplicate or write error — skip
            }

            // Resolve schedule from brief
            let schedule = null;
            try {
              const briefData = await getBrief(site.domain);
              if (briefData) schedule = buildScheduleFromBrief(briefData.brief);
            } catch { /* no brief */ }

            // Upsert rollup — use $max so the latest timestamp wins
            const setFields: Record<string, unknown> = {
              updatedAt: finishedAt,
            };
            if (schedule) setFields["schedule"] = schedule;

            await db.collection(COLLECTIONS.siteStats).updateOne(
              { _id: site.domain as any },
              {
                $max: { lastRunAt: finishedAt },
                $set: setFields,
                $inc: { totalCreated: created },
                $setOnInsert: {
                  lastAddedAt: created > 0 ? finishedAt : null,
                  lastAddedSource: created > 0 ? "scheduler" : null,
                  lastAddedCount: created > 0 ? created : null,
                  lastFailedAt: status === "error" ? finishedAt : null,
                },
              },
              { upsert: true },
            );
            rollupUpserted++;
          }
        }

        // Also seed schedule for sites NOT in history (from dashboard-index)
        const indexRaw = await readFile(octokit, config.github.repo, "dashboard-index.yaml");
        const { parse: parseYaml } = await import("yaml");
        const dashIndex = parseYaml(indexRaw) as { sites: Array<{ domain: string }> };
        let scheduleSeedCount = 0;

        for (const entry of dashIndex.sites) {
          // Skip if already has a rollup doc
          const exists = await db.collection(COLLECTIONS.siteStats).findOne(
            { _id: entry.domain as any },
            { projection: { _id: 1 } },
          );
          if (exists) continue;

          let schedule = null;
          try {
            const briefData = await getBrief(entry.domain);
            if (briefData) schedule = buildScheduleFromBrief(briefData.brief);
          } catch { /* no brief */ }

          if (schedule) {
            const now = new Date();
            await db.collection(COLLECTIONS.siteStats).insertOne({
              _id: entry.domain as any,
              lastRunAt: now,
              lastAddedAt: null,
              lastAddedSource: null,
              lastAddedCount: null,
              lastFailedAt: null,
              totalCreated: 0,
              schedule,
              updatedAt: now,
            } as any);
            scheduleSeedCount++;
          }
        }

        await ensureStatsIndexes();

        return sendJson(res, 200, {
          ok: true,
          eventsInserted,
          rollupUpserted,
          scheduleSeedCount,
          historyEntries: history.length,
        });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err) });
      }
    }
  }

  if (req.url === "/propose-filter") {
    await handleProposeFilter(req, res, config);
    return;
  }

  if (req.method !== "POST" || req.url !== "/content-generate") {
    sendJson(res, 404, { status: "error", message: "Not found. Use POST /content-generate" });
    return;
  }

  // Read request body (1 MB limit — this is a small JSON payload)
  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch {
    sendJson(res, 413, { status: "error", message: "Payload too large" });
    return;
  }

  let payload: {
    siteDomain?: unknown;
    branch?: unknown;
    count?: unknown;
    topicName?: unknown;
    bypassSchedule?: unknown;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  // Validate
  const { siteDomain, branch, count, topicName, bypassSchedule } = payload;
  if (!siteDomain || typeof siteDomain !== "string") {
    sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
    return;
  }

  const branchStr = typeof branch === "string" ? branch : undefined;
  const countNum = typeof count === "number" && count > 0 ? Math.min(count, 50) : undefined;
  const topicNameStr = typeof topicName === "string" && topicName.trim().length > 0
    ? topicName
    : undefined;
  const bypassScheduleBool = bypassSchedule === true;

  console.log(
    `[server] POST /content-generate — site: ${siteDomain}` +
    `${countNum ? `, count: ${countNum}` : ""}` +
    `${branchStr ? `, branch: ${branchStr}` : ""}` +
    `${topicNameStr ? `, topic: ${topicNameStr}` : ""}`,
  );

  try {
    const startedAt = new Date();
    const result = await runContentGeneration(
      {
        siteDomain,
        branch: branchStr,
        count: countNum,
        topicName: topicNameStr,
        bypassSchedule: bypassScheduleBool,
        source: "dashboard",
      },
      config,
    );
    const finishedAt = new Date();

    // Read the brief's schedule so MongoDB stays populated even for
    // dashboard-triggered generation (previously passed null).
    // Uses buildScheduleFromBrief which handles both per-topic (topics_v2)
    // and legacy (brief.schedule) models.
    let schedule: ReturnType<typeof buildScheduleFromBrief> = null;
    try {
      const octokit = createOctokit(config.github);
      const briefBranch = branchStr ?? `staging/${siteDomain}`;
      const briefData = await readSiteBrief(octokit, config.github.repo, siteDomain, briefBranch);
      schedule = buildScheduleFromBrief(briefData.brief);
    } catch {
      // Brief read failed — record with null schedule (non-fatal)
    }

    await recordGeneration(
      result,
      {
        source: "dashboard",
        forced: bypassScheduleBool,
        topicName: topicNameStr ?? null,
        startedAt,
        finishedAt,
      },
      schedule,
    );

    // Re-evaluate run-sensitive alert conditions for this site (fire-and-forget;
    // runAfterRun is failure-isolated and never alters generation behavior).
    void runAfterRun(siteDomain, new Date());

    const resultBody = result as unknown as Record<string, unknown>;
    const hasCreated = result.results.some((r) => r.status === "created");
    const allErrors = result.results.every((r) => r.status === "error");

    if (hasCreated) {
      sendJson(res, 201, resultBody);
    } else if (allErrors) {
      sendJson(res, 500, resultBody);
    } else {
      sendJson(res, 200, resultBody);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] Agent error:", message);
    sendJson(res, 502, { status: "error", message, results: [{ status: "error", message }] });
  }
}

// Load config at startup — fails fast if env is misconfigured
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error("[server] Configuration error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

let queueInstances: QueueInstances | undefined;
if (config.redisUrl) {
  try {
    queueInstances = startWorkers(config.redisUrl, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server] Failed to initialize queue workers: ${message}`);
    console.error("[server] Continuing in direct execution mode");
  }
} else {
  console.log("[server] REDIS_URL not set — queue workers disabled (direct execution mode)");
}

const server = http.createServer((req, res) => {
  handleRequest(req, res, config).catch((err) => {
    console.error("[server] Unhandled error:", err);
    sendJson(res, 502, { status: "error", message: "Internal server error", results: [{ status: "error", message: "Internal server error" }] });
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${config.port} is already in use`);
  } else {
    console.error("[server] Server error:", err.message);
  }
  process.exit(1);
});

server.listen(config.port, () => {
  console.log(`[server] Content generation agent running on http://localhost:${config.port}`);
  console.log(`[server] POST http://localhost:${config.port}/content-generate`);
  const effectiveAggregatorUrl = process.env.CONTENT_API_BASE_URL ?? config.contentAggregatorUrl;
  console.log(`[server] Aggregator: ${effectiveAggregatorUrl}`);
  console.log(`[server] Write mode: ${config.localNetworkPath ? `local (${config.localNetworkPath})` : "GitHub API"}`);
  ensureStatsIndexes().catch((e) => console.error(`[stats] ensureStatsIndexes failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`));
  ensureCostIndexes().catch((e) => console.error(`[costs] ensureCostIndexes failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`));
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  if (queueInstances) {
    await queueInstances.generateWorker.close();
    await queueInstances.generateQueueEvents.close();
    await queueInstances.generateQueue.close();
    await queueInstances.schedulerRunWorker.close();
    await queueInstances.schedulerRunQueue.close();
    await queueInstances.importSiteWorker.close();
    await queueInstances.importFinalizeWorker.close();
    await queueInstances.importSiteQueue.close();
    await queueInstances.importFinalizeQueue.close();
    await queueInstances.importArticlesWorker.close();
    await queueInstances.importArticlesQueue.close();
    await queueInstances.flowProducer.close();
    await queueInstances.connection.quit();
    console.log("[server] Queue workers closed");
  }
  server.close(() => {
    console.log("[server] HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
