# Background Article Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WP article import from SSE (tab-dependent) to BullMQ (background-resilient) so users can close their browser without losing import progress.

**Architecture:** Add a new `import-articles` BullMQ queue alongside the existing `import-site` queue. Each article import job runs `runMigration()` in the background. Progress is tracked in Redis (same pattern as site creation batches) and polled from the dashboard UI. Both `ImportPanel` and `CsvSiteCreator` use the new queue-based flow.

**Tech Stack:** BullMQ, Redis, ioredis, Next.js 15 App Router, React 19

---

## File Structure

### Content Pipeline (backend)

| File | Action | Responsibility |
|------|--------|----------------|
| `services/content-pipeline/src/queue/types.ts` | Modify | Add `ImportArticlesJobData`, `ImportArticlesResult`, queue name constant, job options |
| `services/content-pipeline/src/agents/migration/import-status.ts` | Modify | Add `writeArticleBatchMeta`, `writeArticleImportProgress`, `readArticleBatchStatus` for article import tracking |
| `services/content-pipeline/src/queue/import-articles.ts` | Create | BullMQ worker that calls `runMigration()` and writes progress to Redis |
| `services/content-pipeline/src/queue/index.ts` | Modify | Wire up new queue + worker in `startWorkers()` |
| `services/content-pipeline/src/agents/migration/handler.ts` | Modify | Add `handleEnqueueArticleImport` (enqueue endpoint) + reuse existing `handleImportStatus` pattern. Keep old SSE endpoint for backward compat but deprecate. |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Modify | Add route for `POST /wp-migrate/import-articles` and `GET /wp-migrate/article-import-status/:jobId` |

### Dashboard (frontend)

| File | Action | Responsibility |
|------|--------|----------------|
| `services/dashboard/src/app/api/agent/wp-migrate/import-articles/route.ts` | Create | Proxy POST to content-pipeline's `/wp-migrate/import-articles` |
| `services/dashboard/src/app/api/agent/wp-migrate/article-import-status/[jobId]/route.ts` | Create | Proxy GET to content-pipeline's `/wp-migrate/article-import-status/:jobId` |
| `services/dashboard/src/components/import/ImportPanel.tsx` | Modify | Replace SSE with enqueue + poll pattern |
| `services/dashboard/src/components/import/CsvSiteCreator.tsx` | Modify | Replace SSE `handleImportArticles` with enqueue + poll pattern |

---

## Task 1: Add Article Import Types to Queue Types

**Files:**
- Modify: `services/content-pipeline/src/queue/types.ts`

- [ ] **Step 1: Add article import types and constants**

Add after the existing `ImportBatchMeta` interface (line 79):

```typescript
// --- Import articles queue ---

export const IMPORT_ARTICLES_QUEUE = "import-articles";

/** Data for each article import job. */
export interface ImportArticlesJobData {
  /** Unique job ID for status polling. */
  jobId: string;
  siteDomain: string;
  wpApiUrl: string;
  branch: string;
  /** If set, also commit to this branch (e.g. staging + main). */
  alsoCommitTo?: string;
  /** WP menu items / topics for tag mapping. */
  menuItems?: string[];
  /** Site category for image prompt context. */
  websiteCategory?: string;
}

/** Result returned by a completed article import job. */
export interface ImportArticlesResult {
  jobId: string;
  site: string;
  totalArticles: number;
  successful: number;
  failed: number;
  durationMs: number;
  n8nImagesTriggered: number;
}

/** Per-article-import progress stored in Redis. */
export interface ArticleImportProgress {
  jobId: string;
  site: string;
  status: "pending" | "running" | "complete" | "failed";
  phase?: string;
  totalArticles: number;
  processedArticles: number;
  successfulArticles: number;
  failedArticles: number;
  currentArticleSlug?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** No retries — article imports are long-running, and re-running could create duplicate articles. */
export const DEFAULT_ARTICLE_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 24 * 3600, count: 200 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
```

- [ ] **Step 2: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS (no errors in types.ts)

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/types.ts
git commit -m "feat(migration): add article import queue types"
```

---

## Task 2: Add Redis Status Tracking for Article Imports

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/import-status.ts`

- [ ] **Step 1: Add article import status functions**

Add after the existing `readBatchStatus` function (after line 99):

