# CSV Import Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential HTTP/SSE site-creation loop with a BullMQ-backed background job system that handles 100+ site imports with limited concurrency, batched GitHub operations, and a polling-based progress API.

**Architecture:** CSV rows are validated up front and submitted as a BullMQ Flow (one parent "finalize" job + N child "import-site" jobs). Children run with concurrency 3, each creating one site (branch, config, assets). The parent job runs after all children complete, batch-committing `dashboard-index.yaml` and triggering KV sync in a single commit. A Redis hash per batch tracks per-site status for polling. The dashboard frontend replaces SSE consumption with interval-based polling.

**Tech Stack:** BullMQ (already in deps), ioredis (already in deps), Octokit with `@octokit/plugin-retry` + `@octokit/plugin-throttling` (new deps), Vitest (existing test framework).

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `services/content-pipeline/src/queue/import-site.ts` | BullMQ queue + worker for per-site import jobs |
| `services/content-pipeline/src/queue/import-finalize.ts` | BullMQ worker for parent finalize job (batch dashboard-index commit + KV sync) |
| `services/content-pipeline/src/agents/migration/batch-import.ts` | Batch submission logic: validate CSV, create Redis state, enqueue Flow |
| `services/content-pipeline/src/agents/migration/import-status.ts` | Read batch status from Redis for the polling API |
| `services/content-pipeline/src/__tests__/migration/batch-import.test.ts` | Tests for batch validation, duplicate detection, safeguards |
| `services/content-pipeline/src/__tests__/migration/import-status.test.ts` | Tests for status reading and aggregation |
| `services/dashboard/src/app/api/agent/wp-migrate/import-status/[batchId]/route.ts` | Dashboard proxy for status polling |

### Modified files

| File | Changes |
|------|---------|
| `services/content-pipeline/src/queue/types.ts` | Add `ImportSiteJobData`, `ImportFinalizeData`, `ImportBatchSiteStatus`, queue name constants |
| `services/content-pipeline/src/queue/index.ts` | Wire up import-site + import-finalize queues and workers, extend `QueueInstances` |
| `services/content-pipeline/src/lib/github.ts` | Add `createResilientOctokit()` with retry + throttle plugins |
| `services/content-pipeline/src/agents/migration/handler.ts` | Replace `handleCreateSites` body with batch enqueue, add `handleImportStatus` for polling |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Register new `GET /wp-migrate/import-status/:batchId` route |
| `services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts` | Change from SSE passthrough to JSON response (returns `{ batchId }`) |
| `services/dashboard/src/components/import/CsvSiteCreator.tsx` | Replace SSE with polling, add batch-level progress bar, per-site status cards |

---

## Data Flow

```
Frontend (CsvSiteCreator)
  │
  │ POST /api/agent/wp-migrate/create-sites  { rows, branch }
  ▼
Dashboard Proxy (route.ts)
  │
  │ POST /wp-migrate/create-sites  { rows, branch }
  ▼
Content Pipeline (handler.ts → batch-import.ts)
  │
  ├─ Validate CSV rows (max 200, no duplicate domains)
  ├─ Write batch metadata to Redis hash: import-batch:<batchId>
  ├─ Create BullMQ Flow via FlowProducer:
  │    Parent: import-finalize (queueName: IMPORT_FINALIZE_QUEUE)
  │    Children: N × import-site (queueName: IMPORT_SITE_QUEUE)
  │
  │ Return 202 { batchId }
  ▼
BullMQ Worker (import-site.ts) — concurrency 3
  │
  │ Per site:
  │  1. Resolve categories (aggregator API)
  │  2. Fetch assets (logo, favicon)
  │  3. Build config (pure function)
  │  4. Create staging branch (Git API, skip if exists)
  │  5. Commit files to staging/<siteId> (Git Trees API)
  │  6. Update Redis hash with site status
  │
  ▼
BullMQ Worker (import-finalize.ts) — runs after ALL children complete
  │
  │ 1. Read dashboard-index.yaml once
  │ 2. Add all new sites in ONE commit
  │ 3. Trigger KV sync for each site (build-trigger files)
  │ 4. Update Redis batch status to "complete"
  │
  ▼
Frontend polls GET /api/agent/wp-migrate/import-status/<batchId>
  │
  │ Returns: { status, total, completed, failed, sites: [...] }
  │
  ▼
Dashboard Proxy (import-status/[batchId]/route.ts)
  │
  │ GET /wp-migrate/import-status/<batchId>
  ▼
Content Pipeline (handler.ts → import-status.ts)
  │
  │ HGETALL import-batch:<batchId> from Redis
```

## Redis Schema

```
Key: import-batch:<batchId>  (Hash, TTL 24h)
Fields:
  meta     → JSON { total: number, status: "pending"|"running"|"complete"|"failed", createdAt: string }
  site:<id> → JSON { status: "pending"|"running"|"complete"|"error", phase?: string, error?: string, warnings?: string[], previewUrl?: string, postsApiUrl?: string }
```

---

### Task 1: Add Import Queue Types

**Files:**
- Modify: `services/content-pipeline/src/queue/types.ts`
- Test: `services/content-pipeline/src/__tests__/migration/batch-import.test.ts` (created in Task 5)

- [ ] **Step 1: Add import types to queue/types.ts**

Add the following import at the top of the file (alongside existing imports):

```typescript
import type { JobsOptions } from "bullmq";
```

Then add the following types after the existing `SchedulerRunData` interface:

```typescript
// --- Import site queue ---

export const IMPORT_SITE_QUEUE = "import-site";
export const IMPORT_FINALIZE_QUEUE = "import-finalize";

/** Max sites per CSV upload. */
export const MAX_IMPORT_BATCH_SIZE = 200;

/** Data for each per-site import child job. */
export interface ImportSiteJobData {
  batchId: string;
  siteId: string;
  row: Record<string, string>;
}

/** Result returned by each completed import-site job. */
export interface ImportSiteResult {
  siteId: string;
  domain: string;
  status: "created" | "error";
  previewUrl?: string;
  warnings?: string[];
  postsApiUrl?: string;
  error?: string;
}

/** Data for the parent finalize job. */
export interface ImportFinalizeData {
  batchId: string;
  siteIds: string[];
}

/** Per-site status stored in the Redis batch hash. */
export interface ImportBatchSiteStatus {
  status: "pending" | "running" | "complete" | "error";
  phase?: string;
  error?: string;
  warnings?: string[];
  previewUrl?: string;
  postsApiUrl?: string;
}

/** Batch metadata stored in the Redis batch hash (the "meta" field). */
export interface ImportBatchMeta {
  total: number;
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
}

export const DEFAULT_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 15_000,
  },
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/types.ts
git commit -m "feat(import): add BullMQ import queue types"
```

---

### Task 2: Add Resilient Octokit with Retry + Throttle

**Files:**
- Modify: `services/content-pipeline/package.json` (new deps)
- Modify: `services/content-pipeline/src/lib/github.ts`

