# Error Handling, Logging & Alerts

How errors are caught, logged, and surfaced across the platform. Covers the content pipeline, KV sync, queue workers, and the notification system.

## Notification Channels

Alerts are sent via **Slack** and/or **Telegram** when configured. Both are optional — if the webhook/token is not set, that channel is silently skipped.

| Channel | Env Variable | Where Set |
|---------|-------------|-----------|
| Slack | `SLACK_WEBHOOK_URL` | CloudGrid secrets (content-pipeline), GitHub Actions secrets (network repo) |
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | CloudGrid secrets (content-pipeline) |

Notification functions live in `services/content-pipeline/src/lib/notifications.ts`. All calls use `Promise.allSettled` so a failure in one channel never blocks the other or the caller.

## What Triggers Notifications

### Scheduler Run Summary

After every scheduler run (cron or manual), a summary notification fires if **any** sites had errors or generated zero articles. Covers both the BullMQ queue path and the direct-execution fallback.

- **Source (queue path):** `queue/scheduler-flow.ts` — `processSchedulerRun()`
- **Source (direct path):** `agents/scheduled-publisher/index.ts` — `runScheduledPublish()`
- **Function:** `notifySummary()`
- **Fires when:** `errors.length > 0` OR any triggered site produced 0 articles

Example Slack message:

```
Scheduler run 2026-05-10T14: 3 site(s) triggered

Errors (1):
  - coolnews-atl: All 5 articles failed for coolnews-atl

Zero articles generated (1):
  - techbuzz-atl
```

### BullMQ Worker Job Failure

When a content-generation job exhausts all 3 retry attempts, or when the scheduler-run parent job fails.

- **Source:** `queue/index.ts` — `generateWorker.on("failed")` and `queue/scheduler-flow.ts` — `schedulerRunWorker.on("failed")`
- **Function:** `notifyError()`
- **Fires when:** BullMQ emits a `failed` event (all retries exhausted)

### Site Listing Failure

If the scheduler cannot read `dashboard-index.yaml` to enumerate sites, it fires a critical error notification.

- **Source:** `agents/scheduled-publisher/index.ts` — `runScheduledPublish()` catch block
- **Function:** `notifyError()`

### KV Sync Failure (CI)

When the `sync-kv.yml` GitHub Actions workflow fails to sync a site to KV, it:

1. Writes a `sync-status:<site>` KV entry with `ok: false`
2. Sends a Slack notification via `curl` to `SLACK_WEBHOOK_URL`

- **Source:** `.github/workflows/sync-kv.yml` — on-failure step
- **Requires:** `SLACK_WEBHOOK_URL` secret in the network repo's GitHub Actions secrets

## Where Logs Appear

| Process | Log Location | Prefix | Notes |
|---------|-------------|--------|-------|
| Cron scheduler tick | CloudGrid stdout | `[scheduled-publisher]` | Most ticks are no-ops (~50ms) |
| Content generation (queue) | CloudGrid stdout | `[worker]`, `[agent]` | Per-job logs with domain context |
| Content generation (direct) | CloudGrid stdout | `[agent]`, `[server]` | Manual trigger from dashboard |
| Scheduler-run parent | CloudGrid stdout | `[scheduler-run]` | Runs after all children complete |
| HTTP server | CloudGrid stdout | `[server]` | Request/response lifecycle |
| KV sync (CI) | GitHub Actions logs | `[seed-kv]` | Per-site matrix job |
| Config emit | Build logs | `[emit-env-configs]` | At deploy time only |

All services log to stdout/stderr with module prefixes for filtering. CloudGrid captures these in its log viewer.

## Error Handling Patterns

### Content Pipeline

**Per-item resilience:** If one article fails generation, the rest of the batch continues. Failed items return `status: "error"` in the result array — the caller decides what to do.

**Per-site resilience (scheduler):** If one site errors during a cron tick, the remaining sites are still processed. The error is recorded in the run history and included in the summary notification.

**BullMQ retry strategy:**

| Setting | Value |
|---------|-------|
| Max attempts | 3 |
| Backoff | Exponential (30s, 60s, 120s) |
| Completed job retention | 7 days or 1000 jobs |
| Failed job retention | 30 days |