```typescript
// --- Article import status (single-site article imports) ---

export const ARTICLE_IMPORT_KEY_PREFIX = "article-import:";
export const ARTICLE_IMPORT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function writeArticleImportProgress(
  redis: Redis,
  jobId: string,
  progress: ArticleImportProgress,
): Promise<void> {
  const key = `${ARTICLE_IMPORT_KEY_PREFIX}${jobId}`;
  await redis.set(key, JSON.stringify(progress), "EX", ARTICLE_IMPORT_TTL_SECONDS);
}

export async function readArticleImportProgress(
  redis: Redis,
  jobId: string,
): Promise<ArticleImportProgress | null> {
  const key = `${ARTICLE_IMPORT_KEY_PREFIX}${jobId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ArticleImportProgress;
  } catch {
    console.error(`[import-status] Corrupted article import JSON for job ${jobId}`);
    return null;
  }
}
```

Add the import at the top of the file:

```typescript
import type { ArticleImportProgress } from "../../queue/types.js";
```

- [ ] **Step 2: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/migration/import-status.ts
git commit -m "feat(migration): add Redis status tracking for article imports"
```

---

## Task 3: Create the Article Import BullMQ Worker

**Files:**
- Create: `services/content-pipeline/src/queue/import-articles.ts`

This worker calls `runMigration()` (the existing orchestrator) and writes progress to Redis instead of SSE.

- [ ] **Step 1: Create the worker file**

```typescript
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { Octokit } from "@octokit/rest";
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
```

- [ ] **Step 2: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/import-articles.ts
git commit -m "feat(migration): add BullMQ worker for background article import"
```

---

## Task 4: Wire Up the Worker in Queue Bootstrap

**Files:**
- Modify: `services/content-pipeline/src/queue/index.ts`

- [ ] **Step 1: Add imports for the new queue**

Add at the top alongside existing import-site imports (around line 16-18):

```typescript
import {
  createImportArticlesQueue,
  createImportArticlesWorker,
} from "./import-articles.js";
import type { ImportArticlesJobData, ImportArticlesResult } from "./types.js";
```

- [ ] **Step 2: Add to QueueInstances interface**

Add two fields to the `QueueInstances` interface (after `importFinalizeWorker`, around line 42):

```typescript
  importArticlesQueue: Queue<ImportArticlesJobData, ImportArticlesResult>;
  importArticlesWorker: Worker<ImportArticlesJobData, ImportArticlesResult>;
