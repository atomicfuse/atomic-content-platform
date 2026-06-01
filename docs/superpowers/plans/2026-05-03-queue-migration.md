# Queue Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace synchronous HTTP request lifecycle for content generation with a durable BullMQ + Upstash Redis job queue, so jobs survive process restarts, retry on transient failures, and the scheduler can enqueue 100+ sites in seconds.

**Architecture:** Dashboard enqueues jobs directly to Redis via BullMQ. An in-process BullMQ Worker inside content-pipeline consumes jobs and calls the existing `runContentGeneration()` unchanged. Scheduler uses BullMQ Flows (parent `scheduler-run` with N child `generate` jobs); the parent processor writes history to GitHub once when all children complete.

**Tech Stack:** BullMQ 5.x, ioredis 5.x, Upstash Redis (persistent, `noeviction`), Vitest for testing.

**Spec:** `docs/developer-guide-content-generation.md`

---

## File Structure

### New files — content-pipeline

| File | Responsibility |
|------|---------------|
| `src/queue/types.ts` | `GenerateJobData`, `SchedulerRunData`, queue names, default job options |
| `src/queue/connection.ts` | IORedis connection factory (singleton, TLS for Upstash) |
| `src/queue/content-generation.ts` | Queue + Worker + QueueEvents for `content-generation`; `processGenerateJob` wrapper |
| `src/queue/scheduler-flow.ts` | FlowProducer for scheduler runs; parent `scheduler-run` worker + processor |
| `src/queue/index.ts` | Bootstrap function (`startWorkers`) + re-exports |
| `src/__tests__/process-generate-job.test.ts` | Tests for worker processor wrapper |
| `src/__tests__/scheduler-flow.test.ts` | Tests for flow creation + parent processor |

### New files — dashboard

| File | Responsibility |
|------|---------------|
| `src/lib/queue.ts` | Queue + QueueEvents instances for enqueue + `waitUntilFinished` |
| `src/app/api/agent/job/[id]/route.ts` | Job status polling (proxies to content-pipeline `/job/:id`) |
| `src/app/api/scheduler/active-run/route.ts` | Live scheduler run state (queries content-pipeline) |

### Modified files

| File | What changes |
|------|-------------|
| `services/content-pipeline/package.json` | Add `bullmq`, `ioredis` |
| `services/content-pipeline/src/lib/config.ts` | Add `redisUrl` to `AgentConfig` |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Add `/job/:id` endpoint, start workers, graceful shutdown |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | `runScheduledPublish` creates Flow instead of direct calls |
| `services/dashboard/package.json` | Add `bullmq`, `ioredis` |
| `services/dashboard/src/app/api/agent/generate/route.ts` | Enqueue + `waitUntilFinished(90s)` + 202 fallback |
| `cloudgrid.yaml` | Document `REDIS_URL` secret |

---

## Phase 1: Infrastructure (Migration Step 1)

> Deploy after this phase. Verify: Redis reachable, Bull Board accessible (if wired), no behavior change.

---

### Task 1: Add dependencies

**Files:**
- Modify: `services/content-pipeline/package.json`
- Modify: `services/dashboard/package.json`

- [ ] **Step 1: Install content-pipeline deps**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm add bullmq ioredis
```

- [ ] **Step 2: Install dashboard deps**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard
pnpm add bullmq ioredis
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS (new deps don't break existing types)

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/package.json services/content-pipeline/pnpm-lock.yaml \
       services/dashboard/package.json services/dashboard/pnpm-lock.yaml \
       pnpm-lock.yaml
git commit -m "chore: add bullmq and ioredis dependencies for queue migration"
```

---

### Task 2: Queue types and Redis connection

**Files:**
- Create: `services/content-pipeline/src/queue/types.ts`
- Create: `services/content-pipeline/src/queue/connection.ts`
- Modify: `services/content-pipeline/src/lib/config.ts`

- [ ] **Step 1: Create queue types**

```typescript
// services/content-pipeline/src/queue/types.ts
import type { JobsOptions } from "bullmq";

export interface GenerateJobData {
  siteDomain: string;
  count: number;
  branch: string;
  runId?: string;
  triggeredBy: "manual" | "scheduled" | "scheduled-forced";
}

export interface SchedulerRunData {
  runId: string;
  timezone: string;
  forced: boolean;
  /** Domains that were enqueued as child generate jobs. */
  enqueuedDomains: string[];
  skipped: Array<{ domain: string; reason: string }>;
}

export const GENERATE_QUEUE = "content-generation";
export const SCHEDULER_RUN_QUEUE = "scheduler-run";

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
```

- [ ] **Step 2: Create Redis connection module**

```typescript
// services/content-pipeline/src/queue/connection.ts
import Redis from "ioredis";

/**
 * Create an IORedis connection for BullMQ.
 *
 * Upstash requires TLS (`rediss://` protocol).
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}
```

- [ ] **Step 3: Add `redisUrl` to AgentConfig**

In `services/content-pipeline/src/lib/config.ts`, add `redisUrl` field:

```typescript
// Add to AgentConfig interface:
redisUrl: string | undefined;

// Add to loadConfig() return object:
redisUrl: process.env.REDIS_URL,
```

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/queue/types.ts \
       services/content-pipeline/src/queue/connection.ts \
       services/content-pipeline/src/lib/config.ts
git commit -m "feat(queue): add queue types, Redis connection, and redisUrl config"
```

---

### Task 3: Queue module with stub worker

**Files:**
- Create: `services/content-pipeline/src/queue/content-generation.ts`
- Create: `services/content-pipeline/src/queue/index.ts`

- [ ] **Step 1: Create content-generation queue module**

