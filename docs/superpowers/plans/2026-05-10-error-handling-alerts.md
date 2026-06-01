# Error Handling & Alerts — Activate Notification System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing dead-code notification functions (`notifyError`, `notifyReviewNeeded`) into the scheduled publisher, BullMQ workers, and scheduler-run summary. Add a Slack notification step to the CI `sync-kv.yml` workflow. Add an Error Handling guide page to the dashboard.

**Architecture:** The notification infrastructure already exists in `services/content-pipeline/src/lib/notifications.ts` — it reads `SLACK_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` from env (via `config.notifications`). The functions are simply never imported. We wire them into the four error paths: (1) BullMQ generate-worker `failed` event, (2) scheduler-run worker `failed` event, (3) scheduler-run parent processor "zero articles" summary, (4) direct-execution fallback summary in `runScheduledPublish`. For CI, we add a `curl` to Slack's webhook in the `sync-kv.yml` on-failure step. For the guide, we add `16-error-handling.md` and register it in `GUIDE_PAGES`.

**Tech Stack:** TypeScript, BullMQ, GitHub Actions YAML, Markdown

---

### Task 1: Add `notifySummary` function to notifications.ts

**Files:**
- Modify: `services/content-pipeline/src/lib/notifications.ts:38-54`

This task adds a new exported function that sends a summary notification after a scheduler run completes, specifically when sites had errors or generated zero articles.

- [ ] **Step 1: Add `notifySummary` function after `notifyError`**

Add this function at line 55 (after the closing `}` of `notifyError`):

```typescript
/**
 * Send a summary notification after a scheduler run.
 * Fires when any sites errored or produced zero articles.
 */
export async function notifySummary(
  config: NotificationConfig,
  params: {
    runId: string;
    triggered: number;
    errors: Array<{ domain: string; error: string }>;
    zeroArticleSites: string[];
  },
): Promise<void> {
  if (params.errors.length === 0 && params.zeroArticleSites.length === 0) return;

  const lines: string[] = [`Scheduler run ${params.runId}: ${params.triggered} site(s) triggered`];

  if (params.errors.length > 0) {
    lines.push(`\nErrors (${params.errors.length}):`);
    for (const e of params.errors.slice(0, 5)) {
      lines.push(`  - ${e.domain}: ${e.error}`);
    }
    if (params.errors.length > 5) lines.push(`  ... and ${params.errors.length - 5} more`);
  }

  if (params.zeroArticleSites.length > 0) {
    lines.push(`\nZero articles generated (${params.zeroArticleSites.length}):`);
    for (const d of params.zeroArticleSites.slice(0, 5)) {
      lines.push(`  - ${d}`);
    }
    if (params.zeroArticleSites.length > 5) lines.push(`  ... and ${params.zeroArticleSites.length - 5} more`);
  }

  const message = lines.join("\n");

  await Promise.allSettled([
    config.telegramBotToken ? sendTelegram(config, message) : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
}
```

