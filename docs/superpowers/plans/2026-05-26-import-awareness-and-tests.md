# Import Cross-User Awareness & Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Import page a cross-user control center where any visitor sees active background imports, and add comprehensive tests for the queue monitor + import panel fixes.

**Architecture:** Add a `GET /wp-migrate/active-import/:domain` endpoint that reads the existing dedup lock key (`article-import-active:{domain}`) from Redis to discover the `jobId`, then reads the progress. The ImportPanel calls this on site select and auto-attaches if an import is running. Tests use vitest with mock Redis following existing patterns.

**Tech Stack:** Vitest, React (ImportPanel component), Node HTTP handlers, Redis (ioredis mock)

---

### Task 1: Add `readActiveImport` to import-status.ts

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/import-status.ts:102-129`
- Test: `services/content-pipeline/src/__tests__/migration/import-status.test.ts`

- [ ] **Step 1: Write the failing test for readActiveImport**

Add to the existing `import-status.test.ts`. The mock needs `get` and `set` methods added since the existing mock only has hash operations.

```typescript
// Add to the existing createRedisMock — add `get` and `set` for string keys:
// Inside createRedisMock, add a second store for string keys:
//   const stringStore = new Map<string, string>();
//   get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
//   set: vi.fn(async (key: string, value: string) => { stringStore.set(key, value); return "OK"; }),
//   _stringStore: stringStore,

// Then add these tests in a new describe("article import status") block:

describe("article import status", () => {
  it("writeArticleImportProgress stores progress with correct key", async () => {
    const progress = {
      jobId: "job-1",
      site: "example.com",
      status: "running" as const,
      phase: "fetching",
      totalArticles: 10,
      processedArticles: 3,
      successfulArticles: 2,
      failedArticles: 1,
    };
    await writeArticleImportProgress(redis as never, "job-1", progress);
    expect(redis.set).toHaveBeenCalledWith(
      `${ARTICLE_IMPORT_KEY_PREFIX}job-1`,
      expect.any(String),
      "EX",
      ARTICLE_IMPORT_TTL_SECONDS,
    );
  });

  it("readArticleImportProgress returns stored progress", async () => {
    const progress = {
      jobId: "job-1",
      site: "example.com",
      status: "running" as const,
      phase: "committing",
      totalArticles: 10,
      processedArticles: 5,
      successfulArticles: 4,
      failedArticles: 1,
    };
    await writeArticleImportProgress(redis as never, "job-1", progress);
    const result = await readArticleImportProgress(redis as never, "job-1");
    expect(result).toEqual(progress);
  });

  it("readArticleImportProgress returns null for unknown job", async () => {
    const result = await readArticleImportProgress(redis as never, "nonexistent");
    expect(result).toBeNull();
  });

  it("readActiveImport returns jobId and progress when lock exists", async () => {
    // Simulate dedup lock: article-import-active:example.com → "job-1"
    redis._stringStore.set("article-import-active:example.com", "job-1");
    // Simulate progress
    const progress = {
      jobId: "job-1",
      site: "example.com",
      status: "running" as const,
      phase: "fetching",
      totalArticles: 10,
      processedArticles: 3,
      successfulArticles: 2,
      failedArticles: 1,
    };
    await writeArticleImportProgress(redis as never, "job-1", progress);

    const result = await readActiveImport(redis as never, "example.com");
    expect(result).not.toBeNull();
    expect(result!.jobId).toBe("job-1");
    expect(result!.progress.status).toBe("running");
  });

  it("readActiveImport returns null when no lock exists", async () => {
    const result = await readActiveImport(redis as never, "example.com");
    expect(result).toBeNull();
  });

  it("readActiveImport returns jobId with null progress when lock exists but progress expired", async () => {
    redis._stringStore.set("article-import-active:example.com", "job-1");
    // No progress written — simulates expired TTL

    const result = await readActiveImport(redis as never, "example.com");
    expect(result).not.toBeNull();
    expect(result!.jobId).toBe("job-1");
    expect(result!.progress).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/import-status.test.ts`
Expected: FAIL — `readActiveImport` is not defined, and mock is missing `get`/`set`

- [ ] **Step 3: Update the mock and implement readActiveImport**

First, update `createRedisMock` in `import-status.test.ts` to support string operations:

```typescript
function createRedisMock(): Record<string, unknown> {
  const store = new Map<string, Map<string, string>>();
  const stringStore = new Map<string, string>();

  return {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!store.has(key)) store.set(key, new Map());
      store.get(key)!.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (key: string, field: string) => {
      return store.get(key)?.get(field) ?? null;
    }),
    hgetall: vi.fn(async (key: string) => {
      const map = store.get(key);
      if (!map || map.size === 0) return {};
      const obj: Record<string, string> = {};
      for (const [k, v] of map) obj[k] = v;
      return obj;
    }),
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      stringStore.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => 1),
    _store: store,
    _stringStore: stringStore,
  };
}
```

Then add to `import-status.ts` after `readArticleImportProgress`:

```typescript
export const ARTICLE_IMPORT_LOCK_PREFIX = "article-import-active:";

export async function readActiveImport(
  redis: Redis,
  siteDomain: string,
): Promise<{ jobId: string; progress: ArticleImportProgress | null } | null> {
  const lockKey = `${ARTICLE_IMPORT_LOCK_PREFIX}${siteDomain}`;
  const jobId = await redis.get(lockKey);
  if (!jobId) return null;

  const progress = await readArticleImportProgress(redis, jobId);
  return { jobId, progress };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/import-status.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/import-status.ts services/content-pipeline/src/__tests__/migration/import-status.test.ts
git commit -m "feat(pipeline): add readActiveImport to look up active import by domain"
```

---

### Task 2: Add `handleActiveImport` endpoint to handler.ts + wire into HTTP server

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/handler.ts:330-355` (add new handler after `handleArticleImportStatus`)
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts:472-480` (add route)
- Test: `services/content-pipeline/src/__tests__/migration/handler.test.ts` (new)

- [ ] **Step 1: Write the failing test for handleActiveImport**

Create `services/content-pipeline/src/__tests__/migration/handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleActiveImport, handleEnqueueArticleImport } from "../../agents/migration/handler.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function createMockRequest(url: string): IncomingMessage {
  return { url, method: "GET" } as unknown as IncomingMessage;
}