**Pre-flight vs. runtime errors:**
- Missing site brief or schedule — `UnrecoverableError` (no retry, no LLM spend)
- All articles in a batch fail — regular `Error` (BullMQ retries)
- Partial success — returned as result (no throw, no retry)

### KV Sync (seed-kv)

**Fail fast, fail loud:**
- Missing `site.yaml` — hard fail with guidance message
- Missing articles/assets directory — warn and skip (non-fatal)
- Unresolved script variables — hard fail with available vars listed
- Wrangler command failure — propagates, exit code 1

**CI failure tracking:** On failure, the workflow writes `sync-status:<site>` to KV with `ok: false` and the commit SHA. The dashboard can query this to show last-known sync state.

**No retry logic:** seed-kv is single-shot. Re-run the GitHub Actions workflow manually for transient failures.

### HTTP Error Codes (Content Pipeline)

| Code | Meaning |
|------|---------|
| 200 | Success, partial success, or no items sourced |
| 201 | At least one article created |
| 400 | Invalid request (bad JSON, missing siteDomain) |
| 500 | All articles failed, or scheduler error |
| 502 | Unhandled agent error |
| 503 | Queue not configured (REDIS_URL not set) |

## Queue Monitor

The dashboard includes a built-in **Queue Monitor** at `/queue` (sidebar link). It shows:

- Job status breakdown (completed, failed, active, waiting, delayed)
- Per-job detail cards with domain, duration, article counts, error reasons
- Auto-refresh every 10 seconds

The monitor queries the content-pipeline's HTTP endpoints:
- `GET /jobs?status=completed,failed,active&limit=50`
- `GET /job/<id>`
- `GET /scheduler/active-run`

**Note:** The Queue Monitor requires `REDIS_URL` to be set. Without it, the pipeline runs in direct-execution mode and the monitor shows "Queue not configured".

## Debugging Checklist

### "No articles are generating"

1. Check `/queue` in the dashboard — are jobs failing? Look at error reasons.
2. Check scheduler config: Dashboard — Settings — General Scheduler. Is it enabled? Is the current hour in `run_at_hours`?
3. Check per-site schedule: Site detail — Content Brief. Are `articles_per_day` and `preferred_days` set? Is today a preferred day?
4. Try **Run Now** from the scheduler page — it bypasses the global hour gate. Check the response for skipped/error details.
5. Check CloudGrid logs for `[scheduled-publisher]` entries.

### "KV sync failed"

1. Check GitHub Actions — `Sync network data to KV` workflow runs. Find the failed matrix job.
2. Look at the `[seed-kv]` output — the error message includes guidance (e.g., wrong branch, missing site.yaml).
3. Check that `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets are set and valid.
4. Re-run the failed job, or use workflow dispatch with the specific site slug.

### "Queue Monitor is empty"

1. Verify `REDIS_URL` is set in CloudGrid: `cloudgrid env list atomic-content-platform | grep REDIS`
2. Check content-pipeline logs for `[server] REDIS_URL not set — queue workers disabled` — if present, set the env var and redeploy.
3. If REDIS_URL is set but monitor is still empty, check for Redis connectivity: the pipeline logs `[worker] Content-generation worker started` on successful connection.

## Code Map

```
services/content-pipeline/
  src/lib/notifications.ts           -- notifyError, notifyReviewNeeded, notifySummary
  src/lib/config.ts                  -- loads SLACK_WEBHOOK_URL, TELEGRAM_* from env
  src/queue/index.ts                 -- worker failed event — notifyError
  src/queue/scheduler-flow.ts        -- scheduler-run failed — notifyError, completed — notifySummary
  src/queue/content-generation.ts    -- job processor with UnrecoverableError pre-flight
  src/queue/types.ts                 -- retry config (3 attempts, exponential backoff)
  src/agents/scheduled-publisher/    -- direct-execution path — notifySummary
  src/agents/content-generation/     -- HTTP server, agent, per-item error handling

services/dashboard/
  src/app/queue/page.tsx             -- Queue Monitor UI
  src/app/api/queue/route.ts         -- proxy to content-pipeline /jobs endpoint

packages/site-worker/
  scripts/seed-kv.ts                 -- KV sync with [seed-kv] prefixed logging
  scripts/lib/resolve.ts             -- config resolution with strict validation
```
