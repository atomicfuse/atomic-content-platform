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
import { handleMigrationRequest, handleCreateSites } from "../migration/handler.js";
import { handleImageCallback } from "./n8n-image.js";
import type { N8nCallbackPayload } from "./n8n-image.js";

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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

      const allJobs: Array<Record<string, unknown>> = [];

      for (const status of statuses) {
        const jobs = await queueInstances.generateQueue.getJobs(
          [status],
          0,
          limit - 1,
        );
        for (const job of jobs) {
          // Extract summary from returnvalue without sending the full results array
          const rv = job.returnvalue as
            | {
                results?: Array<{ status: string; reason?: string; message?: string }>;
                requested?: number;
                totalSourced?: number;
                duplicateCount?: number;
              }
            | undefined;
          const results = rv?.results ?? [];
          const created = results.filter((r) => r.status === "created").length;
          const errored = results.filter((r) => r.status === "error").length;
          // Collect error reasons from individual article results
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

          allJobs.push({
            id: job.id,
            status,
            domain: data?.siteDomain ?? "unknown",
            triggeredBy: data?.triggeredBy ?? "unknown",
            branch: data?.branch,
            count: data?.count,
            articlesCreated: created,
            articlesErrored: errored,
            totalResults: results.length,
            requested: rv?.requested,
            totalSourced: rv?.totalSourced,
            duplicateCount: rv?.duplicateCount,
            failedReason: job.failedReason ?? undefined,
            errorReasons: errorReasons.length > 0 ? errorReasons : undefined,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
          });
        }
      }

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
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    await new Promise<void>((resolve) => req.on("end", resolve));

    let payload: N8nCallbackPayload;
    try {
      payload = JSON.parse(body) as N8nCallbackPayload;
    } catch {
      sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
      return;
    }

    try {
      const result = await handleImageCallback(payload, config.github);
      if (result.ok) {
        sendJson(res, 200, { status: "ok", message: result.message });
      } else {
        console.error(`[server] Image callback failed: ${result.message}`);
        sendJson(res, 422, { status: "error", message: result.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] Image callback error: ${message}`);
      sendJson(res, 500, { status: "error", message });
    }
    return;
  }

  // WordPress migration — SSE endpoint
  if (req.method === "POST" && req.url === "/wp-migrate") {
    await handleMigrationRequest(req, res);
    return;
  }

  // WordPress migration — create sites from CSV
  if (req.method === "POST" && req.url === "/wp-migrate/create-sites") {
    await handleCreateSites(req, res);
    return;
  }

  if (req.method !== "POST" || req.url !== "/content-generate") {
    sendJson(res, 404, { status: "error", message: "Not found. Use POST /content-generate" });
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let payload: { siteDomain?: unknown; branch?: unknown; count?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
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