function createMockResponse(): ServerResponse & {
  _statusCode: number;
  _body: string;
  _headers: Record<string, string>;
} {
  const res = {
    _statusCode: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) {
      res._statusCode = code;
      if (headers) res._headers = headers;
    },
    end(body?: string) {
      res._body = body ?? "";
    },
  };
  return res as unknown as typeof res;
}

function createRedisMock(): Record<string, unknown> {
  const stringStore = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      stringStore.set(key, value);
      return "OK";
    }),
    _stringStore: stringStore,
  };
}

describe("handleActiveImport", () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("returns 400 when domain is missing from URL", async () => {
    const req = createMockRequest("/wp-migrate/active-import/");
    const res = createMockResponse();
    await handleActiveImport(req, res, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 404 when no active import exists", async () => {
    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res, redis as never);
    expect(res._statusCode).toBe(404);
    expect(JSON.parse(res._body)).toEqual({ active: false });
  });

  it("returns 200 with jobId and progress when import is active", async () => {
    // Simulate lock
    redis._stringStore.set("article-import-active:example.com", "job-123");
    // Simulate progress
    const progress = {
      jobId: "job-123",
      site: "example.com",
      status: "running",
      phase: "fetching",
      totalArticles: 10,
      processedArticles: 3,
      successfulArticles: 2,
      failedArticles: 1,
    };
    redis._stringStore.set("article-import:job-123", JSON.stringify(progress));

    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res, redis as never);

    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.active).toBe(true);
    expect(body.jobId).toBe("job-123");
    expect(body.progress.status).toBe("running");
  });

  it("returns 200 with jobId but null progress when lock exists but progress expired", async () => {
    redis._stringStore.set("article-import-active:example.com", "job-456");
    // No progress key — expired

    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res, redis as never);

    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.active).toBe(true);
    expect(body.jobId).toBe("job-456");
    expect(body.progress).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/handler.test.ts`
Expected: FAIL — `handleActiveImport` is not exported from handler.ts

- [ ] **Step 3: Implement handleActiveImport in handler.ts**

First, add `readActiveImport` to the existing import at line 12 of `handler.ts`:

```typescript
import { readBatchStatus, readArticleImportProgress, writeArticleImportProgress, readActiveImport } from "./import-status.js";
```

Then add the handler after `handleArticleImportStatus` (after line 355):

```typescript
// ---------------------------------------------------------------------------
// GET /wp-migrate/active-import/:domain
// ---------------------------------------------------------------------------

/**
 * Returns active article import status for a given domain.
 * Reads the dedup lock key to discover the jobId, then reads progress.
 * Enables cross-user awareness — any user can see if an import is running.
 */