- [ ] **Step 1: Install Octokit plugins**

```bash
cd services/content-pipeline && pnpm add @octokit/plugin-retry @octokit/plugin-throttling
```

- [ ] **Step 2: Add createResilientOctokit to github.ts**

Add the following after the existing `createGitHubClient` function (around line 24):

```typescript
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const ResilientOctokit = Octokit.plugin(retry, throttling);

/**
 * Octokit instance with automatic retry on 5xx/network errors
 * and rate-limit throttling. Use for batch operations (CSV import).
 */
export function createResilientOctokit(token: string): Octokit {
  return new ResilientOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number): boolean => {
        console.warn(`[github] Rate limit hit for ${options.method} ${options.url} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number): boolean => {
        console.warn(`[github] Secondary rate limit for ${options.method} ${options.url} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 1;
      },
    },
    retry: {
      doNotRetry: ["429"],
    },
  });
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors.

**If type errors on the throttle callbacks:** The `@octokit/plugin-throttling` API changed in v9+. The callbacks may now receive a single options object instead of positional parameters. After installing, check the actual signature in `node_modules/@octokit/plugin-throttling/dist-types/index.d.ts` and adjust the callback signatures accordingly. The dashboard already has working retry/throttle in `services/dashboard/src/lib/github.ts` — use that as a reference for the correct callback shape.

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/package.json services/content-pipeline/src/lib/github.ts
# Also add pnpm-lock.yaml if it changed
git commit -m "feat(import): add resilient Octokit with retry and rate-limit throttling"
```

---

### Task 3: Redis Batch State Helpers

**Files:**
- Create: `services/content-pipeline/src/agents/migration/import-status.ts`
- Test: `services/content-pipeline/src/__tests__/migration/import-status.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `services/content-pipeline/src/__tests__/migration/import-status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  writeBatchMeta,
  writeSiteStatus,
  readBatchStatus,
  BATCH_KEY_PREFIX,
  BATCH_TTL_SECONDS,
} from "../../agents/migration/import-status.js";

// Minimal Redis mock
function createRedisMock(): Record<string, unknown> {
  const store = new Map<string, Map<string, string>>();

  return {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!store.has(key)) store.set(key, new Map());
      store.get(key)!.set(field, value);
      return 1;
    }),
    hgetall: vi.fn(async (key: string) => {
      const map = store.get(key);
      if (!map || map.size === 0) return {};
      const obj: Record<string, string> = {};
      for (const [k, v] of map) obj[k] = v;
      return obj;
    }),
    expire: vi.fn(async () => 1),
    _store: store,
  };
}

