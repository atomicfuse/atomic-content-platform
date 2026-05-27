# Import Cancellation Design

**Date:** 2026-05-27
**Scope:** Article import cancellation for WordPress migration pipeline

## Problem

Once a WordPress article import is started, there is no way to stop it. The BullMQ background job runs to completion regardless of user action. Imports can run for extended periods (depending on article count and Claude cleanup), and users have no recourse if they started an import with wrong parameters or simply need to stop it.

## Design

Cooperative cancellation via a Redis flag. A new HTTP endpoint sets a cancel flag in Redis; the orchestrator checks this flag at natural processing checkpoints and stops cleanly when it detects cancellation.

### Scope

- Article imports only (`POST /wp-migrate/import-articles`). Batch CSV site creation is fast and does not need cancellation.
- Articles already committed to Git before cancellation are kept. No rollback.

## Components

### 1. Cancel Endpoint

`DELETE /wp-migrate/import-articles/:jobId`

New handler function `handleCancelArticleImport()` in `handler.ts`.

**Flow:**
1. Read `article-import:{jobId}` from Redis to validate the job exists.
2. Check that the job is in a cancellable state (`status` is `"pending"` or `"running"`). If already `"complete"`, `"failed"`, or `"cancelled"`, return `409`.
3. Set Redis key `article-import-cancel:{jobId}` with TTL 300 seconds (long enough for the orchestrator to see it at the next checkpoint, short enough to self-clean).
4. Update progress to `status: "cancelling"` via `writeArticleImportProgress()`.
5. Return `200 { status: "cancelling" }`.

If the jobId is not found in Redis, return `404`.

### 2. Orchestrator Changes

File: `orchestrator.ts`

**New parameter:** `runMigration()` accepts an optional `shouldCancel?: () => Promise<boolean>` callback.

**New error class:** `CancelledError extends Error` in the same file.

**Checkpoint locations** (where `shouldCancel()` is called):
1. **Top of the per-article `for` loop** — before processing each article. This is the most frequent checkpoint.
2. **Before `commitBatch()`** — before committing processed articles to Git.
3. **Before n8n webhook trigger phase** — before firing image generation webhooks.

At each checkpoint:
```typescript
if (shouldCancel && await shouldCancel()) {
  throw new CancelledError("Import cancelled by user");
}
```

The check is NOT called mid-article (during Claude cleanup or Gemini image generation). These are atomic per-article operations. Worst-case latency from cancel request to actual stop is one article's processing time.

**Behavior on cancellation:**
- Articles already fully processed and in the in-memory `files[]` array but not yet committed are discarded.
- Articles already committed to Git in a previous `commitBatch()` call stay.
- The `CancelledError` propagates up to the worker for clean handling.

### 3. Worker Changes

File: `import-articles.ts` (the BullMQ job processor)

**`shouldCancel` callback construction:**
```typescript
const cancelKey = `article-import-cancel:${jobId}`;
const shouldCancel = async (): Promise<boolean> => {
  const exists = await redisConnection.exists(cancelKey);
  return exists === 1;
};
```

Passed to `runMigration()` as the new parameter.

**`CancelledError` handling:**
```typescript
try {
  const report = await runMigration(site, config, onProgress, shouldCancel);
  // ... write "complete" status, release lock ...
} catch (err) {
  if (err instanceof CancelledError) {
    await writeArticleImportProgress(redisConnection, jobId, {
      jobId,
      site: siteDomain,
      status: "cancelled",
      phase: "cancelled",
      ...lastKnownCounts,
      completedAt: new Date().toISOString(),
    });
    await redisConnection.del(cancelKey);
    await releaseLock();
    return { jobId, site: siteDomain, ...lastKnownCounts, durationMs: ..., n8nImagesTriggered: 0 };
  }
  // ... existing error handling (write "failed" status, release lock, re-throw) ...
}
```

Key difference from error handling: `CancelledError` does NOT re-throw. The job completes normally from BullMQ's perspective (it's an intentional stop, not a failure).

