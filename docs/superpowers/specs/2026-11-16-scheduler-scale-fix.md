# Scheduler scale fix — direct file reads + background planning

**Date:** 2026-11-16
**Status:** Approved (Asaf, in session)

## Goal

Make the daily scheduler (and alerts) work at any number of sites: no more whole-repo tree downloads for a single file read, and the cron request returns in about a second no matter how many sites exist.

## Incident

No scheduled articles since 2026-11-02 (`run-alerts` failing since 2026-10-31). At the gated hour, the cron request ran the per-site eligibility loop synchronously. Each `readFile` resolved the path through `getTreeCached`, which downloads a full recursive tree of the network repo per branch (~7.9k entries, ~2.35MB) and keeps it in an unbounded Map. Reproduced locally: 82 sites → 125s, RSS 126MB → 433MB. In production the cron gave up at ~100s, retried while earlier runs were still going, the pods died, and nothing was enqueued. Repo growth on Nov 1–2 (7.2k → 8.9k files) pushed it over.

## Architecture

### 1. `readFile` / `readFileBase64` read by path (lib/github.ts)

- Use `octokit.repos.getContent({ path, ref })`: one request that returns the file's content (base64) and SHA. No tree.
- Files > 1MB (content empty): fall back to `getBlob(sha)`.
- 404, or a path that is a directory → throw the existing `Expected file at <path>, got nothing` error (grid-summaries matches this message).
- Other errors propagate unchanged.
- Blob cache keeps serving the > 1MB fallback.

### 2. Bounded tree cache (lib/github.ts)

- `treeCache` becomes an LRU with `TREE_CACHE_MAX = 10` entries (~3MB each → ~30MB ceiling). A hit moves the entry to the newest slot.
- Still used by `listFiles` / `listFilesRecursive`, which need directory listings.

### 3. Background planning job (queue)

- New queue `scheduler-plan` + worker (concurrency 1, attempts 3, exponential backoff).
- `runScheduledPublish` queue path: after the gate passes, enqueue `{ runId, timezone, forced }` with `jobId = scheduler-plan-<runId>` and return immediately with `{ queued: true, runId }`.
- If a plan job for this hour already exists → return `alreadyQueued: true` plus an `errors` entry, no new job (same "once per hour" rule as today's flow jobId).
- The worker runs the existing planning logic, moved into an exported `planSchedulerRun()`: list active sites → eligibility per site (concurrency 5) → `createSchedulerFlow()` (unchanged).
- Duplicate-flow error → logged, job completes (no retry). Listing failure → job throws → BullMQ retries.

### 4. Dashboard "Run now"

- `RunResult` gets `queued?`, `alreadyQueued?`, `runId?`.
- Toast: "Scheduler run queued — sites appear in the active run shortly"; the result panel shows queued/runId. No other UI change.

## Data flow

```
cron → GET /scheduled-publish → gate (config.yaml) → enqueue scheduler-plan job → 200 {queued, runId}
scheduler-plan worker → listActiveSites → readSiteBriefWithFallback ×N (getContent, 1 call each, 5 at a time)
                      → createSchedulerFlow (scheduler-run parent + generate children)   ← unchanged from here
```

## Error handling / edge cases

- Missing branch with getContent → 404 → "Expected file" → `readSiteBriefWithFallback` falls back to main (as before).
- Missing file: same error message as before.
- Directory path passed to readFile: treated as missing.
- File > 1MB: blob fallback.
- Pod restart mid-planning: BullMQ stalled-job recovery and retry; flow jobId prevents double enqueue.
- Forced run in the same hour as a scheduled run: reported as already queued (today: flow-duplicate error).
- No queue configured (local without Redis): direct path unchanged, now with the faster reads.

## Test plan

- github: readFile uses getContent and never getTree; maps 404 → "Expected file"; directory → "Expected file"; > 1MB → getBlob; readFileBase64 returns raw base64; tree cache evicts beyond 10 branches; hit refreshes recency.
- scheduled-publisher: queue path enqueues one plan job with jobId and returns queued; existing job → alreadyQueued; gate-closed path enqueues nothing.
- planSchedulerRun: eligible sites go to createSchedulerFlow, ineligible ones go to skipped; duplicate-flow error does not throw; listing failure throws.
- Full pipeline + dashboard suites green; typecheck both.
- Local repro script: 82 real sites, before/after time and RSS.

## Out of scope

- Moving the per-site check into each generate job (would change run history, active-run view and auto-publish semantics).
- Mongo as the pipeline's read layer.
- `run-alerts` changes beyond the faster reads (re-check after deploy).
