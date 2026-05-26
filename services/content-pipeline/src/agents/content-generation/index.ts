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
import { runScheduledPublish } from "../scheduled-publisher/index.js";
import { startWorkers } from "../../queue/index.js";
import type { QueueInstances } from "../../queue/index.js";
import { handleMigrationRequest, handleCreateSites, handleImportStatus } from "../migration/handler.js";
import { handleImageCallback, triggerN8nImage } from "./n8n-image.js";
import type { N8nCallbackPayload } from "./n8n-image.js";
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
    try {
      const result = await runScheduledPublish(config, force, queueInstances);
      sendJson(res, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
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

      // Try to get vertical from site brief
      const briefData = await readSiteBrief(octokit, config.github.repo, siteDomain, branch);
      vertical = briefData?.brief?.vertical ?? "";
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

  let payload: { siteDomain?: unknown; branch?: unknown; count?: unknown };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  // Validate
  const { siteDomain, branch, count } = payload;
  if (!siteDomain || typeof siteDomain !== "string") {
    sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
    return;
  }

  const branchStr = typeof branch === "string" ? branch : undefined;
  const countNum = typeof count === "number" && count > 0 ? Math.min(count, 50) : undefined;

  console.log(
    `[server] POST /content-generate — site: ${siteDomain}` +
    `${countNum ? `, count: ${countNum}` : ""}` +
    `${branchStr ? `, branch: ${branchStr}` : ""}`,
  );

  try {
    const result = await runContentGeneration(
      { siteDomain, branch: branchStr, count: countNum },
      config,
    );

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