- [ ] **Step 2: Verify typecheck and tests pass**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: No new errors, all existing tests pass

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/lib/notifications.ts
git commit -m "feat(pipeline): add notifySummary to notifications"
```

---

### Task 2: Wire `notifyError` into BullMQ worker `failed` events

**Files:**
- Modify: `services/content-pipeline/src/queue/index.ts:1-73`

The `startWorkers()` function already has `generateWorker.on("failed", ...)` and the scheduler-run worker has its own `failed` handler in `scheduler-flow.ts`. We need to call `notifyError` from both.

- [ ] **Step 1: Add notification import and call in queue/index.ts**

Add import at the top of the file (after the existing imports, before the exports):

```typescript
import { notifyError } from "../lib/notifications.js";
```

Replace the existing `generateWorker.on("failed", ...)` block (lines 42-46) with:

```typescript
  generateWorker.on("failed", (job, err) => {
    console.error(
      `[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
    void notifyError(config.notifications, {
      agent: "content-generation",
      error: `Job ${job?.id} failed after ${job?.attemptsMade} attempt(s): ${err.message}`,
      site: job?.data?.siteDomain,
    });
  });
```

- [ ] **Step 2: Add notification to scheduler-run worker `failed` event in scheduler-flow.ts**

In `services/content-pipeline/src/queue/scheduler-flow.ts`, add import at top:

```typescript
import { notifyError } from "../lib/notifications.js";
```

Replace the existing `schedulerRunWorker.on("failed", ...)` block (lines 213-217) with:

```typescript
  schedulerRunWorker.on("failed", (job, err) => {
    console.error(
      `[scheduler-run] Parent job ${job?.id} failed: ${err.message}`,
    );
    void notifyError(config.notifications, {
      agent: "scheduler-run",
      error: `Run ${job?.data?.runId ?? job?.id} failed: ${err.message}`,
    });
  });
```

- [ ] **Step 3: Verify typecheck and tests pass**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: No new errors, all existing tests pass (notification calls are fire-and-forget no-ops with empty `notifications: {}` in test configs)

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/queue/index.ts services/content-pipeline/src/queue/scheduler-flow.ts
git commit -m "feat(pipeline): wire notifyError into BullMQ worker failed events"
```

---

### Task 3: Wire `notifySummary` into scheduler-run parent processor

**Files:**
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts:93-190`

After the parent processor collects child results and writes history, it should fire a summary notification if any sites errored or produced zero articles.

- [ ] **Step 1: Add notifySummary import (if not already added in Task 2)**

The import of `notifyError` from Task 2 should already be there. Add `notifySummary` to the same import:

```typescript
import { notifyError, notifySummary } from "../lib/notifications.js";
```

- [ ] **Step 2: Add summary notification after history write**

After the `console.log` at line 187-189 (the "History written" log), add:

```typescript
  // Notify if any sites errored or produced zero articles
  const errorSites = sites
    .filter((s) => s.status === "error")
    .map((s) => ({ domain: s.domain, error: s.message ?? "unknown" }));
  const zeroArticleSites = sites
    .filter((s) => s.status !== "error" && s.articlesCreated === 0)
    .map((s) => s.domain);

  void notifySummary(config.notifications, {
    runId,
    triggered: sites.length,
    errors: errorSites,
    zeroArticleSites,
  });
```

- [ ] **Step 3: Verify typecheck and tests pass**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: No new errors, all existing tests pass

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/queue/scheduler-flow.ts
git commit -m "feat(pipeline): fire summary notification after scheduler-run completes"
```

---

### Task 4: Wire `notifySummary` into direct-execution fallback path

**Files:**
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts:1-471`

The direct-execution path (no queue) in `runScheduledPublish` also needs to fire a summary after processing all sites.

- [ ] **Step 1: Add imports**

Add at the top of the file (after existing imports):

```typescript
import { notifyError, notifySummary } from "../../lib/notifications.js";
```

Note: `buildRunId` is already imported at line 26 of this file (`import { createSchedulerFlow, buildRunId } from "../../queue/scheduler-flow.js";`).

- [ ] **Step 2: Add summary notification before `return result` at the end of the direct-execution path**

After the `console.log` at line 461-464 ("Done: X triggered ...") and before `await history.finalize();` at line 467, add:

```typescript
  // Notify if any sites errored or produced zero articles
  const zeroArticleSites = siteOutcomes
    .filter((o): o is Extract<SiteOutcome, { kind: "triggered" }> =>
      o.kind === "triggered" && o.siteResult.articlesCreated === 0,
    )
    .map((o) => o.domain);

  void notifySummary(config.notifications, {
    runId: buildRunId(),
    triggered: result.triggered.length,
    errors: result.errors,
    zeroArticleSites,
  });
```

- [ ] **Step 3: Also notify on listActiveSites failure (critical error)**

After the `result.errors.push(...)` at line 346 and before the `return result;` at line 347, add:

```typescript
    void notifyError(config.notifications, {
      agent: "scheduled-publisher",
      error: `Failed to list active sites: ${message}`,
    });
```

- [ ] **Step 4: Verify typecheck and tests pass**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: No new errors, all existing tests pass

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/scheduled-publisher/index.ts
git commit -m "feat(pipeline): wire notifications into direct-execution scheduler path"
```

---

### Task 5: Add Slack notification to CI sync-kv.yml on-failure step

**Files:**
- Modify: `~/Documents/ATL-content-network/atomic-labs-network/.github/workflows/sync-kv.yml:211-223`

Add a `curl` to the Slack webhook URL in the existing on-failure step. The secret `SLACK_WEBHOOK_URL` must be added to the network repo's GitHub Actions secrets separately.

- [ ] **Step 1: Add Slack notification to the on-failure step**

Replace the existing on-failure step (lines 211-222) with:

```yaml
      - name: On-failure — record sync-status + notify
        if: failure()
        working-directory: platform/packages/site-worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          NS_ID="${{ github.ref_name == 'main' && secrets.KV_NAMESPACE_ID_PROD || secrets.KV_NAMESPACE_ID_STAGING }}"
          FAIL_PAYLOAD=$(jq -nc --arg sha "$GITHUB_SHA" --arg at "$(date -u +%FT%TZ)" \
                         '{gitSha: $sha, committedAt: $at, syncedAt: $at, ok: false, error: "CI sync failed"}')
          npx wrangler kv key put "sync-status:${{ matrix.site }}" "$FAIL_PAYLOAD" \
            --namespace-id="$NS_ID" --remote || true

          # Notify Slack (skip silently if webhook not configured)
          if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
            curl -sf -X POST "$SLACK_WEBHOOK_URL" \
              -H 'Content-Type: application/json' \
              -d "{\"text\":\"KV sync failed for site: ${{ matrix.site }} (branch: ${{ github.ref_name }}, sha: ${GITHUB_SHA:0:7})\"}" \
              || true
          fi
```

- [ ] **Step 2: Commit (in the network repo, on main — workflow changes are safe to push directly)**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git add .github/workflows/sync-kv.yml
git commit -m "feat(ci): add Slack notification on sync-kv failure"
git push origin main
```

- [ ] **Step 3: Add `SLACK_WEBHOOK_URL` secret to the network repo**

This is a manual step. Go to GitHub → atomicfuse/atomic-labs-network → Settings → Secrets and variables → Actions → New repository secret. Name: `SLACK_WEBHOOK_URL`. Value: your Slack incoming webhook URL.

---

### Task 6: Add Error Handling guide page

**Files:**
- Create: `services/dashboard/public/guide/16-error-handling.md`
- Modify: `services/dashboard/src/app/guide/page.tsx:13-29`

- [ ] **Step 1: Create the guide markdown file**

Create `services/dashboard/public/guide/16-error-handling.md`. The full file content is provided separately below this plan in Appendix A. It is a standalone markdown file following the same style as the existing guide pages (e.g. `09-scheduler.md`). The file covers:

- Notification channels (Slack + Telegram env vars)
- What triggers notifications (scheduler summary, BullMQ failures, site listing failure, KV sync CI failure)
- Where logs appear (table of all processes, log locations, and prefixes)
- Error handling patterns (content pipeline resilience, BullMQ retry strategy, KV sync fail-fast)
- HTTP error codes
- Queue Monitor usage
- Debugging checklists ("No articles generating", "KV sync failed", "Queue Monitor empty")
- Code map of all error-handling related files

**See Appendix A at the end of this document for the full file content.**

- [ ] **Step 2: Register the new guide page in GUIDE_PAGES**

In `services/dashboard/src/app/guide/page.tsx`, add to the `GUIDE_PAGES` array after the last entry (`15-creating-a-site`):

```typescript
  { slug: "16-error-handling", title: "Error Handling & Alerts" },
```

- [ ] **Step 3: Verify the dashboard builds**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/public/guide/16-error-handling.md services/dashboard/src/app/guide/page.tsx
git commit -m "docs: add Error Handling & Alerts guide page"
```

---

### Task 7: Set environment variables (manual)

This task is manual — no code changes.

- [ ] **Step 1: Set SLACK_WEBHOOK_URL in CloudGrid**

```bash
cloudgrid secrets set atomic-content-platform SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

- [ ] **Step 2: (Optional) Set Telegram credentials in CloudGrid**

```bash
cloudgrid secrets set atomic-content-platform TELEGRAM_BOT_TOKEN=your-bot-token
cloudgrid secrets set atomic-content-platform TELEGRAM_CHAT_ID=your-chat-id
```

- [ ] **Step 3: Set SLACK_WEBHOOK_URL in the network repo's GitHub Actions secrets**

Go to GitHub → atomicfuse/atomic-labs-network → Settings → Secrets → Actions → New secret:
- Name: `SLACK_WEBHOOK_URL`
- Value: same Slack webhook URL

- [ ] **Step 4: Deploy**

```bash
cloudgrid plug
```

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Test notification functions locally**

Create a temporary test script or call the endpoint manually. Set `SLACK_WEBHOOK_URL` in a local `.env` and trigger a scheduler run with `force=true`:

```bash
curl http://localhost:5000/scheduled-publish?force=true
```

Check Slack for a summary notification (if any sites error or produce zero articles).

- [ ] **Step 2: Verify Queue Monitor**

Open the dashboard at `/queue`. Confirm it shows job data after a scheduler run.

- [ ] **Step 3: Verify guide page**

Open the dashboard at `/guide?page=16-error-handling`. Confirm the content renders correctly.

---

## Appendix A: Guide Page Content

The file `services/dashboard/public/guide/16-error-handling.md` should be created as a standalone markdown file. Use the Write tool to create it directly — do NOT embed it in a code fence. The content follows the exact same style as `09-scheduler.md`.

The guide page covers these sections (use ## headings):

1. **Error Handling, Logging & Alerts** (# title)
2. **Notification Channels** — table of Slack/Telegram env vars and where they're set
3. **What Triggers Notifications** — four subsections:
   - Scheduler Run Summary (`notifySummary` from queue and direct paths, fires when errors or zero articles)
   - BullMQ Worker Job Failure (`notifyError` from worker failed events)
   - Site Listing Failure (`notifyError` when `dashboard-index.yaml` read fails)
   - KV Sync Failure (CI curl to Slack in `sync-kv.yml` on-failure step)
4. **Where Logs Appear** — table: Process, Log Location, Prefix, Notes for all 7 processes
5. **Error Handling Patterns** — subsections:
   - Content Pipeline (per-item resilience, per-site resilience, BullMQ retry table, pre-flight vs runtime)
   - KV Sync (fail fast/loud behaviors, CI failure tracking, no retry)
   - HTTP Error Codes table (200, 201, 400, 500, 502, 503)
6. **Queue Monitor** — `/queue` dashboard page, HTTP endpoints it queries, REDIS_URL requirement
7. **Debugging Checklist** — three subsections:
   - "No articles are generating" (5-step checklist)
   - "KV sync failed" (4-step checklist)
   - "Queue Monitor is empty" (3-step checklist)
8. **Code Map** — file tree of all error-handling related files across content-pipeline, dashboard, site-worker, and network repo

Include an example Slack message in the Scheduler Run Summary section showing what a notification looks like.

Refer to the full guide content in the existing plan text above (Task 6, Step 1 description) for the exact tables, lists, and structure. The implementing agent should create this file directly using the Write tool.