### 4. Type Changes

File: `queue/types.ts`

`ArticleImportProgress.status` type updated:
```typescript
status: "pending" | "running" | "complete" | "failed" | "cancelling" | "cancelled";
```

No other type changes needed.

### 5. Dashboard UI

File: `ImportPanel.tsx`

**Cancel button:**
- Visible when `progress?.status` is `"running"` or `"pending"`.
- Calls `DELETE /api/agent/wp-migrate/import-articles/{jobId}`.
- Shows `window.confirm("Cancel this import? Articles already committed will be kept.")` before sending.
- Button label: "Cancel Import".

**"Cancelling" state:**
- When `progress.status === "cancelling"`: cancel button disabled, shows "Cancelling...". Progress bar remains visible. Polling continues normally.

**"Cancelled" state:**
- When `progress.status === "cancelled"`: polling stops, localStorage cleared. Log shows summary: "Import cancelled. X of Y articles were processed (Z committed) before cancellation." UI resets to allow starting a new import.

### 6. Dashboard API Proxy

New route: `DELETE /api/agent/wp-migrate/import-articles/[jobId]/route.ts`

Proxies to `DELETE {CONTENT_AGENT_URL}/wp-migrate/import-articles/{jobId}` using the standard agent URL fallback pattern (localhost:5000 for local dev).

## Redis Keys

| Key | Set by | Read by | TTL | Purpose |
|-----|--------|---------|-----|---------|
| `article-import-cancel:{jobId}` | Cancel endpoint | Orchestrator (via worker callback) | 300s | Cancellation signal |
| `article-import:{jobId}` | Worker | Cancel endpoint, UI polling | 24h | Existing — progress tracking |
| `article-import-active:{siteDomain}` | Enqueue handler | Active-import check, worker | 2h | Existing — dedup lock |

## State Machine

```
pending ──► running ──► complete
               │
               ├──► failed
               │
               └──► cancelling ──► cancelled
```

- `pending → running`: Worker picks up job
- `running → cancelling`: Cancel endpoint called
- `cancelling → cancelled`: Orchestrator hits checkpoint, throws CancelledError, worker handles it
- `running → complete`: Normal completion
- `running → failed`: Unrecoverable error

## Files Changed

| File | Change |
|------|--------|
| `services/content-pipeline/src/agents/migration/handler.ts` | New `handleCancelArticleImport()` function |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Register `DELETE /wp-migrate/import-articles/:jobId` route |
| `services/content-pipeline/src/agents/migration/orchestrator.ts` | Add `shouldCancel` param, `CancelledError` class, 3 checkpoint checks |
| `services/content-pipeline/src/agents/migration/import-articles.ts` | Wire `shouldCancel`, catch `CancelledError`, write "cancelled" status |
| `services/content-pipeline/src/queue/types.ts` | Add `"cancelling" \| "cancelled"` to status union |
| `services/dashboard/src/components/import/ImportPanel.tsx` | Cancel button, cancelling/cancelled UI states |
| `services/dashboard/src/app/api/agent/wp-migrate/import-articles/[jobId]/route.ts` | New DELETE proxy route |

## Edge Cases

- **Cancel after commit but before n8n triggers:** Committed articles stay, n8n webhooks are skipped. Articles will have default images (same as if n8n were down).
- **Cancel during "pending" (job not yet picked up):** Cancel flag is set in Redis. When worker eventually picks up the job, the first `shouldCancel()` check fires immediately and the job stops before processing any articles.
- **Double cancel:** Second `DELETE` call sees `status: "cancelling"` — returns `409` (already cancelling).
- **Cancel flag expires before worker checks:** 300s TTL is generous. If the worker is somehow delayed beyond 5 minutes between checkpoints, the cancel is silently lost and the import continues. This is acceptable — the flag can be re-set.
- **Redis connection failure in `shouldCancel`:** The `redis.exists()` call throws. This propagates as a regular error (not `CancelledError`), and the job fails with the Redis error. Acceptable — Redis being down is a bigger problem.