```typescript
// services/content-pipeline/src/queue/content-generation.ts
import { Queue, Worker, QueueEvents } from "bullmq";
import type Redis from "ioredis";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";

export function createGenerateQueue(
  connection: Redis,
): Queue<GenerateJobData, BatchContentGenerationResult> {
  return new Queue(GENERATE_QUEUE, { connection });
}

export function createGenerateQueueEvents(connection: Redis): QueueEvents {
  return new QueueEvents(GENERATE_QUEUE, { connection });
}

export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker(
    GENERATE_QUEUE,
    async () => {
      throw new Error("Queue not yet wired — stub processor");
    },
    { connection, concurrency },
  );
}
```

- [ ] **Step 2: Create queue index with bootstrap**

```typescript
// services/content-pipeline/src/queue/index.ts
import type Redis from "ioredis";
import { Queue, type Worker, type QueueEvents, type FlowProducer } from "bullmq";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import type { GenerateJobData, SchedulerRunData } from "./types.js";
import { SCHEDULER_RUN_QUEUE } from "./types.js";
import { createRedisConnection } from "./connection.js";
import {
  createGenerateQueue,
  createGenerateQueueEvents,
  createGenerateWorker,
} from "./content-generation.js";

export type { GenerateJobData } from "./types.js";
export { GENERATE_QUEUE, SCHEDULER_RUN_QUEUE, DEFAULT_JOB_OPTIONS } from "./types.js";
export type { SchedulerRunData } from "./types.js";

export interface QueueInstances {
  connection: Redis;
  generateQueue: Queue<GenerateJobData, BatchContentGenerationResult>;
  generateQueueEvents: QueueEvents;
  generateWorker: Worker<GenerateJobData, BatchContentGenerationResult>;
}

const WORKER_CONCURRENCY = 3;

/**
 * Start all queue workers. Called once at server boot.
 * Returns queue instances for the HTTP server to use (enqueue, job lookup).
 */
export function startWorkers(redisUrl: string): QueueInstances {
  const connection = createRedisConnection(redisUrl);

  const generateQueue = createGenerateQueue(connection);
  const generateQueueEvents = createGenerateQueueEvents(connection);
  const generateWorker = createGenerateWorker(connection, WORKER_CONCURRENCY);

  generateWorker.on("failed", (job, err) => {
    console.error(
      `[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
  });

  generateWorker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed for ${job.data.siteDomain}`);
  });

  console.log(`[worker] Content-generation worker started (concurrency: ${WORKER_CONCURRENCY})`);

  return { connection, generateQueue, generateQueueEvents, generateWorker };
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/queue/content-generation.ts \
       services/content-pipeline/src/queue/index.ts
git commit -m "feat(queue): add content-generation queue module with stub worker"
```

---

### Task 4: HTTP server integration

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

Wire worker startup, add `/job/:id` endpoint, add graceful shutdown.

- [ ] **Step 1: Add queue startup + /job/:id + shutdown**

After the config loading block (line 124) and before `server.listen`, add:

```typescript
import { startWorkers } from "../../queue/index.js";
import type { QueueInstances } from "../../queue/index.js";
```

At the top of the file (with other imports).

After config loads (after line 124), conditionally start workers:

```typescript
let queueInstances: QueueInstances | undefined;
if (config.redisUrl) {
  queueInstances = startWorkers(config.redisUrl);
} else {
  console.log("[server] REDIS_URL not set — queue workers disabled (direct execution mode)");
}
```

In `handleRequest`, add the `/job/:id` route before the `POST /content-generate` check:

```typescript
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
```

Add graceful shutdown after `server.listen`:

```typescript
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  if (queueInstances) {
    await queueInstances.generateWorker.close();
    await queueInstances.generateQueueEvents.close();
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
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Run existing tests to confirm no regression**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test
```

Expected: All existing tests pass (queue code is only loaded if `REDIS_URL` is set)

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(queue): integrate worker boot, /job/:id endpoint, graceful shutdown"
```

---

### Task 5: Dashboard queue client

**Files:**
- Create: `services/dashboard/src/lib/queue.ts`

- [ ] **Step 1: Create dashboard queue module**

```typescript
// services/dashboard/src/lib/queue.ts
import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";

const GENERATE_QUEUE = "content-generation";

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

let _connection: Redis | null = null;
function getConnection(): Redis {
  if (!_connection) {
    _connection = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }
  return _connection;
}

let _queue: Queue | null = null;
export function getGenerateQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(GENERATE_QUEUE, { connection: getConnection() });
  }
  return _queue;
}

let _events: QueueEvents | null = null;
export function getGenerateQueueEvents(): QueueEvents {
  if (!_events) {
    _events = new QueueEvents(GENERATE_QUEUE, { connection: getConnection() });
  }
  return _events;
}
```

- [ ] **Step 2: Verify dashboard typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/queue.ts
git commit -m "feat(dashboard): add queue client module for BullMQ enqueue + waitUntilFinished"
```

---

### Task 6: Update cloudgrid.yaml + Phase 1 commit

**Files:**
- Modify: `cloudgrid.yaml`

- [ ] **Step 1: Add REDIS_URL documentation to cloudgrid.yaml**

Add `REDIS_URL` to the secrets comments for both services:

```yaml
  dashboard:
    # Secrets: NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_TOKEN,
    #   GOOGLE_SERVICE_ACCOUNT_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, REDIS_URL

  content-pipeline:
    # Secrets: GITHUB_TOKEN, GEMINI_API_KEY, REDIS_URL
```

- [ ] **Step 2: Commit Phase 1**

```bash
git add cloudgrid.yaml
git commit -m "docs: document REDIS_URL secret in cloudgrid.yaml for queue migration"
```

- [ ] **Step 3: Deploy and verify (manual)**