```

- [ ] **Step 3: Add exports**

Add alongside the other import queue exports (around line 28):

```typescript
export { IMPORT_ARTICLES_QUEUE } from "./types.js";
export type { ImportArticlesJobData, ImportArticlesResult } from "./types.js";
```

- [ ] **Step 4: Add queue/worker creation in `startWorkers()`**

Add after the import-finalize block (after `console.log("[worker] Import-finalize worker started");`, around line 135):

```typescript
  // Import articles queue (background article migration)
  const importArticlesQueue = createImportArticlesQueue(connection);
  const importArticlesWorker = createImportArticlesWorker(connection, 1);

  importArticlesQueue.on("error", (err) => {
    console.error(`[import-articles-queue] Connection error: ${err.message}`);
  });
  importArticlesWorker.on("error", (err) => {
    console.error(`[import-articles-worker] Connection error: ${err.message}`);
  });
  importArticlesWorker.on("failed", (job, err) => {
    console.error(`[import-articles] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });
  importArticlesWorker.on("completed", (job) => {
    console.log(`[import-articles] Job ${job.id} completed for ${job.data.siteDomain}`);
  });

  console.log("[worker] Import-articles worker started (concurrency: 1)");
```

Note: Concurrency is 1 because article import is heavy (Claude API calls per article with rate limiting). Running multiple in parallel would hit API rate limits.

- [ ] **Step 5: Add to return object**

Add `importArticlesQueue` and `importArticlesWorker` to the return object in `startWorkers()`.

- [ ] **Step 6: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/queue/index.ts
git commit -m "feat(migration): wire up import-articles queue in bootstrap"
```

---

## Task 5: Add Enqueue + Status Handlers

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/handler.ts`

- [ ] **Step 1: Add imports**

Add at the top:

```typescript
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type { ImportArticlesJobData, ImportArticlesResult } from "../../queue/types.js";
import { DEFAULT_ARTICLE_IMPORT_JOB_OPTIONS } from "../../queue/types.js";
import { readArticleImportProgress, writeArticleImportProgress } from "./import-status.js";
```

- [ ] **Step 2: Add the enqueue handler**

Add after `handleImportStatus` (after line 216):

```typescript
// ---------------------------------------------------------------------------
// POST /wp-migrate/import-articles  (enqueue article import)
// ---------------------------------------------------------------------------

interface ImportArticlesRequestBody {
  siteDomain: string;
  wpApiUrl: string;
  branch?: string;
  menuItems?: string[];
  websiteCategory?: string;
}

/**
 * POST /wp-migrate/import-articles
 *
 * Enqueues an article import job and returns a jobId for polling.
 * The actual import runs in the background via BullMQ.
 */
export async function handleEnqueueArticleImport(
  req: IncomingMessage,
  res: ServerResponse,
  importArticlesQueue: Queue<ImportArticlesJobData, ImportArticlesResult>,
  redis: Redis,
): Promise<void> {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => { rawBody += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let body: ImportArticlesRequestBody;
  try {
    body = JSON.parse(rawBody) as ImportArticlesRequestBody;
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

  const jobId = randomUUID();
  const branch = body.branch ?? `staging/${body.siteDomain}`;
  const alsoCommitTo = branch === "main" ? `staging/${body.siteDomain}` : undefined;

  try {
    // Prevent concurrent imports for the same site (lock expires after 2 hours)
    const lockKey = `article-import-active:${body.siteDomain}`;
    const acquired = await redis.set(lockKey, jobId, "EX", 7200, "NX");
    if (!acquired) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "An article import is already running for this site" }));
      return;
    }

    // Write initial "pending" status so polling returns data immediately
    await writeArticleImportProgress(redis, jobId, {
      jobId,
      site: body.siteDomain,
      status: "pending",
      phase: "fetching",
      totalArticles: 0,
      processedArticles: 0,
      successfulArticles: 0,
      failedArticles: 0,
      startedAt: new Date().toISOString(),
    });

    await importArticlesQueue.add(
      `import-articles-${body.siteDomain}`,
      {
        jobId,
        siteDomain: body.siteDomain,
        wpApiUrl: body.wpApiUrl,
        branch,
        alsoCommitTo,
        menuItems: body.menuItems,
        websiteCategory: body.websiteCategory,
      },
      {
        ...DEFAULT_ARTICLE_IMPORT_JOB_OPTIONS,
        jobId: `import-articles-${jobId.slice(0, 8)}`,
      },
    );

    console.log(`[wp-migrate] Enqueued article import for ${body.siteDomain} (job ${jobId.slice(0, 8)})`);

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobId, siteDomain: body.siteDomain }));
  } catch (err) {
    // Release the dedup lock so the user can retry
    await redis.del(lockKey).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-migrate] Failed to enqueue article import:`, message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Failed to enqueue: ${message}` }));
  }
}

// ---------------------------------------------------------------------------
// GET /wp-migrate/article-import-status/:jobId
// ---------------------------------------------------------------------------

/**
 * Returns current article import progress from Redis.
 */
export async function handleArticleImportStatus(
  req: IncomingMessage,
  res: ServerResponse,
  redis: Redis,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  // Expected: ["wp-migrate", "article-import-status", "<jobId>"]
  const jobId = segments[2];

  if (!jobId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "jobId is required" }));
    return;
  }

  const progress = await readArticleImportProgress(redis, jobId);
  if (!progress) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Job not found" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(progress));
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/migration/handler.ts
git commit -m "feat(migration): add enqueue and status handlers for article import"
```

---

## Task 6: Add HTTP Routes

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

- [ ] **Step 1: Add imports**

The `handleEnqueueArticleImport` and `handleArticleImportStatus` are already exported from `handler.ts`. Add them to the existing import from `handler.ts` (find the line that imports `handleMigrationRequest`, `handleCreateSites`, `handleImportStatus`):

```typescript
import {
  handleMigrationRequest,
  handleCreateSites,
  handleImportStatus,
  handleEnqueueArticleImport,
  handleArticleImportStatus,
} from "../migration/handler.js";
```

- [ ] **Step 2: Add routes**

Add after the existing `GET /wp-migrate/import-status/` route (after line 454):

```typescript
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
```

- [ ] **Step 3: Add shutdown cleanup**

In the `shutdown()` function (around line 650), add cleanup for the new queue/worker before `flowProducer.close()`:

```typescript
    await queueInstances.importArticlesWorker.close();
    await queueInstances.importArticlesQueue.close();
```

Add these lines after `importFinalizeQueue.close()` and before `flowProducer.close()`.

- [ ] **Step 4: Verify types compile**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(migration): add HTTP routes for background article import"
```

---

## Task 7: Add Dashboard API Proxy Routes

**Files:**
- Create: `services/dashboard/src/app/api/agent/wp-migrate/import-articles/route.ts`
- Create: `services/dashboard/src/app/api/agent/wp-migrate/article-import-status/[jobId]/route.ts`

- [ ] **Step 1: Create the enqueue proxy**

Create `services/dashboard/src/app/api/agent/wp-migrate/import-articles/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

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

  try {
    const response = await fetch(`${agentUrl}/wp-migrate/import-articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { error: `Content agent unavailable: ${message}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Create the status proxy**

Create `services/dashboard/src/app/api/agent/wp-migrate/article-import-status/[jobId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

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

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { jobId } = await params;
  const agentUrl = getAgentUrl();

  try {
    const response = await fetch(
      `${agentUrl}/wp-migrate/article-import-status/${jobId}`,
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { error: `Content agent unavailable: ${message}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/api/agent/wp-migrate/import-articles/route.ts
git add services/dashboard/src/app/api/agent/wp-migrate/article-import-status/\[jobId\]/route.ts
git commit -m "feat(dashboard): add API proxy routes for background article import"
```

---

## Task 8: Update ImportPanel to Use Queue-Based Flow

**Files:**
- Modify: `services/dashboard/src/components/import/ImportPanel.tsx`

Replace the SSE-based flow with enqueue + poll. The UI stays the same (phase steps, progress bar, log), but the data source changes from SSE events to polling.

- [ ] **Step 1: Rewrite ImportPanel**

Replace the entire file content. Key changes:
- `startImport` calls `POST /api/agent/wp-migrate/import-articles` and gets a `jobId`
- `useEffect` polls `GET /api/agent/wp-migrate/article-import-status/:jobId` every 2 seconds
- Cancel button is removed (background jobs can't be cancelled mid-flight — this is a deliberate tradeoff)
- Add a dismissible banner explaining import continues in the background

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SiteEntry {
  domain: string;
  status: string;
}

type Phase =
  | "fetching"
  | "converting"
  | "generating-image"
  | "uploading-image"
  | "committing"
  | "triggering-images"
  | "complete"
  | "error";

interface ArticleImportProgress {
  jobId: string;
  site: string;
  status: "pending" | "running" | "complete" | "failed";
  phase?: string;
  totalArticles: number;
  processedArticles: number;
  successfulArticles: number;
  failedArticles: number;
  currentArticleSlug?: string;
  error?: string;
}

const PHASE_LABELS: Record<string, string> = {
  fetching: "Fetching articles from WordPress",
  converting: "Converting & cleaning up articles",
  "generating-image": "Generating hero images",
  "uploading-image": "Uploading images to R2",
  committing: "Committing to repository",
  "triggering-images": "Triggering image generation",
  complete: "Import complete",
  error: "Error",
};

const PIPELINE_PHASES: Phase[] = [
  "fetching",
  "converting",
  "generating-image",
  "uploading-image",
  "committing",
  "triggering-images",
  "complete",
];

const POLL_INTERVAL_MS = 2000;

/** Key used to persist active job in localStorage so it survives page refreshes. */
const STORAGE_KEY = "wp-article-import-job";

export function ImportPanel(): React.ReactElement {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [siteTopics, setSiteTopics] = useState<string[]>([]);
  const [wpUrl, setWpUrl] = useState("");
  const [target, setTarget] = useState<"staging" | "main">("staging");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ArticleImportProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const logEndRef = useRef<HTMLDivElement | null>(null);
  const prevSlugRef = useRef<string | undefined>(undefined);

  // Restore active job from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { jobId: string; domain: string };
        if (parsed.jobId) {
          setJobId(parsed.jobId);
          setSelectedDomain(parsed.domain ?? "");
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Load sites list
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const res = await fetch("/api/sites/list");
        if (!res.ok) throw new Error("Failed to load sites");
        const data = (await res.json()) as SiteEntry[];
        if (!cancelled) setSites(data);
      } catch {
        if (!cancelled) setSites([]);
      } finally {
        if (!cancelled) setSitesLoading(false);
      }
    })();
    return (): void => { cancelled = true; };
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleSiteChange = useCallback((domain: string): void => {
    setSelectedDomain(domain);
    setSiteTopics([]);
    setWpUrl(domain ? `https://${domain}/wp-json/wp/v2/posts` : "");
    if (domain) {
      fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: { config?: { brief?: { topics?: string[] } } } | null) => {
          const topics = data?.config?.brief?.topics;
          if (Array.isArray(topics) && topics.length > 0) {
            setSiteTopics(topics);
          }
        })
        .catch(() => { /* non-fatal */ });
    }
  }, []);

  const appendLog = useCallback((msg: string): void => {
    setLog((prev) => [...prev, msg]);
  }, []);

  // Poll for job status
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/agent/wp-migrate/article-import-status/${jobId}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as ArticleImportProgress;
        if (cancelled) return;

        setProgress(data);

        // Append log for new article slugs
        if (data.currentArticleSlug && data.currentArticleSlug !== prevSlugRef.current) {
          prevSlugRef.current = data.currentArticleSlug;
          appendLog(`[${data.phase ?? "processing"}] ${data.currentArticleSlug}`);
        }

        if (data.status === "complete") {
          appendLog(`Import complete: ${data.successfulArticles} succeeded, ${data.failedArticles} failed`);
          localStorage.removeItem(STORAGE_KEY);
        } else if (data.status === "failed") {
          appendLog(`Error: ${data.error ?? "Unknown error"}`);
          setErrorMsg(data.error ?? "Unknown error");
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Silently retry
      }
    };

    // Poll immediately, then on interval
    void poll();
    const interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    return (): void => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, appendLog]);

  const startImport = useCallback(async (): Promise<void> => {
    if (!selectedDomain || !wpUrl) return;

    setSubmitting(true);
    setProgress(null);
    setLog([]);
    setErrorMsg(null);
    prevSlugRef.current = undefined;

    try {
      const res = await fetch("/api/agent/wp-migrate/import-articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: selectedDomain,
          wpApiUrl: wpUrl,
          branch: target === "main" ? "main" : `staging/${selectedDomain}`,
          ...(siteTopics.length > 0 ? { menuItems: siteTopics } : {}),
        }),
      });

      const data = (await res.json()) as { jobId?: string; error?: string };

      if (!res.ok || !data.jobId) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }

      setJobId(data.jobId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: data.jobId, domain: selectedDomain }));
      appendLog(`Import enqueued — job ${data.jobId.slice(0, 8)}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }, [selectedDomain, wpUrl, target, siteTopics, appendLog]);

  const handleReset = useCallback((): void => {
    setJobId(null);
    setProgress(null);
    setLog([]);
    setErrorMsg(null);
    prevSlugRef.current = undefined;
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const currentPhase = progress?.phase as Phase | undefined;
  const isDone = progress?.status === "complete";
  const isFailed = progress?.status === "failed";
  const isRunning = !!jobId && !isDone && !isFailed;
  const currentPhaseIndex = currentPhase ? PIPELINE_PHASES.indexOf(currentPhase) : -1;

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Import Articles from WordPress
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Select a site and its WordPress API URL to migrate articles.
            Import runs in the background — you can close this tab safely.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            Target Site
          </label>
          <select
            value={selectedDomain}
            onChange={(e): void => handleSiteChange(e.target.value)}
            disabled={isRunning || submitting || sitesLoading}
            className="w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <option value="">
              {sitesLoading ? "Loading sites..." : "Select a site"}
            </option>
            {sites.map((s) => (
              <option key={s.domain} value={s.domain}>
                {s.domain}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            WordPress Posts API URL
          </label>
          <input
            type="text"
            value={wpUrl}
            onChange={(e): void => setWpUrl(e.target.value)}
            disabled={isRunning || submitting}
            placeholder="https://example.com/wp-json/wp/v2/posts"
            className="w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
          />
        </div>

        {/* Deploy target */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            Deploy To
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={(): void => setTarget("staging")}
              disabled={isRunning || submitting}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                target === "staging"
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Staging
            </button>
            <button
              type="button"
              onClick={(): void => setTarget("main")}
              disabled={isRunning || submitting}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                target === "main"
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Live (main)
            </button>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            {target === "staging"
              ? `Articles will be committed to staging/${selectedDomain || "<domain>"}. You can deploy to production after reviewing.`
              : `Articles will be committed to both main and staging/${selectedDomain || "<domain>"}`}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          {!isRunning ? (
            <button
              onClick={startImport}
              disabled={!selectedDomain || !wpUrl || submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Start Import"}
            </button>
          ) : (
            <span className="px-4 py-2 rounded-lg text-sm font-medium text-cyan bg-cyan/10">
              Import running in background...
            </span>
          )}
          {(isDone || isFailed) && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              New Import
            </button>
          )}
        </div>
      </div>

      {/* Progress steps */}
      {progress && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Progress
            {progress.totalArticles > 0 && (
              <span className="ml-2 font-normal text-[var(--text-secondary)]">
                ({progress.processedArticles}/{progress.totalArticles} articles
                {(progress.successfulArticles > 0 || progress.failedArticles > 0) && (
                  <>
                    {" — "}
                    <span className="text-green-500">{progress.successfulArticles} succeeded</span>
                    {progress.failedArticles > 0 && (
                      <>, <span className="text-red-400">{progress.failedArticles} failed</span></>
                    )}
                  </>
                )}
                )
              </span>
            )}
          </h2>

          <div className="space-y-3">
            {PIPELINE_PHASES.map((phase, idx) => {
              const isCurrent = phase === currentPhase;
              const isComplete = idx < currentPhaseIndex || isDone;
              const isPending = idx > currentPhaseIndex && !isDone;

              return (
                <div key={phase} className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isComplete
                        ? "bg-green-500 text-white"
                        : isCurrent
                          ? "bg-cyan text-white animate-pulse"
                          : isPending
                            ? "border border-[var(--border-secondary)] text-[var(--text-tertiary)]"
                            : "border border-[var(--border-secondary)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    {isComplete ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span
                    className={`text-sm ${
                      isCurrent
                        ? "text-[var(--text-primary)] font-medium"
                        : isComplete
                          ? "text-green-500"
                          : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    {PHASE_LABELS[phase] ?? phase}
                  </span>
                </div>
              );
            })}
          </div>

          {isFailed && errorMsg && (
            <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {errorMsg}
            </div>
          )}

          {isDone && (
            <div className="mt-4 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
              Import finished: {progress.successfulArticles} article{progress.successfulArticles !== 1 ? "s" : ""} imported
              {progress.failedArticles > 0 && `, ${progress.failedArticles} failed`}.
            </div>
          )}
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            Log
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-[var(--bg-primary)] border border-[var(--border-secondary)] p-3 font-mono text-xs text-[var(--text-secondary)] space-y-0.5">
            {log.map((entry, i) => (
              <div key={i}>{entry}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/import/ImportPanel.tsx
git commit -m "feat(dashboard): rewrite ImportPanel to use background queue instead of SSE"
```

---

## Task 9: Update CsvSiteCreator Article Import to Use Queue

**Files:**
- Modify: `services/dashboard/src/components/import/CsvSiteCreator.tsx`

Replace the SSE-based `handleImportArticles` with the same enqueue + poll pattern.

- [ ] **Step 1: Update the ArticleImportState interface**

Replace the existing `ArticleImportState` interface (lines 34-43) with:

```typescript
interface ArticleImportState {
  status: "idle" | "importing" | "complete" | "error";
  jobId?: string;
  phase?: string;
  totalArticles?: number;
  processedArticles?: number;
  successfulArticles?: number;
  failedArticles?: number;
  currentArticleSlug?: string;
  successful?: number;
  failed?: number;
  error?: string;
}
```

- [ ] **Step 2: Remove SSE helper and abort refs**

Remove the `consumeSSE` function (lines 141-172), the `ArticleImportEvent` type (lines 136-139), and the `importAbortRefs` ref (line 187). These are no longer needed.

- [ ] **Step 3: Add polling for article imports**

Add a `useEffect` after the existing batch status polling (after line 215).

**IMPORTANT:** The dependency must be a stable primitive, NOT the `articleImports` Map itself (which creates a new object on every update and would cause an infinite re-render loop). Derive a stable string key from active job IDs:

```typescript
  // Derive a stable dependency string from active importing jobs
  const activeArticleJobIds = [...articleImports.entries()]
    .filter(([, s]) => s.status === "importing" && s.jobId)
    .map(([, s]) => s.jobId!)
    .sort()
    .join(",");

  // Poll for article import progress
  useEffect(() => {
    if (!activeArticleJobIds) return;

    let cancelled = false;

    const interval = setInterval(async () => {
      // Re-read current state inside the interval to avoid stale closures
      const jobPairs = activeArticleJobIds.split(",").filter(Boolean);
      if (jobPairs.length === 0) return;

      for (const activeJobId of jobPairs) {
        if (cancelled) break;
        try {
          const res = await fetch(`/api/agent/wp-migrate/article-import-status/${activeJobId}`);
          if (cancelled || !res.ok) continue;
          const data = (await res.json()) as {
            jobId: string;
            site: string;
            status: string;
            phase?: string;
            totalArticles: number;
            processedArticles: number;
            successfulArticles: number;
            failedArticles: number;
            currentArticleSlug?: string;
            error?: string;
          };
          if (cancelled) continue;

          // Find the siteId that has this jobId
          setArticleImports((prev) => {
            const next = new Map(prev);
            // Find the entry with this jobId
            for (const [siteId, state] of prev) {
              if (state.jobId !== activeJobId) continue;

              if (data.status === "complete") {
                next.set(siteId, {
                  status: "complete",
                  jobId: activeJobId,
                  successful: data.successfulArticles,
                  failed: data.failedArticles,
                });
              } else if (data.status === "failed") {
                next.set(siteId, {
                  status: "error",
                  jobId: activeJobId,
                  error: data.error ?? "Import failed",
                });
              } else {
                next.set(siteId, {
                  status: "importing",
                  jobId: activeJobId,
                  phase: data.phase,
                  totalArticles: data.totalArticles,
                  processedArticles: data.processedArticles,
                  currentArticleSlug: data.currentArticleSlug,
                });
              }
              break;
            }
            return next;
          });
        } catch {
          // Silently retry
        }
      }
    }, POLL_INTERVAL_MS);

    return (): void => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeArticleJobIds]);
```

- [ ] **Step 4: Rewrite handleImportArticles**

Replace the existing `handleImportArticles` callback (lines 283-346) with:

```typescript
  const handleImportArticles = useCallback(
    async (siteId: string, postsApiUrl: string): Promise<void> => {
      setArticleImports((prev) => {
        const next = new Map(prev);
        next.set(siteId, { status: "importing" });
        return next;
      });

      try {
        const res = await fetch("/api/agent/wp-migrate/import-articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteDomain: siteId,
            wpApiUrl: postsApiUrl,
            branch: `staging/${siteId}`,
          }),
        });

        const data = (await res.json()) as { jobId?: string; error?: string };

        if (!res.ok || !data.jobId) {
          setArticleImports((prev) => {
            const next = new Map(prev);
            next.set(siteId, { status: "error", error: data.error ?? `HTTP ${res.status}` });
            return next;
          });
          return;
        }

        setArticleImports((prev) => {
          const next = new Map(prev);
          next.set(siteId, { status: "importing", jobId: data.jobId });
          return next;
        });
      } catch (err) {
        setArticleImports((prev) => {
          const next = new Map(prev);
          next.set(siteId, { status: "error", error: err instanceof Error ? err.message : "Unknown error" });
          return next;
        });
      }
    },
    [],
  );
```

- [ ] **Step 5: Simplify handleReset**

Replace the existing `handleReset` (lines 348-361) — remove abort controller cleanup since there are no more abort refs:

```typescript
  const handleReset = useCallback((): void => {
    setSites([]);
    setRawRows([]);
    setBatchId(null);
    setBatchStatus(null);
    setPhase("idle");
    setArticleImports(new Map());
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);
```

- [ ] **Step 6: Verify types compile**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/dashboard/src/components/import/CsvSiteCreator.tsx
git commit -m "feat(dashboard): rewrite CsvSiteCreator article import to use background queue"
```

---

## Task 10: Verify Both Services Typecheck

**Files:** None (verification only)

- [ ] **Step 1: Typecheck content-pipeline**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS with 0 errors

- [ ] **Step 2: Typecheck dashboard**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS with 0 errors

- [ ] **Step 3: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass (no regressions)

- [ ] **Step 4: Final commit**

If any typecheck fixes were needed:

```bash
git add -u
git commit -m "fix: resolve typecheck issues from background article import"
```