export async function handleActiveImport(
  req: IncomingMessage,
  res: ServerResponse,
  redis: Redis,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  // Expected: ["wp-migrate", "active-import", "<domain>"]
  const domain = segments[2];

  if (!domain) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "domain is required" }));
    return;
  }

  try {
    const result = await readActiveImport(redis, domain);

    if (!result) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: false }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      active: true,
      jobId: result.jobId,
      progress: result.progress,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-migrate] Failed to check active import for ${domain}:`, message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Failed to check active import: ${message}` }));
  }
}
```

- [ ] **Step 4: Wire the route in index.ts**

Add to `index.ts` after the `article-import-status` route block (after line ~521, the `handleArticleImportStatus` block). First add `handleActiveImport` to the import at lines 30-35:

```typescript
import {
  handleMigrationRequest,
  handleCreateSites,
  handleImportStatus,
  handleEnqueueArticleImport,
  handleArticleImportStatus,
  handleActiveImport,
} from "../migration/handler.js";
```

Then add the route handler:

```typescript
  // WordPress migration — check active import for a domain (cross-user awareness)
  if (req.method === "GET" && req.url?.startsWith("/wp-migrate/active-import/")) {
    if (!queueInstances) {
      sendJson(res, 503, { status: "error", message: "Queue not configured — REDIS_URL not set" });
      return;
    }
    await handleActiveImport(req, res, queueInstances.connection);
    return;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/handler.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS (ignore pre-existing vitest.config.ts error)

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/agents/migration/handler.ts services/content-pipeline/src/agents/migration/import-status.ts services/content-pipeline/src/agents/content-generation/index.ts services/content-pipeline/src/__tests__/migration/handler.test.ts
git commit -m "feat(pipeline): add GET /wp-migrate/active-import/:domain endpoint for cross-user awareness"
```

---

### Task 3: Add dashboard proxy route for active-import

**Files:**
- Create: `services/dashboard/src/app/api/agent/wp-migrate/active-import/[domain]/route.ts`

- [ ] **Step 1: Create the proxy route**

Following the exact pattern of the existing `article-import-status/[jobId]/route.ts`:

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
  params: Promise<{ domain: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { domain } = await params;
  const agentUrl = getAgentUrl();

  try {
    const response = await fetch(
      `${agentUrl}/wp-migrate/active-import/${encodeURIComponent(domain)}`,
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

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (ignore pre-existing vitest.config.ts error)

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/agent/wp-migrate/active-import/
git commit -m "feat(dashboard): add proxy route for active-import endpoint"
```

---

### Task 4: Update ImportPanel to auto-detect active imports on site select

**Files:**
- Modify: `services/dashboard/src/components/import/ImportPanel.tsx`

- [ ] **Step 1: Add active import check to handleSiteChange**

In `ImportPanel.tsx`, update the `handleSiteChange` callback to also check for an active import. The check fires after site selection and before the user clicks "Start Import". If an active import is found, auto-attach to it.

Add this inside `handleSiteChange`, after the existing site-config fetch (after line 127):

```typescript
  const handleSiteChange = useCallback((domain: string): void => {
    setSelectedDomain(domain);
    setSiteTopics([]);
    setErrorMsg(null);
    setWpUrl(domain ? `https://${domain}/wp-json/wp/v2/posts` : "");

    // Clear previous job state when switching sites
    if (!domain) {
      setJobId(null);
      setProgress(null);
      setLog([]);
      return;
    }

    // Fetch site topics (existing)
    fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { config?: { brief?: { topics?: string[] } } } | null) => {
        const topics = data?.config?.brief?.topics;
        if (Array.isArray(topics) && topics.length > 0) {
          setSiteTopics(topics);
        }
      })
      .catch(() => { /* non-fatal */ });

    // Check for active import (cross-user awareness)
    fetch(`/api/agent/wp-migrate/active-import/${encodeURIComponent(domain)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { active?: boolean; jobId?: string; progress?: ArticleImportProgress | null } | null) => {
        if (data?.active && data.jobId) {
          setJobId(data.jobId);
          if (data.progress) {
            setProgress(data.progress);
          }
          appendLog(`Detected active import (job ${data.jobId.slice(0, 8)}) — attaching to progress`);
          // Save to localStorage so it persists on refresh
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId: data.jobId, domain }));
        }
      })
      .catch(() => { /* non-fatal — don't block the user */ });
  }, [appendLog]);
```

This replaces the existing `handleSiteChange` entirely (lines 112-127).

- [ ] **Step 2: Also check on mount when restoring from localStorage fails**

After the existing localStorage restore `useEffect` (lines 76-87), add a fallback that checks for active imports even when localStorage is empty. This handles the case where a user visits the page fresh and hasn't selected a site yet — we don't need to do anything. But when `selectedDomain` is restored from a page reload, the active check already runs via `handleSiteChange`.

No change needed here — the site-select triggers the check. But we should also clear stale localStorage jobs. In the polling effect (lines 134-175), the poll function currently has `if (cancelled || !res.ok) return;` at line 142. This early-returns on any non-200, including 404 (expired job). Replace that line to handle 404 explicitly before the generic `!res.ok`:

```typescript
        if (cancelled) return;

        // Job expired or doesn't exist — clean up stale state
        if (res.status === 404) {
          setJobId(null);
          setProgress(null);
          localStorage.removeItem(STORAGE_KEY);
          return;
        }

        if (!res.ok) return;
```

This prevents the UI from showing a spinner forever if the Redis key expired, and ensures the 404 check runs before the generic `!res.ok` early return.

- [ ] **Step 3: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/components/import/ImportPanel.tsx
git commit -m "feat(dashboard): auto-detect active imports on site select for cross-user awareness"
```

---

### Task 5: Add tests for article import status and handler endpoints

**Files:**
- Modify: `services/content-pipeline/src/__tests__/migration/import-status.test.ts` (already done in Task 1)
- Test: `services/content-pipeline/src/__tests__/migration/handler.test.ts` (already done in Task 2)

This task adds additional edge-case tests to the handler test file created in Task 2.

- [ ] **Step 1: Add handleEnqueueArticleImport tests**

Add the following to `handler.test.ts` (the import for `handleEnqueueArticleImport` was already included in Task 2). Add the mock helpers and test suite after the existing `handleActiveImport` describe block:

```typescript
// Mock for BullMQ queue
function createQueueMock(): Record<string, unknown> {
  return {
    add: vi.fn(async () => ({ id: "bullmq-job-1" })),
  };
}

function createMockPostRequest(url: string, body: unknown): IncomingMessage {
  const bodyStr = JSON.stringify(body);
  const listeners = new Map<string, Array<(data?: unknown) => void>>();
  const req = {
    url,
    method: "POST",
    on(event: string, handler: (data?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      // Defer emission so the handler's Promise for "end" is registered before firing
      if (event === "end") {
        process.nextTick(() => {
          for (const fn of listeners.get("data") ?? []) fn(Buffer.from(bodyStr));
          for (const fn of listeners.get("end") ?? []) fn();
        });
      }
      return req;
    },
  };
  return req as unknown as IncomingMessage;
}

// Extend redis mock to support the lock pattern
function createFullRedisMock(): Record<string, unknown> {
  const stringStore = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      // Simulate NX behavior
      const hasNX = args.includes("NX");
      if (hasNX && stringStore.has(key)) return null;
      stringStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => { stringStore.delete(key); return 1; }),
    _stringStore: stringStore,
  };
}