After deploying:
1. Set `REDIS_URL` via `cloudgrid secrets set atomic-content-platform REDIS_URL=rediss://...`
2. Check `/health` returns 200
3. Check logs show `[worker] Content-generation worker started (concurrency: 3)`
4. Verify no jobs enqueued (existing flows unchanged)

---

## Phase 2: Manual Generation (Migration Step 2)

> Deploy after this phase. Verify: click Generate on a site, job appears in logs, result returns within 90s.

---

### Task 7: Worker processor wrapper (TDD)

**Files:**
- Create: `services/content-pipeline/src/__tests__/process-generate-job.test.ts`
- Modify: `services/content-pipeline/src/queue/content-generation.ts`

This is the most critical piece — the wrapper that translates between BullMQ's throw-to-fail contract and `runContentGeneration`'s return-error contract.

- [ ] **Step 1: Write failing tests**

```typescript
// services/content-pipeline/src/__tests__/process-generate-job.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { GenerateJobData } from "../queue/types.js";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockReadSiteBriefWithFallback = vi.fn();
const mockRunContentGeneration = vi.fn();
const mockCreateGitHubClient = vi.fn().mockReturnValue({});

vi.mock("../lib/site-brief.js", () => ({
  readSiteBriefWithFallback: (...args: unknown[]): unknown =>
    mockReadSiteBriefWithFallback(...args),
}));

vi.mock("../agents/content-generation/agent.js", () => ({
  runContentGeneration: (...args: unknown[]): unknown =>
    mockRunContentGeneration(...args),
}));

vi.mock("../lib/github.js", () => ({
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateGitHubClient(...args),
}));

import { processGenerateJob } from "../queue/content-generation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJob(overrides: Partial<GenerateJobData> = {}): Job<GenerateJobData> {
  return {
    data: {
      siteDomain: "test.com",
      count: 3,
      branch: "staging/test.com",
      triggeredBy: "manual" as const,
      ...overrides,
    },
  } as Job<GenerateJobData>;
}

function makeConfig(): AgentConfig {
  return {
    github: { token: "ghp_test", repo: "owner/repo" },
    networkRepo: "owner/repo",
    localNetworkPath: undefined,
    geminiApiKey: undefined,
    contentAggregatorUrl: "https://example.com",
    port: 3001,
    redisUrl: "redis://localhost:6379",
    notifications: {},
  } as AgentConfig;
}

function makeBriefResult(hasSchedule = true): unknown {
  return {
    data: {
      domain: "test.com",
      siteName: "Test Site",
      group: "default",
      brief: {
        topics: ["tech"],
        ...(hasSchedule
          ? { schedule: { articles_per_day: 3, preferred_days: ["monday"] } }
          : {}),
      },
    },
    branch: "staging/test.com",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("processGenerateJob", () => {
  const config = makeConfig();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnrecoverableError when site brief not found", async () => {
    mockReadSiteBriefWithFallback.mockRejectedValue(new Error("Not found"));

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      UnrecoverableError,
    );
    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      /not found/i,
    );
    // runContentGeneration should NOT be called (no LLM spend wasted)
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when brief has no schedule", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult(false));

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      UnrecoverableError,
    );
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  it("throws Error when all articles fail (triggers BullMQ retry)", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue({
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      results: [
        { status: "error", message: "LLM timeout" },
        { status: "error", message: "LLM timeout" },
      ],
    });

    await expect(processGenerateJob(makeJob(), config)).rejects.toThrow(
      /All 2 articles failed/,
    );
    // NOT an UnrecoverableError — BullMQ should retry
    try {
      await processGenerateJob(makeJob(), config);
    } catch (err) {
      expect(err).not.toBeInstanceOf(UnrecoverableError);
    }
  });

  it("returns result on full success", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      results: [
        { status: "created", slug: "article-1" },
        { status: "created", slug: "article-2" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
  });

  it("returns result on partial success (does not throw)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      results: [
        { status: "created", slug: "good-article" },
        { status: "error", message: "one failed" },
      ],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
    // Partial success = job succeeded, no retry
  });

  it("returns result when no items sourced (empty results)", async () => {
    const mockResult = {
      siteDomain: "test.com",
      requested: 3,
      totalSourced: 0,
      duplicateCount: 0,
      availableNew: 0,
      results: [],
    };
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue(mockResult);

    const result = await processGenerateJob(makeJob(), config);
    expect(result).toBe(mockResult);
    // Zero results = agent completed normally, not a failure
  });

  it("passes correct params to runContentGeneration", async () => {
    mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
    mockRunContentGeneration.mockResolvedValue({
      siteDomain: "test.com",
      requested: 5,
      totalSourced: 5,
      duplicateCount: 0,
      availableNew: 5,
      results: [{ status: "created", slug: "a" }],
    });

    await processGenerateJob(
      makeJob({ siteDomain: "mysite.dev", count: 5, branch: "staging/mysite.dev" }),
      config,
    );

    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "mysite.dev", branch: "staging/mysite.dev", count: 5 },
      config,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test src/__tests__/process-generate-job.test.ts
```

Expected: FAIL — `processGenerateJob` is not exported yet (or is the stub)

- [ ] **Step 3: Implement processGenerateJob**

Replace the stub processor in `services/content-pipeline/src/queue/content-generation.ts`:

```typescript
// Add imports at top:
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import { createGitHubClient } from "../lib/github.js";
import { readSiteBriefWithFallback } from "../lib/site-brief.js";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

/**
 * BullMQ worker processor for content generation jobs.
 *
 * Wraps `runContentGeneration` with:
 * 1. Pre-flight checks that throw UnrecoverableError (no LLM spend wasted)
 * 2. Result inspection that surfaces total failures to BullMQ for retry
 *
 * `runContentGeneration` itself never throws — it returns error results.
 * This wrapper bridges that contract with BullMQ's throw-to-fail model.
 */
export async function processGenerateJob(
  job: Job<GenerateJobData>,
  config: AgentConfig,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = job.data;

  // Pre-flight: verify site exists and has a schedule
  const octokit = createGitHubClient(config.github);
  let briefData;
  try {
    briefData = await readSiteBriefWithFallback(
      octokit,
      config.networkRepo,
      siteDomain,
      branch,
    );
  } catch {
    throw new UnrecoverableError(
      `Site "${siteDomain}" not found — no brief in staging or main`,
    );
  }

  if (!briefData.data.brief?.schedule) {
    throw new UnrecoverableError(
      `No publishing schedule for ${siteDomain}`,
    );
  }

  // Run the agent (never throws — returns error results)
  const result = await runContentGeneration(
    { siteDomain, branch, count },
    config,
  );

  // Surface total failure to BullMQ for retry
  const created = result.results.filter((r) => r.status === "created").length;
  if (created === 0 && result.results.length > 0) {
    throw new Error(
      `All ${result.results.length} articles failed for ${siteDomain}`,
    );
  }

  return result;
}
```

Also update `createGenerateWorker` to accept a config parameter and use the real processor:

```typescript
export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
  config: AgentConfig,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker(
    GENERATE_QUEUE,
    async (job) => processGenerateJob(job, config),
    { connection, concurrency },
  );
}
```

Update `queue/index.ts` to pass config to `createGenerateWorker`:

```typescript
// In startWorkers, add config parameter:
export function startWorkers(redisUrl: string, config: AgentConfig): QueueInstances {
  // ...
  const generateWorker = createGenerateWorker(connection, WORKER_CONCURRENCY, config);
  // ...
}
```

Update the call in `index.ts` to pass config:

```typescript
queueInstances = startWorkers(config.redisUrl, config);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test src/__tests__/process-generate-job.test.ts
```

Expected: All 7 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test
```

Expected: All tests pass (existing + new)

- [ ] **Step 6: Typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/queue/content-generation.ts \
       services/content-pipeline/src/queue/index.ts \
       services/content-pipeline/src/agents/content-generation/index.ts \
       services/content-pipeline/src/__tests__/process-generate-job.test.ts
git commit -m "feat(queue): implement processGenerateJob wrapper with TDD

Wraps runContentGeneration with pre-flight UnrecoverableError checks
and total-failure detection for BullMQ retry."
```

---

### Task 8: Dashboard generate route migration

**Files:**
- Modify: `services/dashboard/src/app/api/agent/generate/route.ts`

- [ ] **Step 1: Rewrite generate route to enqueue + waitUntilFinished**

Replace the entire file:

```typescript
// services/dashboard/src/app/api/agent/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getGenerateQueue, getGenerateQueueEvents } from "@/lib/queue";

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// Fallback: if REDIS_URL is not set, proxy to content-pipeline directly (pre-migration mode)
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

/**
 * POST /api/agent/generate
 *
 * If REDIS_URL is set: enqueue to BullMQ, wait up to 90s, return result or 202.
 * If REDIS_URL is not set: fall back to direct HTTP proxy (pre-migration).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain: string;
    branch?: string | null;
    count?: number | null;
  };

  if (!body.siteDomain) {
    return NextResponse.json(
      { status: "error", message: "siteDomain is required" },
      { status: 400 },
    );
  }

  // If Redis not configured, fall back to direct HTTP proxy
  if (!process.env.REDIS_URL) {
    return proxyToAgent(body);
  }

  // Enqueue to BullMQ
  const queue = getGenerateQueue();
  const job = await queue.add(
    "generate",
    {
      siteDomain: body.siteDomain,
      count: body.count ?? 3,
      branch: body.branch ?? `staging/${body.siteDomain}`,
      triggeredBy: "manual" as const,
    },
    DEFAULT_JOB_OPTIONS,
  );

  // Wait up to 90s for completion
  const queueEvents = getGenerateQueueEvents();
  try {
    const result = await job.waitUntilFinished(queueEvents, 90_000);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Timeout: job still running, return 202 with jobId for polling
    if (message.includes("timed out") || message.includes("timeout")) {
      return NextResponse.json(
        { status: "running", jobId: job.id },
        { status: 202 },
      );
    }

    // Job failed (BullMQ propagates failedReason)
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}

/** Pre-migration fallback: proxy to content-pipeline HTTP endpoint */
async function proxyToAgent(body: {
  siteDomain: string;
  branch?: string | null;
  count?: number | null;
}): Promise<NextResponse> {
  const agentUrl = getAgentUrl();
  try {
    const agentResponse = await fetch(`${agentUrl}/content-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: body.siteDomain,
        ...(body.branch ? { branch: body.branch } : {}),
        ...(body.count ? { count: body.count } : {}),
      }),
    });
    const result = (await agentResponse.json()) as Record<string, unknown>;
    return NextResponse.json(result, { status: agentResponse.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify dashboard typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/agent/generate/route.ts
git commit -m "feat(dashboard): migrate generate route to BullMQ enqueue with 90s waitUntilFinished

Falls back to direct HTTP proxy if REDIS_URL is not set."
```

---

### Task 9: Dashboard job status polling route

**Files:**
- Create: `services/dashboard/src/app/api/agent/job/[id]/route.ts`

- [ ] **Step 1: Create job status route**

```typescript
// services/dashboard/src/app/api/agent/job/[id]/route.ts
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

/**
 * GET /api/agent/job/[id]
 *
 * Proxies to content-pipeline's /job/:id endpoint for job status polling.
 * Used when the generate route returns 202 (job still running after 90s).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const agentUrl = getAgentUrl();

  try {
    const resp = await fetch(`${agentUrl}/job/${id}`);
    const result = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(result, { status: resp.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { status: "error", message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit Phase 2**

```bash
git add services/dashboard/src/app/api/agent/job/
git commit -m "feat(dashboard): add /api/agent/job/[id] route for job status polling"
```

- [ ] **Step 4: Deploy + verify Phase 2 (manual)**

After deploying:
1. Set `REDIS_URL` on both services
2. Navigate to a site in the dashboard
3. Click Generate — should see job logged in content-pipeline console
4. Result should return within 90s (same UX as before)
5. Check content-pipeline logs for `[worker] Job <id> completed for <domain>`

---

## Phase 3: Scheduled Publish (Migration Step 3)

> Deploy after this phase. Verify: Run Now triggers fast enqueue, workers process, history written to GitHub.

---

### Task 10: Scheduler flow producer + parent processor (TDD)

**Files:**
- Create: `services/content-pipeline/src/__tests__/scheduler-flow.test.ts`
- Create: `services/content-pipeline/src/queue/scheduler-flow.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// services/content-pipeline/src/__tests__/scheduler-flow.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFlowProducerAdd = vi.fn();
const mockGetChildrenValues = vi.fn();
const mockReadHistory = vi.fn();
const mockCommitFile = vi.fn();
const mockCreateGitHubClient = vi.fn().mockReturnValue({});

vi.mock("bullmq", () => ({
  FlowProducer: vi.fn().mockImplementation(() => ({
    add: (...args: unknown[]): unknown => mockFlowProducerAdd(...args),
  })),
  Queue: vi.fn(),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  QueueEvents: vi.fn(),
  UnrecoverableError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "UnrecoverableError";
    }
  },
}));

vi.mock("../lib/github.js", () => ({
  createGitHubClient: (...args: unknown[]): unknown =>
    mockCreateGitHubClient(...args),
  readFile: (...args: unknown[]): unknown => mockReadHistory(...args),
  commitFile: (...args: unknown[]): unknown => mockCommitFile(...args),
}));

import {
  createSchedulerFlow,
  processSchedulerRun,
  buildRunId,
} from "../queue/scheduler-flow.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(): AgentConfig {
  return {
    github: { token: "ghp_test", repo: "owner/repo" },
    networkRepo: "owner/repo",
    localNetworkPath: undefined,
    geminiApiKey: undefined,
    contentAggregatorUrl: "https://example.com",
    port: 3001,
    redisUrl: "redis://localhost:6379",
    notifications: {},
  } as AgentConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("buildRunId", () => {
  it("returns ISO string truncated to hour", () => {
    const id = buildRunId();
    // Format: "2026-05-03T14" (13 chars)
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});

describe("createSchedulerFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlowProducerAdd.mockResolvedValue({ job: { id: "parent-1" } });
  });

  it("creates a flow with parent + N children", async () => {
    const sites = [
      { domain: "alpha.com", branch: "staging/alpha.com", count: 3 },
      { domain: "beta.com", branch: "staging/beta.com", count: 2 },
    ];

    const result = await createSchedulerFlow(
      {} as any, // flow producer mock is injected via vi.mock
      "2026-05-03T14",
      "UTC",
      false,
      sites,
      [],
    );

    expect(mockFlowProducerAdd).toHaveBeenCalledTimes(1);
    const call = mockFlowProducerAdd.mock.calls[0]!;
    const flowDef = call[0] as Record<string, unknown>;
    expect(flowDef.name).toBe("scheduler-run");
    expect(flowDef.queueName).toBe("scheduler-run");

    // Parent data
    const parentData = (flowDef.data as Record<string, unknown>);
    expect(parentData.runId).toBe("2026-05-03T14");
    expect(parentData.forced).toBe(false);
    expect(parentData.enqueuedDomains).toEqual(["alpha.com", "beta.com"]);

    // Children
    const children = flowDef.children as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    expect((children[0]!.data as Record<string, string>).siteDomain).toBe("alpha.com");
    expect((children[1]!.data as Record<string, string>).siteDomain).toBe("beta.com");
  });

  it("uses deterministic jobId to prevent double-enqueue", async () => {
    await createSchedulerFlow(
      {} as any,
      "2026-05-03T14",
      "UTC",
      false,
      [{ domain: "a.com", branch: "staging/a.com", count: 1 }],
      [],
    );

    const call = mockFlowProducerAdd.mock.calls[0]!;
    const flowDef = call[0] as Record<string, unknown>;
    const opts = flowDef.opts as Record<string, unknown>;
    expect(opts.jobId).toBe("scheduler-run-2026-05-03T14");
  });

  it("includes skipped sites in parent data", async () => {
    const skipped = [
      { domain: "skip.com", reason: "no schedule" },
    ];

    await createSchedulerFlow(
      {} as any,
      "2026-05-03T14",
      "UTC",
      false,
      [],
      skipped,
    );

    const call = mockFlowProducerAdd.mock.calls[0]!;
    const parentData = ((call[0] as Record<string, unknown>).data as Record<string, unknown>);
    expect(parentData.skipped).toEqual(skipped);
  });
});

describe("processSchedulerRun", () => {
  const config = makeConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadHistory.mockRejectedValue(new Error("Not Found"));
    mockCommitFile.mockResolvedValue("sha-ok");
  });

  it("writes history entry with child results", async () => {
    // Children return BatchContentGenerationResult, not SiteRunResult.
    // The parent processor maps these to SiteRunResult internally.
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "alpha.com",
        requested: 3,
        totalSourced: 5,
        duplicateCount: 2,
        availableNew: 3,
        results: [
          { status: "created", slug: "a" },
          { status: "created", slug: "b" },
          { status: "created", slug: "c" },
        ],
      },
      "bull:content-generation:child-2": {
        siteDomain: "beta.com",
        requested: 2,
        totalSourced: 3,
        duplicateCount: 1,
        availableNew: 2,
        results: [
          { status: "error", slug: "x", message: "LLM timeout" },
          { status: "error", slug: "y", message: "rate limited" },
        ],
      },
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T14",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["alpha.com", "beta.com"],
        skipped: [{ domain: "gamma.com", reason: "no schedule" }],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as any, config);

    expect(mockCommitFile).toHaveBeenCalledTimes(1);
    const commitArg = mockCommitFile.mock.calls[0]![2] as {
      content: string;
      path: string;
    };
    expect(commitArg.path).toBe("scheduler/history.json");

    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string }>;
      skipped: Array<{ domain: string }>;
      timestamp: string;
    }>;
    expect(written).toHaveLength(1);
    expect(written[0]!.timestamp).toBe("2026-05-03T14");
    expect(written[0]!.sites).toHaveLength(2);
    // alpha.com: 3 created, 0 errors → "success"
    expect(written[0]!.sites[0]!.domain).toBe("alpha.com");
    expect(written[0]!.sites[0]!.status).toBe("success");
    // beta.com: 0 created, 2 errors → "error"
    expect(written[0]!.sites[1]!.domain).toBe("beta.com");
    expect(written[0]!.sites[1]!.status).toBe("error");
    expect(written[0]!.skipped).toHaveLength(1);
    expect(written[0]!.skipped[0]!.domain).toBe("gamma.com");
  });

  it("records permanently failed children as error in history", async () => {
    // Only alpha.com completed — delta.com's child job failed permanently
    const childrenValues = {
      "bull:content-generation:child-1": {
        siteDomain: "alpha.com",
        requested: 2,
        totalSourced: 3,
        duplicateCount: 1,
        availableNew: 2,
        results: [
          { status: "created", slug: "a" },
          { status: "created", slug: "b" },
        ],
      },
      // delta.com is NOT here — its child job permanently failed
    };
    mockGetChildrenValues.mockResolvedValue(childrenValues);

    const job = {
      data: {
        runId: "2026-05-03T15",
        timezone: "UTC",
        forced: false,
        enqueuedDomains: ["alpha.com", "delta.com"],
        skipped: [],
      },
      getChildrenValues: mockGetChildrenValues,
    };

    await processSchedulerRun(job as any, config);

    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string };
    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string; status: string; message?: string }>;
    }>;
    expect(written[0]!.sites).toHaveLength(2);
    // alpha.com completed successfully
    expect(written[0]!.sites[0]!.domain).toBe("alpha.com");
    expect(written[0]!.sites[0]!.status).toBe("success");
    // delta.com failed — recorded from enqueuedDomains diff
    expect(written[0]!.sites[1]!.domain).toBe("delta.com");
    expect(written[0]!.sites[1]!.status).toBe("error");
    expect(written[0]!.sites[1]!.message).toContain("failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test src/__tests__/scheduler-flow.test.ts
```

Expected: FAIL — `scheduler-flow.ts` doesn't exist yet

- [ ] **Step 3: Implement scheduler-flow.ts**

```typescript
// services/content-pipeline/src/queue/scheduler-flow.ts
import { FlowProducer, Worker, QueueEvents } from "bullmq";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { createGitHubClient, readFile, commitFile } from "../lib/github.js";
import type { AgentConfig } from "../lib/config.js";
import type { SiteRunResult } from "../agents/scheduled-publisher/history.js";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import {
  GENERATE_QUEUE,
  SCHEDULER_RUN_QUEUE,
  DEFAULT_JOB_OPTIONS,
} from "./types.js";
import type { GenerateJobData, SchedulerRunData } from "./types.js";

const HISTORY_PATH = "scheduler/history.json";
const MAX_ENTRIES = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
}

/**
 * Create a BullMQ Flow: one parent `scheduler-run` job with N child `generate` jobs.
 * Uses deterministic `jobId` to prevent double-enqueue from overlapping cron ticks.
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
      enqueuedDomains: sites.map((s) => s.domain),
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
  const childrenValues = await job.getChildrenValues() as Record<string, BatchContentGenerationResult | null>;
  const sites: SiteRunResult[] = [];
  for (const [, genResult] of Object.entries(childrenValues)) {
    if (!genResult) continue;

    const created = genResult.results.filter((r) => r.status === "created").length;
    const genErrors = genResult.results.filter((r) => r.status === "error");
    let siteStatus: SiteRunResult["status"];
    let siteMessage: string | undefined;

    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      siteMessage = "Aggregator returned 0 items for this site's topics";
    } else if (created === 0 && genErrors.length > 0) {
      siteStatus = "error";
      siteMessage = genErrors.map((e) => e.message ?? e.reason ?? "unknown").join("; ");
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
  for (const domain of enqueuedDomains) {
    if (!completedDomains.has(domain)) {
      sites.push({
        domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: 0,
        message: "Child job failed (all retries exhausted)",
      });
    }
  }

  // Build history entry
  const entry = {
    timestamp: runId,
    timezone,
    forced,
    sites,
    skipped,
  };

  // Write to GitHub
  const octokit = createGitHubClient(config.github);
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

  const schedulerRunWorker = new Worker<SchedulerRunData>(
    SCHEDULER_RUN_QUEUE,
    async (job) => processSchedulerRun(job, config),
    { connection },
  );

  schedulerRunWorker.on("failed", (job, err) => {
    console.error(
      `[scheduler-run] Parent job ${job?.id} failed: ${err.message}`,
    );
  });

  schedulerRunWorker.on("completed", (job) => {
    console.log(`[scheduler-run] Run ${job.data.runId} completed`);
  });

  return { flowProducer, schedulerRunWorker };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test src/__tests__/scheduler-flow.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/queue/scheduler-flow.ts \
       services/content-pipeline/src/__tests__/scheduler-flow.test.ts
git commit -m "feat(queue): implement scheduler flow producer + parent history processor

Uses BullMQ Flows: parent scheduler-run job with N child generate jobs.
Parent writes history to GitHub once when all children complete.
Deterministic jobId prevents overlapping scheduler runs."
```

---

### Task 11: Wire scheduled-publisher to create Flow

**Files:**
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts`
- Modify: `services/content-pipeline/src/queue/index.ts`

- [ ] **Step 1: Add scheduler flow to queue bootstrap**

Update `services/content-pipeline/src/queue/index.ts`:

Add imports:
```typescript
import {
  setupSchedulerFlow,
} from "./scheduler-flow.js";
import type { SchedulerFlowInstances } from "./scheduler-flow.js";
```

Add to `QueueInstances`:
```typescript
export interface QueueInstances {
  // ... existing fields ...
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
  schedulerRunQueue: Queue<SchedulerRunData>;  // reused by /scheduler/active-run endpoint
}
```

In `startWorkers()`, add after the generate worker:
```typescript
const { flowProducer, schedulerRunWorker } = setupSchedulerFlow(connection, config);

// ...existing logging...
console.log("[worker] Scheduler-run worker started");

const schedulerRunQueue = new Queue<SchedulerRunData>(
  SCHEDULER_RUN_QUEUE,
  { connection },
);

return {
  connection,
  generateQueue,
  generateQueueEvents,
  generateWorker,
  flowProducer,
  schedulerRunWorker,
  schedulerRunQueue,
};
```

Add to shutdown in `index.ts`:
```typescript
await queueInstances.schedulerRunWorker.close();
await queueInstances.schedulerRunQueue.close();
await queueInstances.flowProducer.close();
```

- [ ] **Step 2: Modify runScheduledPublish to use Flow**

In `services/content-pipeline/src/agents/scheduled-publisher/index.ts`:

Add import at top:
```typescript
import { createSchedulerFlow, buildRunId } from "../../queue/scheduler-flow.js";
import type { SchedulerSite } from "../../queue/scheduler-flow.js";
import type { QueueInstances } from "../../queue/index.js";
```

Modify `runScheduledPublish` signature to accept optional queue instances:
```typescript
export async function runScheduledPublish(
  config: AgentConfig,
  force: boolean,
  queueInstances?: QueueInstances,
): Promise<ScheduledPublishResult> {
```

After the site filtering / schedule checking loop (where `activeSites` is already filtered and skipped sites are collected), replace the `processWithConcurrency` block with:

```typescript
// If queue is available, create a Flow and return immediately
if (queueInstances) {
  const runId = buildRunId();
  const eligibleSites: SchedulerSite[] = [];
  const skippedSites: Array<{ domain: string; reason: string }> = [];

  // Do Layer 2 (per-site) filtering BEFORE enqueuing
  for (const siteEntry of activeSites) {
    const outcome = await checkSiteEligibility(siteEntry, config, schedCfg);
    if (outcome.kind === "eligible") {
      eligibleSites.push({
        domain: siteEntry.domain,
        branch: outcome.branch,
        count: outcome.count,
      });
    } else {
      skippedSites.push({ domain: siteEntry.domain, reason: outcome.reason });
    }
  }

  if (eligibleSites.length === 0) {
    return {
      status: "ok",
      configStatus: configResult.status,
      triggered: [],
      skipped: skippedSites,
      errors: [],
    };
  }

  try {
    const { enqueued } = await createSchedulerFlow(
      queueInstances.flowProducer,
      runId,
      schedCfg.timezone,
      force,
      eligibleSites,
      skippedSites,
    );

    console.log(`[scheduler] Enqueued Flow: ${enqueued} site(s), runId=${runId}`);
    return {
      status: "ok",
      configStatus: configResult.status,
      triggered: eligibleSites.map((s) => s.domain),
      skipped: skippedSites,
      errors: [],
    };
  } catch (err) {
    // flowProducer.add() throws if a job with this jobId already exists
    // (duplicate cron tick within the same hour). Log and return safely.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scheduler] Flow creation failed (likely duplicate): ${message}`);
    return {
      status: "ok",
      configStatus: configResult.status,
      triggered: [],
      skipped: skippedSites,
      errors: [{ domain: "scheduler", error: message }],
    };
  }
}

// Fallback: no queue — direct execution (pre-migration mode)
// ... keep existing processWithConcurrency block ...
```

Extract the per-site eligibility check into a helper **in the same file** (`scheduled-publisher/index.ts`), refactored from `processSingleSite`'s logic:

```typescript
type EligibilityResult =
  | { kind: "eligible"; branch: string; count: number }
  | { kind: "skipped"; reason: string };

async function checkSiteEligibility(
  siteEntry: { domain: string; branch: string },
  config: AgentConfig,
  schedCfg: SchedulerConfig,
): Promise<EligibilityResult> {
  const octokit = createGitHubClient(config.github);
  try {
    const { data, branch: foundBranch } = await readSiteBriefWithFallback(
      octokit,
      config.networkRepo,
      siteEntry.domain,
      siteEntry.branch,
    );
    const schedule = data.brief?.schedule;
    if (!schedule) return { kind: "skipped", reason: "no publishing schedule" };

    const count = resolveArticlesPerDay(schedule);
    if (count <= 0) return { kind: "skipped", reason: "no publishing schedule" };

    if (!isTodayPreferredDay(schedule, schedCfg.timezone)) {
      return {
        kind: "skipped",
        reason: `not a preferred day (${(schedule.preferred_days ?? []).join(", ")})`,
      };
    }

    return { kind: "eligible", branch: foundBranch, count };
  } catch {
    return { kind: "skipped", reason: "no brief configured" };
  }
}
```

- [ ] **Step 3: Pass queueInstances to runScheduledPublish from index.ts**

In `services/content-pipeline/src/agents/content-generation/index.ts`, update the `/scheduled-publish` handler:

```typescript
const result = await runScheduledPublish(config, force, queueInstances);
```

This requires importing `runScheduledPublish` with the new 3rd parameter signature.

- [ ] **Step 4: Run existing scheduled-publisher tests**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test src/__tests__/scheduled-publisher.test.ts
```

Expected: All existing tests pass (they don't pass queueInstances, so they hit the fallback path)

- [ ] **Step 5: Run all tests**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test
```

Expected: All tests pass

- [ ] **Step 6: Typecheck**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/queue/index.ts \
       services/content-pipeline/src/agents/content-generation/index.ts \
       services/content-pipeline/src/agents/scheduled-publisher/index.ts
git commit -m "feat(queue): wire scheduled-publisher to create BullMQ Flow

Scheduler now enqueues sites as Flow children instead of processing
directly. Falls back to direct execution if queue not available."
```

---

### Task 12: Dashboard active-run endpoint

**Files:**
- Create: `services/dashboard/src/app/api/scheduler/active-run/route.ts`

- [ ] **Step 1: Create active-run route**

```typescript
// services/dashboard/src/app/api/scheduler/active-run/route.ts
import { NextResponse } from "next/server";

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

/**
 * GET /api/scheduler/active-run
 *
 * Returns the state of the currently active scheduler run (if any).
 * Proxies to content-pipeline which queries BullMQ directly.
 */
export async function GET(): Promise<NextResponse> {
  const agentUrl = getAgentUrl();
  try {
    const resp = await fetch(`${agentUrl}/scheduler/active-run`);
    const result = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(result, { status: resp.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      { status: "error", message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Add `/scheduler/active-run` endpoint to content-pipeline**

In `services/content-pipeline/src/agents/content-generation/index.ts`, add a route in `handleRequest`:

```typescript
// Active scheduler run — query BullMQ for in-progress state
if (req.method === "GET" && req.url === "/scheduler/active-run") {
  if (!queueInstances) {
    sendJson(res, 200, { status: "none", message: "Queue not configured" });
    return;
  }
  try {
    // Reuse the scheduler-run queue from queueInstances (created at startup).
    // queueInstances.schedulerRunQueue is a Queue added in Task 11's
    // startWorkers setup — avoids creating a new Queue per request.
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
```

- [ ] **Step 3: Typecheck both services**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline && pnpm typecheck
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/api/scheduler/active-run/ \
       services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat: add /scheduler/active-run endpoint for live run state"
```

---

### Task 13: Cleanup + final verification

**Files:**
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/history.ts` (mark accumulator deprecated)
- Modify: `services/content-pipeline/src/__tests__/scheduled-publisher.test.ts` (verify tests still pass)

- [ ] **Step 1: Mark RunHistoryAccumulator as deprecated**

Add a JSDoc `@deprecated` to `RunHistoryAccumulator` in `history.ts`:

```typescript
/**
 * @deprecated Replaced by BullMQ Flow parent processor.
 * Kept temporarily for the direct-execution fallback path.
 * Delete after queue migration is stable (~1 week post-deploy).
 */
export class RunHistoryAccumulator {
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline
pnpm test
```

Expected: All tests pass

- [ ] **Step 3: Typecheck both services**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/content-pipeline && pnpm typecheck
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/services/dashboard && pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Final commit**

```bash
git add services/content-pipeline/src/agents/scheduled-publisher/history.ts
git commit -m "chore: deprecate RunHistoryAccumulator (replaced by BullMQ Flow parent processor)"
```

- [ ] **Step 5: Deploy + verify Phase 3 (manual)**

After deploying:
1. Navigate to Settings → Scheduler in the dashboard
2. Click "Run Now" — should return fast (enqueue, not inline processing)
3. Check content-pipeline logs for `[scheduler] Enqueued Flow: N site(s)`
4. Wait for workers to process — check `[worker] Job <id> completed`
5. Check `[scheduler-run] Run completed` log (parent processor wrote history)
6. Verify `scheduler/history.json` on network repo main has the new entry

---

## Post-migration cleanup (after ~1 week of stable operation)

Not part of this plan — track as a follow-up task:

1. Delete `RunHistoryAccumulator` class from `history.ts`
2. Remove `processWithConcurrency` fallback path from `runScheduledPublish`
3. Remove direct HTTP proxy fallback from dashboard generate route
4. Remove standalone `/content-generate` endpoint (keep `/job/:id` and `/health`)
5. Update `CLAUDE.md` env var table to include `REDIS_URL`
6. Update `CLAUDE.md` content-pipeline endpoints description

---

## Test coverage summary

| File | Tests | What's covered |
|------|-------|---------------|
| `process-generate-job.test.ts` | 7 | UnrecoverableError for missing site/schedule, throw on total failure, return on success/partial/empty, correct params passed |
| `scheduler-flow.test.ts` | 5 | buildRunId format, flow creation with children, deterministic jobId, parent processor writes history, failed children recorded in history |
| Existing `scheduled-publisher.test.ts` | ~55 | Unchanged — tests hit direct-execution fallback path |
| Existing `concurrency.test.ts` | 5 | Unchanged |
| Existing `incremental-history.test.ts` | 5 | Unchanged |
| Existing `dedup-index.test.ts` | 11 | Unchanged |
