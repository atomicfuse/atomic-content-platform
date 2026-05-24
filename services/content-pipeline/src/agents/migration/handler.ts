import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import type { FlowProducer } from "bullmq";
import type { Redis } from "ioredis";
import { runMigration } from "./orchestrator.js";
import type { MigrationConfig } from "./orchestrator.js";
import type { CsvSiteRow, MigrationProgress } from "./types.js";
import { validateBatch, submitBatch } from "./batch-import.js";
import { readBatchStatus } from "./import-status.js";

function sendSSE(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

interface MigrationRequestBody {
  siteDomain: string;
  wpApiUrl: string;
  branch?: string;
  menuItems?: string[];
  websiteCategory?: string;
}

/**
 * POST /wp-migrate
 *
 * Accepts `{ siteDomain, wpApiUrl, branch?, menuItems?, websiteCategory? }`.
 * Streams SSE progress events back to the caller.
 */
export async function handleMigrationRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => { rawBody += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let body: MigrationRequestBody;
  try {
    body = JSON.parse(rawBody) as MigrationRequestBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!body.siteDomain || !body.wpApiUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "siteDomain and wpApiUrl are required" }));
    return;
  }

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
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Missing env vars: ${missing}` }));
    return;
  }

  const branch = body.branch ?? `staging/${body.siteDomain}`;
  const alsoCommitTo = branch === "main" ? `staging/${body.siteDomain}` : undefined;

  const site: CsvSiteRow = {
    name: body.siteDomain,
    domain: body.siteDomain,
    company: "",
    websiteCategory: body.websiteCategory ?? "General",
    menuItems: body.menuItems ?? [],
    iabCategories: [],
    subCategories: [],
    colorPalette: {},
    logoUrl: "",
    faviconUrl: "",
    postsApiUrl: body.wpApiUrl,
    gaInfo: {},
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const octokit = new Octokit({ auth: githubToken });

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

  const onProgress = (progress: MigrationProgress): void => {
    sendSSE(res, { type: "progress", ...progress });
  };

  try {
    console.log(`[wp-migrate] Starting migration for ${site.name} → ${branch}`);
    const report = await runMigration(site, config, onProgress);
    sendSSE(res, { type: "complete", ...report });
    console.log(`[wp-migrate] Done: ${report.successful}/${report.totalArticles} articles`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-migrate] Failed for ${site.name}:`, message);
    sendSSE(res, { type: "error", error: message });
  }

  res.end();
}

// ---------------------------------------------------------------------------
// POST /wp-migrate/create-sites  (batch enqueue endpoint)
// ---------------------------------------------------------------------------

interface CreateSitesRequestBody {
  rows: Record<string, string>[];
}

/**
 * POST /wp-migrate/create-sites
 *
 * Validates CSV rows, enqueues a BullMQ import flow, returns batch ID.
 * No longer streams SSE — the frontend polls /wp-migrate/import-status/:batchId.
 */
export async function handleCreateSites(
  req: IncomingMessage,
  res: ServerResponse,
  flowProducer: FlowProducer,
  redis: Redis,
): Promise<void> {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => { rawBody += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let body: CreateSitesRequestBody;
  try {
    body = JSON.parse(rawBody) as CreateSitesRequestBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rows is required (non-empty array)" }));
    return;
  }

  // Validate
  const validation = validateBatch(body.rows);
  if (!validation.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validation.error }));
    return;
  }

  // Enqueue
  try {
    const result = await submitBatch(body.rows, flowProducer, redis);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ batchId: result.batchId, total: result.total }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[create-sites] Failed to enqueue batch:`, message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Failed to enqueue import: ${message}` }));
  }
}

// ---------------------------------------------------------------------------
// GET /wp-migrate/import-status/:batchId
// ---------------------------------------------------------------------------

/**
 * Returns current batch import status from Redis.
 */
export async function handleImportStatus(
  req: IncomingMessage,
  res: ServerResponse,
  redis: Redis,
): Promise<void> {
  // Extract batchId from URL: /wp-migrate/import-status/<batchId>
  const url = new URL(req.url ?? "", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  // Expected: ["wp-migrate", "import-status", "<batchId>"]
  const batchId = segments[2];

  if (!batchId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "batchId is required" }));
    return;
  }

  const status = await readBatchStatus(redis, batchId);
  if (!status) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Batch not found" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(status));
}