describe("handleEnqueueArticleImport", () => {
  let redis: ReturnType<typeof createFullRedisMock>;
  let queue: ReturnType<typeof createQueueMock>;

  beforeEach(() => {
    redis = createFullRedisMock();
    queue = createQueueMock();
  });

  it("returns 400 when siteDomain is missing", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", { wpApiUrl: "https://example.com/wp-json/wp/v2/posts" });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when wpApiUrl is missing", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", { siteDomain: "example.com" });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 202 and enqueues job on success", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(202);
    const body = JSON.parse(res._body);
    expect(body.jobId).toBeDefined();
    expect(body.siteDomain).toBe("example.com");
    expect(queue.add).toHaveBeenCalled();
  });

  it("returns 409 when import is already running for same site", async () => {
    // First import succeeds
    const req1 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res1 = createMockResponse();
    await handleEnqueueArticleImport(req1, res1, queue as never, redis as never);
    expect(res1._statusCode).toBe(202);

    // Second import for same site blocked
    const req2 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res2 = createMockResponse();
    await handleEnqueueArticleImport(req2, res2, queue as never, redis as never);
    expect(res2._statusCode).toBe(409);
    expect(JSON.parse(res2._body).error).toContain("already running");
  });

  it("allows import for different site while one is running", async () => {
    const req1 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "site-a.com",
      wpApiUrl: "https://site-a.com/wp-json/wp/v2/posts",
    });
    const res1 = createMockResponse();
    await handleEnqueueArticleImport(req1, res1, queue as never, redis as never);
    expect(res1._statusCode).toBe(202);

    const req2 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "site-b.com",
      wpApiUrl: "https://site-b.com/wp-json/wp/v2/posts",
    });
    const res2 = createMockResponse();
    await handleEnqueueArticleImport(req2, res2, queue as never, redis as never);
    expect(res2._statusCode).toBe(202);
  });
});
```

- [ ] **Step 2: Run all tests to verify**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/handler.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/__tests__/migration/handler.test.ts
git commit -m "test(pipeline): add handler tests for enqueue, dedup lock, and active-import"
```

---

### Task 6: Run full test suite + typecheck and push

**Files:** None (verification only)

- [ ] **Step 1: Run full content-pipeline tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run content-pipeline typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run dashboard typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (ignore pre-existing vitest.config.ts error)

- [ ] **Step 4: Push all commits**

```bash
git push origin michal-test
```