describe("import-status", () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("writeBatchMeta stores meta and sets TTL", async () => {
    await writeBatchMeta(redis as never, "batch-1", { total: 5, status: "pending", createdAt: "2026-05-24T00:00:00Z" });

    expect(redis.hset).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      "meta",
      expect.any(String),
    );
    expect(redis.expire).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      BATCH_TTL_SECONDS,
    );
  });

  it("writeSiteStatus stores per-site status", async () => {
    await writeSiteStatus(redis as never, "batch-1", "mysite", {
      status: "running",
      phase: "resolving-categories",
    });

    expect(redis.hset).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      "site:mysite",
      expect.stringContaining("resolving-categories"),
    );
  });

  it("readBatchStatus aggregates meta and site statuses", async () => {
    await writeBatchMeta(redis as never, "batch-1", { total: 2, status: "running", createdAt: "2026-05-24T00:00:00Z" });
    await writeSiteStatus(redis as never, "batch-1", "site-a", { status: "complete", previewUrl: "https://example.com" });
    await writeSiteStatus(redis as never, "batch-1", "site-b", { status: "error", error: "branch creation failed" });

    const result = await readBatchStatus(redis as never, "batch-1");

    expect(result).not.toBeNull();
    expect(result!.total).toBe(2);
    expect(result!.status).toBe("running");
    expect(result!.sites).toHaveLength(2);
    expect(result!.sites.find((s) => s.siteId === "site-a")?.status).toBe("complete");
    expect(result!.sites.find((s) => s.siteId === "site-b")?.error).toBe("branch creation failed");
  });

  it("readBatchStatus returns null for unknown batch", async () => {
    const result = await readBatchStatus(redis as never, "nonexistent");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/migration/import-status.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement import-status.ts**

Create `services/content-pipeline/src/agents/migration/import-status.ts`:

```typescript
import type { Redis } from "ioredis";
import type { ImportBatchMeta, ImportBatchSiteStatus } from "../../queue/types.js";

export const BATCH_KEY_PREFIX = "import-batch:";
export const BATCH_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function writeBatchMeta(
  redis: Redis,
  batchId: string,
  meta: ImportBatchMeta,
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  await redis.hset(key, "meta", JSON.stringify(meta));
  await redis.expire(key, BATCH_TTL_SECONDS);
}

export async function updateBatchStatus(
  redis: Redis,
  batchId: string,
  status: ImportBatchMeta["status"],
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  const raw = await redis.hget(key, "meta");
  if (!raw) return;
  const meta = JSON.parse(raw) as ImportBatchMeta;
  meta.status = status;
  await redis.hset(key, "meta", JSON.stringify(meta));
}

export async function writeSiteStatus(
  redis: Redis,
  batchId: string,
  siteId: string,
  status: ImportBatchSiteStatus,
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  await redis.hset(key, `site:${siteId}`, JSON.stringify(status));
}

export interface BatchStatusResponse {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  status: ImportBatchMeta["status"];
  createdAt: string;
  sites: Array<ImportBatchSiteStatus & { siteId: string }>;
}

export async function readBatchStatus(
  redis: Redis,
  batchId: string,
): Promise<BatchStatusResponse | null> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  const all = await redis.hgetall(key);

  if (!all || !all["meta"]) return null;

  const meta = JSON.parse(all["meta"]) as ImportBatchMeta;
  const sites: Array<ImportBatchSiteStatus & { siteId: string }> = [];

  for (const [field, value] of Object.entries(all)) {
    if (field.startsWith("site:")) {
      const siteId = field.slice(5);
      const siteStatus = JSON.parse(value) as ImportBatchSiteStatus;
      sites.push({ ...siteStatus, siteId });
    }
  }

  const completed = sites.filter((s) => s.status === "complete").length;
  const failed = sites.filter((s) => s.status === "error").length;

  return {
    batchId,
    total: meta.total,
    completed,
    failed,
    status: meta.status,
    createdAt: meta.createdAt,
    sites,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/migration/import-status.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/import-status.ts services/content-pipeline/src/__tests__/migration/import-status.test.ts
git commit -m "feat(import): add Redis batch state helpers for import tracking"
```

---

### Task 4: Per-Site Import Job Processor

**Files:**
- Create: `services/content-pipeline/src/queue/import-site.ts`

This file follows the exact pattern of `queue/content-generation.ts`: export queue factory + worker factory + processor function.

- [ ] **Step 1: Create import-site.ts**

Create `services/content-pipeline/src/queue/import-site.ts`:

```typescript
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { Octokit } from "@octokit/rest";
import { stringify } from "yaml";
import { IMPORT_SITE_QUEUE } from "./types.js";
import type { ImportSiteJobData, ImportSiteResult } from "./types.js";
import { parseCsvRow } from "../agents/migration/csv-parser.js";
import { resolveCategories } from "../agents/migration/category-resolver.js";
import {
  buildFullSiteConfig,
  buildSkillMd,
  generateAuthorName,
  domainToSiteId,
} from "../agents/migration/site-scaffolder.js";
import { commitBatch, parseRepo, createResilientOctokit } from "../lib/github.js";
import type { BatchFileEntry, BatchBinaryEntry } from "../lib/github.js";
import { writeSiteStatus } from "../agents/migration/import-status.js";

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function processImportSiteJob(
  job: Job<ImportSiteJobData>,
  redisConnection: Redis,
  githubToken: string,
  networkRepo: string,
): Promise<ImportSiteResult> {
  const { batchId, siteId, row } = job.data;

  const site = parseCsvRow(row);
  const domainOrName = site.domain || site.name;
  const previewUrl = `https://atomic-site-worker-staging.accounts-4a8.workers.dev/?_atl_site=${siteId}`;
  const warnings: string[] = [];

  const updateStatus = (phase: string): Promise<void> =>
    writeSiteStatus(redisConnection, batchId, siteId, { status: "running", phase });

  try {
    // Mark as running
    await updateStatus("resolving-categories");

    // 1. Resolve categories
    let resolved: Awaited<ReturnType<typeof resolveCategories>> = null;
    try {
      resolved = await resolveCategories(site.websiteCategory, site.subCategories, site.name);
    } catch (err) {
      warnings.push(`Category resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Fetch assets
    await updateStatus("fetching-assets");
    const logoBase64 = await fetchImageAsBase64(site.logoUrl);
    if (site.logoUrl && !logoBase64) warnings.push("Could not fetch logo");
    const faviconBase64 = await fetchImageAsBase64(site.faviconUrl);
    if (site.faviconUrl && !faviconBase64) warnings.push("Could not fetch favicon");

    // 3. Build config
    await updateStatus("building-config");
    const author = generateAuthorName();
    const config = buildFullSiteConfig(site, resolved, author, !!logoBase64, !!faviconBase64);
    const skillContent = buildSkillMd(
      site.name || siteId,
      config.brief.topics,
      site.websiteCategory || "General",
    );

    // 4. Create staging branch
    await updateStatus("creating-branch");
    const octokit = createResilientOctokit(githubToken);
    const { owner, repo: repoName } = parseRepo(networkRepo);
    try {
      const { data: mainRef } = await octokit.git.getRef({ owner, repo: repoName, ref: "heads/main" });
      await octokit.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/staging/${siteId}`,
        sha: mainRef.object.sha,
      });
    } catch (e: unknown) {
      if ((e as { status?: number }).status !== 422) throw e;
      // 422 = branch already exists, non-fatal
    }

    // 5. Commit files to staging branch
    await updateStatus("committing");
    const textFiles: BatchFileEntry[] = [
      { path: `sites/${siteId}/site.yaml`, content: stringify(config, { lineWidth: 0 }) },
      { path: `sites/${siteId}/skill.md`, content: skillContent },
      { path: `sites/${siteId}/assets/.gitkeep`, content: "" },
      { path: `sites/${siteId}/articles/.gitkeep`, content: "" },
    ];
    const binaryFiles: BatchBinaryEntry[] = [];
    if (logoBase64) binaryFiles.push({ path: `sites/${siteId}/assets/logo.png`, base64: logoBase64 });
    if (faviconBase64) binaryFiles.push({ path: `sites/${siteId}/assets/favicon.png`, base64: faviconBase64 });

    await commitBatch(
      octokit,
      networkRepo,
      textFiles,
      binaryFiles,
      `feat: scaffold site ${siteId} from CSV import`,
      `staging/${siteId}`,
    );

    // 6. Update Redis — mark site as complete
    const result: ImportSiteResult = {
      siteId,
      domain: domainOrName,
      status: "created",
      previewUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
      postsApiUrl: site.postsApiUrl || undefined,
    };

    await writeSiteStatus(redisConnection, batchId, siteId, {
      status: "complete",
      previewUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
      postsApiUrl: site.postsApiUrl || undefined,
    });

    console.log(`[import-site] Created ${siteId} (${warnings.length} warnings)`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await writeSiteStatus(redisConnection, batchId, siteId, {
      status: "error",
      error: message,
    });

    console.error(`[import-site] Error for ${siteId}:`, message);
    throw err; // Let BullMQ retry
  }
}

export function createImportSiteQueue(
  connection: Redis,
): Queue<ImportSiteJobData, ImportSiteResult> {
  return new Queue(IMPORT_SITE_QUEUE, { connection });
}

export function createImportSiteWorker(
  connection: Redis,
  concurrency: number,
  githubToken: string,
  networkRepo: string,
): Worker<ImportSiteJobData, ImportSiteResult> {
  return new Worker(
    IMPORT_SITE_QUEUE,
    async (job) => processImportSiteJob(job, connection, githubToken, networkRepo),
    { connection, concurrency },
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/import-site.ts
git commit -m "feat(import): add BullMQ per-site import job processor"
```

---

### Task 5: Import Batch Finalize Job

**Files:**
- Create: `services/content-pipeline/src/queue/import-finalize.ts`

This follows the `scheduler-flow.ts` pattern: the parent job runs after all children complete, reads their return values, and does the batch dashboard-index commit.

- [ ] **Step 1: Create import-finalize.ts**

Create `services/content-pipeline/src/queue/import-finalize.ts`:

```typescript
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { parse, stringify } from "yaml";
import { IMPORT_FINALIZE_QUEUE } from "./types.js";
import type { ImportFinalizeData, ImportSiteResult } from "./types.js";
import { commitBatch, readFile, createResilientOctokit, parseRepo } from "../lib/github.js";
import type { BatchFileEntry } from "../lib/github.js";
import { updateBatchStatus } from "../agents/migration/import-status.js";

/**
 * Process the parent "import-finalize" job.
 * Runs after ALL child import-site jobs complete.
 *
 * 1. Reads all children's return values
 * 2. Batch-commits new entries to dashboard-index.yaml (one commit)
 * 3. Triggers KV sync for each successful site
 * 4. Updates batch status in Redis
 */
export async function processImportFinalize(
  job: Job<ImportFinalizeData>,
  redisConnection: Redis,
  githubToken: string,
  networkRepo: string,
): Promise<void> {
  const { batchId, siteIds } = job.data;

  await updateBatchStatus(redisConnection, batchId, "running");

  const octokit = createResilientOctokit(githubToken);
  const { owner, repo: repoName } = parseRepo(networkRepo);

  // Collect child results
  const childrenValues = (await job.getChildrenValues()) as Record<string, ImportSiteResult | null>;
  const successfulSites: ImportSiteResult[] = [];
  const failedSiteIds: string[] = [];

  for (const [, result] of Object.entries(childrenValues)) {
    if (result && result.status === "created") {
      successfulSites.push(result);
    }
  }

  // Determine which sites failed (enqueued but not in completed results)
  const completedSiteIds = new Set(successfulSites.map((s) => s.siteId));
  for (const id of siteIds) {
    if (!completedSiteIds.has(id)) {
      failedSiteIds.push(id);
    }
  }

  // 1. Batch update dashboard-index.yaml — one commit for all sites
  if (successfulSites.length > 0) {
    try {
      const indexContent = await readFile(octokit, networkRepo, "dashboard-index.yaml", "main");
      const index = parse(indexContent) as { sites: Array<Record<string, unknown>> };
      const existingDomains = new Set(
        index.sites.map((s: Record<string, unknown>) => s.domain as string),
      );

      const now = new Date().toISOString();
      let added = 0;
      for (const site of successfulSites) {
        if (existingDomains.has(site.siteId)) continue;

        index.sites.push({
          domain: site.siteId,
          company: null,
          vertical: null,
          status: "Staging",
          site_id: `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
          exclusivity: null,
          ob_epid: null,
          ga_info: null,
          cf_apo: false,
          fixed_ad: false,
          last_updated: now,
          created_at: now,
          pages_project: null,
          pages_subdomain: null,
          zone_id: null,
          staging_branch: `staging/${site.siteId}`,
          preview_url: site.previewUrl,
          saved_previews: null,
          custom_domain: null,
        });
        added++;
      }

      if (added > 0) {
        await commitBatch(
          octokit,
          networkRepo,
          [{ path: "dashboard-index.yaml", content: stringify(index, { lineWidth: 0 }) }],
          [],
          `dashboard: add ${added} site(s) from CSV import (batch ${batchId.slice(0, 8)})`,
          "main",
        );
        console.log(`[import-finalize] Added ${added} sites to dashboard-index.yaml`);
      }
    } catch (err) {
      console.error(`[import-finalize] Failed to update dashboard-index:`, err);
      // Non-fatal: sites are created, just not in the index yet
    }

    // 2. Trigger KV sync for each site
    for (const site of successfulSites) {
      try {
        const triggerPath = `sites/${site.siteId}/.build-trigger`;
        let existingSha: string | undefined;
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo: repoName,
            path: triggerPath,
            ref: `staging/${site.siteId}`,
          });
          if ("sha" in data) existingSha = data.sha as string;
        } catch {
          /* doesn't exist yet */
        }
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo: repoName,
          path: triggerPath,
          message: `ci: trigger KV sync for ${site.siteId}`,
          content: Buffer.from(new Date().toISOString()).toString("base64"),
          sha: existingSha,
          branch: `staging/${site.siteId}`,
        });
      } catch (err) {
        console.warn(`[import-finalize] KV sync trigger failed for ${site.siteId}:`, err);
      }
    }
  }

  // 3. Update batch status
  const finalStatus = failedSiteIds.length === siteIds.length ? "failed" : "complete";
  await updateBatchStatus(redisConnection, batchId, finalStatus);

  console.log(
    `[import-finalize] Batch ${batchId.slice(0, 8)} done: ${successfulSites.length} created, ${failedSiteIds.length} failed`,
  );
}

export function createImportFinalizeQueue(
  connection: Redis,
): Queue<ImportFinalizeData> {
  return new Queue(IMPORT_FINALIZE_QUEUE, { connection });
}

export function createImportFinalizeWorker(
  connection: Redis,
  githubToken: string,
  networkRepo: string,
): Worker<ImportFinalizeData> {
  return new Worker(
    IMPORT_FINALIZE_QUEUE,
    async (job) => processImportFinalize(job, connection, githubToken, networkRepo),
    { connection },
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/import-finalize.ts
git commit -m "feat(import): add batch finalize job for dashboard-index commit"
```

---

### Task 6: Wire Up Import Queues

**Files:**
- Modify: `services/content-pipeline/src/queue/index.ts`

- [ ] **Step 1: Extend QueueInstances and startWorkers**

In `services/content-pipeline/src/queue/index.ts`, add the import queue instances alongside the existing generate queue.

Add imports at top:

```typescript
import {
  createImportSiteQueue,
  createImportSiteWorker,
} from "./import-site.js";
import {
  createImportFinalizeQueue,
  createImportFinalizeWorker,
} from "./import-finalize.js";
import type { ImportSiteJobData, ImportSiteResult, ImportFinalizeData } from "./types.js";
import { IMPORT_SITE_QUEUE, IMPORT_FINALIZE_QUEUE } from "./types.js";
```

Add new exports:

```typescript
export { IMPORT_SITE_QUEUE, IMPORT_FINALIZE_QUEUE } from "./types.js";
export type { ImportSiteJobData, ImportSiteResult, ImportFinalizeData } from "./types.js";
```

Extend `QueueInstances`:

```typescript
export interface QueueInstances {
  connection: Redis;
  generateQueue: Queue<GenerateJobData, BatchContentGenerationResult>;
  generateQueueEvents: QueueEvents;
  generateWorker: Worker<GenerateJobData, BatchContentGenerationResult>;
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
  schedulerRunQueue: Queue<SchedulerRunData>;
  importSiteQueue: Queue<ImportSiteJobData, ImportSiteResult>;
  importSiteWorker: Worker<ImportSiteJobData, ImportSiteResult>;
  importFinalizeQueue: Queue<ImportFinalizeData>;
  importFinalizeWorker: Worker<ImportFinalizeData>;
}
```

Inside `startWorkers()`, add after the scheduler setup (before the `return`):

```typescript
  // Import site queue
  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  const importSiteQueue = createImportSiteQueue(connection);
  const importSiteWorker = createImportSiteWorker(connection, WORKER_CONCURRENCY, githubToken, networkRepo);

  importSiteQueue.on("error", (err) => {
    console.error(`[import-site-queue] Connection error: ${err.message}`);
  });
  importSiteWorker.on("error", (err) => {
    console.error(`[import-site-worker] Connection error: ${err.message}`);
  });
  importSiteWorker.on("failed", (job, err) => {
    console.error(`[import-site] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });
  importSiteWorker.on("completed", (job) => {
    console.log(`[import-site] Job ${job.id} completed for ${job.data.siteId}`);
  });

  console.log(`[worker] Import-site worker started (concurrency: ${WORKER_CONCURRENCY})`);

  // Import finalize queue
  const importFinalizeQueue = createImportFinalizeQueue(connection);
  const importFinalizeWorker = createImportFinalizeWorker(connection, githubToken, networkRepo);

  importFinalizeQueue.on("error", (err) => {
    console.error(`[import-finalize-queue] Connection error: ${err.message}`);
  });
  importFinalizeWorker.on("error", (err) => {
    console.error(`[import-finalize-worker] Connection error: ${err.message}`);
  });
  importFinalizeWorker.on("completed", (job) => {
    console.log(`[import-finalize] Batch ${job.data.batchId.slice(0, 8)} finalized`);
  });

  console.log("[worker] Import-finalize worker started");
```

Update the `return` to include the new fields:

```typescript
  return {
    connection,
    generateQueue,
    generateQueueEvents,
    generateWorker,
    flowProducer,
    schedulerRunWorker,
    schedulerRunQueue,
    importSiteQueue,
    importSiteWorker,
    importFinalizeQueue,
    importFinalizeWorker,
  };
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/index.ts
git commit -m "feat(import): wire up import-site and import-finalize queues"
```

---

### Task 7: Batch Submission Logic

**Files:**
- Create: `services/content-pipeline/src/agents/migration/batch-import.ts`
- Test: `services/content-pipeline/src/__tests__/migration/batch-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `services/content-pipeline/src/__tests__/migration/batch-import.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateBatch } from "../../agents/migration/batch-import.js";

describe("validateBatch", () => {
  it("rejects empty rows", () => {
    const result = validateBatch([]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("rejects batch exceeding max size", () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      "Site Name": `Site ${i}`,
      domain: `site${i}.com`,
    }));
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/200/);
  });

  it("detects duplicate domains within CSV", () => {
    const rows = [
      { "Site Name": "Site A", domain: "example.com" },
      { "Site Name": "Site B", domain: "example.com" },
    ];
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/duplicate/i);
  });

  it("rejects rows missing both name and domain", () => {
    const rows = [{ "Site Name": "", domain: "" }];
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it("passes valid batch", () => {
    const rows = [
      { "Site Name": "Site A", domain: "site-a.com" },
      { "Site Name": "Site B", domain: "site-b.com" },
    ];
    const result = validateBatch(rows);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/migration/batch-import.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement batch-import.ts**

Create `services/content-pipeline/src/agents/migration/batch-import.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { FlowProducer } from "bullmq";
import type { Redis } from "ioredis";
import type { JobsOptions } from "bullmq";
import {
  IMPORT_SITE_QUEUE,
  IMPORT_FINALIZE_QUEUE,
  MAX_IMPORT_BATCH_SIZE,
  DEFAULT_IMPORT_JOB_OPTIONS,
} from "../../queue/types.js";
import type { ImportSiteJobData, ImportFinalizeData } from "../../queue/types.js";
import { domainToSiteId } from "./site-scaffolder.js";
import { writeBatchMeta, writeSiteStatus } from "./import-status.js";

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate CSV rows before enqueuing.
 * Checks: non-empty, max size, no duplicates, every row has a name or domain.
 */
export function validateBatch(rows: Record<string, string>[]): ValidationResult {
  if (rows.length === 0) {
    return { ok: false, error: "CSV is empty — no rows to import" };
  }

  if (rows.length > MAX_IMPORT_BATCH_SIZE) {
    return {
      ok: false,
      error: `Batch too large: ${rows.length} rows exceeds maximum of ${MAX_IMPORT_BATCH_SIZE}`,
    };
  }

  // Check for missing identifiers
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const name = row["Site Name"]?.trim() || row["Name"]?.trim() || "";
    const domain = row["domain"]?.trim() || "";
    if (!name && !domain) {
      return { ok: false, error: `Row ${i + 1} is missing both "Site Name" and "domain"` };
    }
  }

  // Check for duplicate domains
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = row["domain"]?.trim() || row["Site Name"]?.trim() || "";
    const siteId = domainToSiteId(domain);
    if (seen.has(siteId)) {
      return { ok: false, error: `Duplicate domain in CSV: "${domain}" (siteId: ${siteId})` };
    }
    seen.add(siteId);
  }

  return { ok: true };
}

export interface SubmitBatchResult {
  batchId: string;
  total: number;
  siteIds: string[];
}

/**
 * Submit a validated batch of CSV rows as BullMQ jobs.
 *
 * Creates:
 * - One Redis hash with batch metadata + per-site "pending" status
 * - One BullMQ Flow: parent (finalize) + N children (per-site import)
 *
 * Returns the batch ID for polling.
 */
export async function submitBatch(
  rows: Record<string, string>[],
  flowProducer: FlowProducer,
  redis: Redis,
): Promise<SubmitBatchResult> {
  const batchId = randomUUID();
  const now = new Date().toISOString();

  // Compute siteIds
  const siteIds: string[] = [];
  const children: Array<{
    name: string;
    queueName: string;
    data: ImportSiteJobData;
    opts: JobsOptions;
  }> = [];

  for (const row of rows) {
    const domain = row["domain"]?.trim() || row["Site Name"]?.trim() || "";
    const siteId = domainToSiteId(domain);
    siteIds.push(siteId);

    children.push({
      name: `import-${siteId}`,
      queueName: IMPORT_SITE_QUEUE,
      data: { batchId, siteId, row },
      opts: DEFAULT_IMPORT_JOB_OPTIONS,
    });
  }

  // Write batch metadata to Redis
  await writeBatchMeta(redis, batchId, {
    total: rows.length,
    status: "pending",
    createdAt: now,
  });

  // Write initial "pending" status for each site
  for (const siteId of siteIds) {
    await writeSiteStatus(redis, batchId, siteId, { status: "pending" });
  }

  // Create the BullMQ Flow: parent finalize + child site imports
  await flowProducer.add({
    name: "import-finalize",
    queueName: IMPORT_FINALIZE_QUEUE,
    data: {
      batchId,
      siteIds,
    } satisfies ImportFinalizeData,
    opts: {
      jobId: `import-finalize-${batchId.slice(0, 8)}`,
    },
    children,
  });

  // Update batch status to running
  await writeBatchMeta(redis, batchId, {
    total: rows.length,
    status: "running",
    createdAt: now,
  });

  console.log(`[batch-import] Enqueued batch ${batchId.slice(0, 8)}: ${rows.length} sites`);

  return { batchId, total: rows.length, siteIds };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- src/__tests__/migration/batch-import.test.ts`
Expected: PASS

- [ ] **Step 5: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/migration/batch-import.ts services/content-pipeline/src/__tests__/migration/batch-import.test.ts
git commit -m "feat(import): add batch validation and submission logic"
```

---

### Task 8: Replace Handler with Batch Endpoints

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/handler.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

- [ ] **Step 1: Rewrite handleCreateSites in handler.ts**

Replace the `handleCreateSites` function (lines 164-372) with a non-streaming JSON handler that validates and enqueues.

Keep: lines 1-123 (`handleMigrationRequest` — unchanged, it handles article import not site creation).
Remove: `fetchImageAsBase64` (lines 144-156) — moved to `import-site.ts` in Task 4.
Remove: the old `CreateSiteResult` interface (lines 134-142) — no longer needed.

**Add the following imports at the top of the file** (alongside the existing imports on lines 1-11):

```typescript
import type { FlowProducer } from "bullmq";
import type { Redis } from "ioredis";
import { validateBatch, submitBatch } from "./batch-import.js";
import { readBatchStatus } from "./import-status.js";
```

**Note:** Also remove the now-unused imports: `resolveCategories`, `buildFullSiteConfig`, `buildSkillMd`, `generateAuthorName`, `domainToSiteId`, `commitBatch`, `readFile`, `parseRepo`, `parse`, `stringify`, and the `Octokit` import — these are all handled by `import-site.ts` and `import-finalize.ts` now. Keep the `sendSSE` function and `MigrationProgress`/`MigrationConfig`-related imports since `handleMigrationRequest` still uses them.

Then replace lines 125-372 with:

```typescript
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
```

**Important:** The `handleCreateSites` signature changes — it now takes `flowProducer` and `redis` as extra parameters. Update the call site in `index.ts` (next step). The `branch` field was accepted but never used by the old handler (branches are always `staging/<siteId>`) — it is intentionally removed from `CreateSitesRequestBody`.

- [ ] **Step 2: Update route registration in index.ts**

In `services/content-pipeline/src/agents/content-generation/index.ts`, update the handler calls around lines 423-431.

Find the existing route registration:
```typescript
if (req.method === "POST" && req.url === "/wp-migrate/create-sites") {
  await handleCreateSites(req, res);
}
```

Replace with (note the `queueInstances` null-checks and `return` statements — both are critical):
```typescript
if (req.method === "POST" && req.url === "/wp-migrate/create-sites") {
  if (!queueInstances) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Queue not configured — REDIS_URL not set" }));
    return;
  }
  await handleCreateSites(req, res, queueInstances.flowProducer, queueInstances.connection);
  return;
}
if (req.method === "GET" && req.url?.startsWith("/wp-migrate/import-status/")) {
  if (!queueInstances) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Queue not configured — REDIS_URL not set" }));
    return;
  }
  await handleImportStatus(req, res, queueInstances.connection);
  return;
}
```

**Important:** The `return` after each handler call prevents falling through to the 404 catch-all, which would cause `ERR_HTTP_HEADERS_SENT`. The `!queueInstances` guard prevents a crash when `REDIS_URL` is not set (matches the existing pattern at lines 94, 131, 269, 324 of the same file).

Also add `handleImportStatus` to the import from `handler.ts`:
```typescript
import { handleMigrationRequest, handleCreateSites, handleImportStatus } from "../migration/handler.js";
```

**Note:** `queueInstances` is already available in the HTTP handler closure (see existing code pattern around line 415 for how `queueInstances.generateQueue` is used).

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Run existing tests to make sure nothing broke**

Run: `cd services/content-pipeline && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/handler.ts services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(import): replace sequential SSE handler with batch enqueue + status polling"
```

---

### Task 9: Dashboard API Proxy Routes

**Files:**
- Modify: `services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts`
- Create: `services/dashboard/src/app/api/agent/wp-migrate/import-status/[batchId]/route.ts`

- [ ] **Step 1: Update create-sites proxy to return JSON**

Replace the contents of `services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts`:

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
    const response = await fetch(`${agentUrl}/wp-migrate/create-sites`, {
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

- [ ] **Step 2: Create import-status proxy route**

Create `services/dashboard/src/app/api/agent/wp-migrate/import-status/[batchId]/route.ts`:

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
  params: Promise<{ batchId: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { batchId } = await params;
  const agentUrl = getAgentUrl();

  try {
    const response = await fetch(
      `${agentUrl}/wp-migrate/import-status/${batchId}`,
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

- [ ] **Step 3: Verify dashboard typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/api/agent/wp-migrate/create-sites/route.ts services/dashboard/src/app/api/agent/wp-migrate/import-status/\[batchId\]/route.ts
git commit -m "feat(import): update dashboard proxy routes for batch import"
```

---

### Task 10: Frontend Polling UI

**Files:**
- Modify: `services/dashboard/src/components/import/CsvSiteCreator.tsx`

This is the largest frontend change. Replace SSE consumption with interval polling.

- [ ] **Step 1: Replace CsvSiteCreator.tsx**

Key changes:
1. Remove `consumeSSE` function and `SiteCreationEvent` type
2. Replace `handleCreate` to POST and receive `{ batchId }`, then start polling
3. Add `useEffect` polling loop that calls `/api/agent/wp-migrate/import-status/<batchId>`
4. Keep the table preview, results view, and article import functionality
5. Add a progress bar showing `completed / total`

Replace the component with:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ParsedSiteRow {
  raw: Record<string, string>;
  name: string;
  domain: string;
  category: string;
  menuItems: string;
  postsApi: string;
}

interface SiteStatus {
  siteId: string;
  status: "pending" | "running" | "complete" | "error";
  phase?: string;
  error?: string;
  warnings?: string[];
  previewUrl?: string;
  postsApiUrl?: string;
}

interface BatchStatus {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
  sites: SiteStatus[];
}

interface ArticleImportState {
  status: "idle" | "importing" | "complete" | "error";
  phase?: string;
  totalArticles?: number;
  processedArticles?: number;
  currentArticleSlug?: string;
  successful?: number;
  failed?: number;
  error?: string;
}

type ComponentPhase = "idle" | "creating" | "results";

// --- CSV parsing (unchanged) ---

function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    if (row["Site Name"]?.trim()) {
      rows.push(row);
    }
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const CSV_HEADERS = [
  "Site Name", "domain", "Company", "Website Category", "Menu Items",
  "IAB Top Categories (Vertical)", "Sub Categories", "Color Palette",
  "Logo", "Favicon", "Posts REST API (articles)", "GA Info",
];

const CSV_EXAMPLE_ROW = [
  "Cool News", "coolnews.dev", "ATL", "Technology", "Tech, Science, Reviews",
  "Technology & Computing", "Software, Hardware",
  "primary: #3B82F6, secondary: #1E40AF",
  "https://coolnews.dev/logo.png", "https://coolnews.dev/favicon.ico",
  "https://coolnews.dev/wp-json/wp/v2/posts", "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
];

const PHASE_LABELS: Record<string, string> = {
  "resolving-categories": "Resolving categories",
  "fetching-assets": "Fetching logo & favicon",
  "building-config": "Building site config",
  "creating-branch": "Creating staging branch",
  "committing": "Committing files",
};

function downloadTemplate(): void {
  const escapeCsvField = (field: string): string =>
    field.includes(",") || field.includes('"') ? `"${field.replace(/"/g, '""')}"` : field;

  const header = CSV_HEADERS.map(escapeCsvField).join(",");
  const example = CSV_EXAMPLE_ROW.map(escapeCsvField).join(",");
  const csv = `${header}\n${example}\n`;

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "site-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// --- SSE helper for article import (unchanged) ---

type ArticleImportEvent =
  | { type: "progress"; phase: string; totalArticles?: number; processedArticles?: number; currentArticleSlug?: string }
  | { type: "complete"; successful: number; failed: number }
  | { type: "error"; error: string };

async function consumeSSE<T>(
  response: Response,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          try { onEvent(JSON.parse(trimmed.slice(6)) as T); } catch { /* skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Polling interval ---
const POLL_INTERVAL_MS = 2000;

export function CsvSiteCreator(): React.ReactElement {
  const [sites, setSites] = useState<ParsedSiteRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [phase, setPhase] = useState<ComponentPhase>("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [articleImports, setArticleImports] = useState<Map<string, ArticleImportState>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const importAbortRefs = useRef<Map<string, AbortController>>(new Map());

  // --- Poll for batch status ---
  useEffect(() => {
    if (!batchId || phase !== "creating") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/wp-migrate/import-status/${batchId}`);
        if (!res.ok) return;
        const data = (await res.json()) as BatchStatus;
        setBatchStatus(data);

        if (data.status === "complete" || data.status === "failed") {
          setPhase("results");
        }
      } catch {
        // Silently retry on next interval
      }
    }, POLL_INTERVAL_MS);

    return (): void => clearInterval(interval);
  }, [batchId, phase]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBatchId(null);
    setBatchStatus(null);
    setError(null);
    setPhase("idle");
    setArticleImports(new Map());

    const reader = new FileReader();
    reader.onload = (ev): void => {
      const text = ev.target?.result as string;
      const rows = parseCsvText(text);

      if (rows.length === 0) {
        setError("No valid rows found. Make sure the CSV has a 'Site Name' column.");
        return;
      }

      setRawRows(rows);
      setSites(
        rows.map((r) => ({
          raw: r,
          name: r["Site Name"] ?? "",
          domain: r["domain"] ?? "",
          category: r["Website Category"] ?? "",
          menuItems: r["Menu Items"] ?? "",
          postsApi: r["Posts REST API (articles)"] ?? "",
        })),
      );
    };
    reader.readAsText(file);
  }, []);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (rawRows.length === 0) return;

    setPhase("creating");
    setError(null);
    setBatchStatus(null);
    setArticleImports(new Map());

    try {
      const res = await fetch("/api/agent/wp-migrate/create-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows }),
      });

      const data = (await res.json()) as { batchId?: string; error?: string };

      if (!res.ok || !data.batchId) {
        setError(data.error ?? `HTTP ${res.status}`);
        setPhase("idle");
        return;
      }

      setBatchId(data.batchId);
      // Polling starts via useEffect
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("idle");
    }
  }, [rawRows]);

  const handleImportArticles = useCallback(
    async (siteId: string, postsApiUrl: string): Promise<void> => {
      const existingController = importAbortRefs.current.get(siteId);
      existingController?.abort();

      const controller = new AbortController();
      importAbortRefs.current.set(siteId, controller);

      setArticleImports((prev) => {
        const next = new Map(prev);
        next.set(siteId, { status: "importing" });
        return next;
      });

      try {
        const res = await fetch("/api/agent/wp-migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteDomain: siteId,
            wpApiUrl: postsApiUrl,
            branch: `staging/${siteId}`,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          let msg = `HTTP ${res.status}`;
          try { const parsed = JSON.parse(text) as { error?: string }; if (parsed.error) msg = parsed.error; } catch { /* */ }
          setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "error", error: msg }); return next; });
          return;
        }

        await consumeSSE<ArticleImportEvent>(
          res,
          (event) => {
            if (event.type === "progress") {
              setArticleImports((prev) => {
                const next = new Map(prev);
                next.set(siteId, { status: "importing", phase: event.phase, totalArticles: event.totalArticles, processedArticles: event.processedArticles, currentArticleSlug: event.currentArticleSlug });
                return next;
              });
            } else if (event.type === "complete") {
              setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "complete", successful: event.successful, failed: event.failed }); return next; });
            } else if (event.type === "error") {
              setArticleImports((prev) => { const next = new Map(prev); next.set(siteId, { status: "error", error: event.error }); return next; });
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setArticleImports((prev) => {
          const next = new Map(prev);
          next.set(siteId, { status: "error", error: err instanceof Error ? err.message : "Unknown error" });
          return next;
        });
      } finally {
        importAbortRefs.current.delete(siteId);
      }
    },
    [],
  );

  const handleReset = useCallback((): void => {
    for (const controller of importAbortRefs.current.values()) {
      controller.abort();
    }
    importAbortRefs.current.clear();
    setSites([]);
    setRawRows([]);
    setBatchId(null);
    setBatchStatus(null);
    setPhase("idle");
    setArticleImports(new Map());
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const isCreating = phase === "creating";
  const completedSites = batchStatus?.sites.filter((s) => s.status === "complete") ?? [];
  const failedSites = batchStatus?.sites.filter((s) => s.status === "error") ?? [];
  const progressPercent = batchStatus
    ? Math.round(((batchStatus.completed + batchStatus.failed) / batchStatus.total) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Create Sites from CSV
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Upload a CSV export from the site spreadsheet. Each row becomes a site.yaml in the network repo.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleFile}
          disabled={isCreating}
          className="block text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyan/10 file:text-cyan hover:file:bg-cyan/20 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="shrink-0 text-sm text-[var(--text-secondary)] hover:text-cyan underline underline-offset-2 transition-colors"
        >
          Download template CSV
        </button>
      </div>

      {/* Preview table */}
      {sites.length > 0 && phase === "idle" && (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-secondary)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Site Name</th>
                  <th className="text-left px-3 py-2 font-medium">Domain</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-left px-3 py-2 font-medium">Menu Items</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s, i) => (
                  <tr key={i} className="border-t border-[var(--border-secondary)]">
                    <td className="px-3 py-2 text-[var(--text-tertiary)]">{i + 1}</td>
                    <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-xs">{s.domain}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{s.category}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] max-w-xs truncate">{s.menuItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create {sites.length} Sites on Staging
          </button>
        </>
      )}

      {/* Progress (polling-based) */}
      {phase === "creating" && batchStatus && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Creating {batchStatus.total} sites... ({batchStatus.completed + batchStatus.failed}/{batchStatus.total})
            </p>
            <span className="text-xs text-[var(--text-tertiary)]">{progressPercent}%</span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid gap-2 max-h-96 overflow-y-auto">
            {batchStatus.sites.map((site) => (
              <div
                key={site.siteId}
                className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-shrink-0">
                    {site.status === "pending" && <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-tertiary)]" />}
                    {site.status === "running" && <span className="inline-block w-2 h-2 rounded-full bg-cyan animate-pulse" />}
                    {site.status === "complete" && <span className="text-green-400">&#10003;</span>}
                    {site.status === "error" && <span className="text-red-400">&#10005;</span>}
                  </div>
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{site.siteId}</p>
                  {site.status === "running" && site.phase && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      {PHASE_LABELS[site.phase] ?? site.phase}
                    </span>
                  )}
                  {site.status === "error" && site.error && (
                    <span className="text-xs text-red-400 truncate">{site.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting for first poll */}
      {phase === "creating" && !batchStatus && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan animate-pulse" />
          <p className="text-sm text-[var(--text-secondary)]">Submitting import batch...</p>
        </div>
      )}

      {/* Results */}
      {phase === "results" && batchStatus && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {completedSites.length} of {batchStatus.total} sites created
              {failedSites.length > 0 && (
                <span className="text-red-400 ml-1">({failedSites.length} failed)</span>
              )}
            </p>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Upload Another CSV
            </button>
          </div>

          <div className="grid gap-3">
            {batchStatus.sites.map((site) => {
              const importState = articleImports.get(site.siteId);

              return (
                <div
                  key={site.siteId}
                  className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-4 py-3 space-y-2"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {site.status === "complete" ? (
                        <span className="text-green-400 text-lg">&#10003;</span>
                      ) : (
                        <span className="text-red-400 text-lg">&#10005;</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{site.siteId}</p>

                      {site.status === "error" && site.error && (
                        <p className="text-sm text-red-400 mt-1">{site.error}</p>
                      )}

                      {site.previewUrl && (
                        <a
                          href={site.previewUrl}
                          target="_blank"
                          rel="noopener"
                          className="inline-block text-xs text-cyan underline underline-offset-2 hover:text-cyan/80 mt-1"
                        >
                          Open staging preview
                        </a>
                      )}

                      {site.warnings && site.warnings.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {site.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-amber-400">{w}</p>
                          ))}
                        </div>
                      )}

                      {importState?.status === "importing" && (
                        <div className="mt-2 text-xs text-[var(--text-secondary)]">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan animate-pulse mr-1.5 align-middle" />
                          {importState.phase ?? "Starting import..."}
                          {importState.processedArticles != null && importState.totalArticles != null && (
                            <span className="ml-1">({importState.processedArticles}/{importState.totalArticles})</span>
                          )}
                        </div>
                      )}

                      {importState?.status === "complete" && (
                        <p className="mt-2 text-xs text-green-400">
                          {importState.successful ?? 0} articles imported
                          {(importState.failed ?? 0) > 0 && (
                            <span className="text-red-400 ml-1">({importState.failed} failed)</span>
                          )}
                        </p>
                      )}

                      {importState?.status === "error" && (
                        <p className="mt-2 text-xs text-red-400">{importState.error}</p>
                      )}
                    </div>

                    {site.status === "complete" && site.postsApiUrl && (
                      <div className="flex-shrink-0">
                        {(!importState || importState.status === "idle" || importState.status === "error") && (
                          <button
                            onClick={(): void => {
                              void handleImportArticles(site.siteId, site.postsApiUrl!);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-cyan hover:bg-cyan/90 transition-colors"
                          >
                            Import Articles
                          </button>
                        )}
                        {importState?.status === "importing" && (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-cyan bg-cyan/10">
                            Importing...
                          </span>
                        )}
                        {importState?.status === "complete" && (
                          <span className="px-3 py-1.5 rounded-lg text-xs font-medium text-green-400 bg-green-500/10">
                            Done
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify dashboard typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/import/CsvSiteCreator.tsx
git commit -m "feat(import): replace SSE with polling-based progress UI"
```

---

### Task 11: Graceful Shutdown for Import Workers

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

- [ ] **Step 1: Add import queue shutdown to the existing graceful shutdown handler**

Find the existing shutdown handler in `index.ts` (search for `SIGTERM` or `close`). Add the import workers to the cleanup list.

The existing shutdown pattern closes `generateWorker`, `schedulerRunWorker`, `generateQueue`, `schedulerRunQueue`, `generateQueueEvents`, `flowProducer`, and `connection`. Add the import instances:

```typescript
// Inside the shutdown handler, add:
await queueInstances.importSiteWorker.close();
await queueInstances.importFinalizeWorker.close();
await queueInstances.importSiteQueue.close();
await queueInstances.importFinalizeQueue.close();
```

- [ ] **Step 2: Run all tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: All tests pass

- [ ] **Step 3: Verify both services typecheck**

Run: `cd services/content-pipeline && pnpm typecheck && cd ../dashboard && pnpm typecheck`
Expected: No errors in either service

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(import): add graceful shutdown for import queue workers"
```

---

### Task 12: Integration Smoke Test

This task verifies the entire flow works end-to-end in the dev environment.

**Prerequisites:** Redis running (for BullMQ), both services running (`cloudgrid dev` or manual).

- [ ] **Step 1: Start services**

```bash
cloudgrid dev
```

Or manually:
```bash
cd services/content-pipeline && pnpm dev  # port 5000
cd services/dashboard && pnpm dev         # port 3001
```

- [ ] **Step 2: Test batch submission**

```bash
curl -s -X POST http://localhost:5000/wp-migrate/create-sites \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"Site Name":"Test Import","domain":"test-import-site.com","Website Category":"Technology","Menu Items":"Tech, Reviews"}],"branch":"staging"}' | jq .
```

Expected: `{ "batchId": "<uuid>", "total": 1 }`

- [ ] **Step 3: Test status polling**

Use the batchId from step 2:

```bash
curl -s http://localhost:5000/wp-migrate/import-status/<batchId> | jq .
```

Expected: JSON with `status`, `total`, `completed`, `failed`, `sites` array.

- [ ] **Step 4: Test validation (max size)**

```bash
curl -s -X POST http://localhost:5000/wp-migrate/create-sites \
  -H "Content-Type: application/json" \
  -d '{"rows":[],"branch":"staging"}' | jq .
```

Expected: `{ "error": "rows is required (non-empty array)" }`

- [ ] **Step 5: Test via dashboard UI**

1. Open `http://localhost:3001/import`
2. Upload a CSV with 2-3 test sites
3. Click "Create N Sites on Staging"
4. Verify progress bar appears and updates
5. Verify results appear after completion

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add -A  # Review staged files first
git commit -m "fix(import): integration test fixes"
```

---

## Appendix: What Changed vs Old Architecture

| Aspect | Before | After |
|--------|--------|-------|
| Processing model | Sequential HTTP request | BullMQ background jobs |
| Concurrency | 1 (serial loop) | 3 (configurable via `WORKER_CONCURRENCY`) |
| Progress delivery | SSE stream | JSON polling (2s interval) |
| Dashboard-index commits | 1 per site (N commits) | 1 total (batch commit in finalize job) |
| GitHub API resilience | Plain Octokit (no retry) | `@octokit/plugin-retry` + `@octokit/plugin-throttling` |
| HTTP timeout risk | Entire batch must finish within request | Immediate 202 response, background processing |
| Connection drop | Lost progress | Redis state survives, resume polling |
| Max batch size | Unbounded | 200 rows |
| Duplicate detection | None | Pre-flight validation |
| Per-site retry | None (catch + continue) | BullMQ retry (2 attempts, exponential backoff) |
| KV sync triggers | 1 commit per site during loop | Batched in finalize job |
