# Developer Guide — Content Generation Flow

> Companion to `docs/developer-guide-site-creation.md`. That doc covers the wizard / "create a new site" path. **This** doc covers article generation: how the dashboard's "Generate" button and the scheduled cron actually produce articles.
>
> Reflects the **post-queue-migration architecture** — generation goes through BullMQ + Upstash Redis. Read the old code (`runContentGeneration` directly invoked from HTTP) only as historical context if you need to understand a pre-migration commit.
>
> Last updated: 2026-05-03. Reflects design decided in the queue-migration architecture session.

## What this document covers

- The two trigger paths (manual click + scheduled cron) and how both flow through the same queue
- The job lifecycle from enqueue to completion / retry / dead-letter
- **Why** every architectural decision was made the way it was, including why we use Upstash Redis + BullMQ instead of CloudGrid's native Redis or simpler patterns
- What's sync vs async in the new model, and why that's different from the pre-migration model
- Failure modes, observability, and rollback
- What changes in the codebase vs. what stays exactly the same

Read top to bottom on first pass — the WHYs build on each other. After that, use it as a lookup. Section paths: file paths in monospace, decisions in callouts.

If you haven't read `docs/developer-guide-site-creation.md` yet, skim its **Architecture** and **Sync vs async** sections first. The two-repo split (CODE in `atomic-content-platform`, DATA in `atomic-labs-network`) is foundational here too.

---

## Architecture at a glance

```
┌──────────────────────────────┐                    ┌──────────────────────────────┐
│       atomic-content-        │                    │      atomic-labs-network     │
│         platform             │                    │      (data repo)             │
│                              │                    │                              │
│  ┌────────────────────────┐  │   GitHub Data API  │  sites/<slug>/articles/      │
│  │ dashboard (Next.js)    │──┼───────────────────►│  + assets/images/            │
│  │   /api/agent/generate  │  │                    │                              │
│  │   /api/scheduler/run   │  │                    │  scheduler/history.json       │
│  │   /api/agent/job/[id]  │  │                    │  scheduler/config.yaml       │
│  └───────────┬────────────┘  │                    │                              │
│              │ enqueue        │                    └──────────────┬───────────────┘
│              ▼                │                                   │ commit triggers
│        ┌──────────────┐       │                                   ▼
│        │   Upstash    │       │                            ┌──────────────┐
│        │    Redis     │       │                            │ sync-kv.yml  │
│        │              │       │                            │ (CI)         │
│        │  job queue,  │       │                            └──────┬───────┘
│        │  rate-limit  │       │                                   │ writes to
│        │  counters,   │       │                                   ▼
│        │  parent/child│       │                            ┌──────────────────┐
│        │  flow state  │       │                            │ Cloudflare KV    │
│        └──────┬───────┘       │                            │ + R2 (assets)    │
│               │ claim          │                            └────────┬─────────┘
│               ▼                │                                     │
│  ┌────────────────────────┐   │                                     │ read at request
│  │ content-pipeline       │   │                                     ▼
│  │   HTTP server          │   │                            ┌──────────────────┐
│  │   + BullMQ worker      │   │ ──── LLM/Image APIs ────►  │  Cloudflare      │
│  │   (same Node process)  │   │ ──── GitHub commit  ────►  │  Worker          │
│  └────────────────────────┘   │                            │  (atomic-site-   │
└──────────────────────────────┘                             │   worker)        │
                                                              └──────────────────┘

   ┌────────────────────────────────────────────────────────────────────────┐
   │  CloudGrid cron (hourly)  ──HTTP──►  /scheduled-publish endpoint       │
   └────────────────────────────────────────────────────────────────────────┘
```

The new piece vs. before: **Upstash Redis** sitting between enqueuers (dashboard + scheduler) and consumers (BullMQ workers in content-pipeline). Everything else — site config in KV, articles in network repo, R2 for images, sync-kv.yml — is unchanged.

---

## Why we did this migration

Before the queue, both paths (manual + cron) called `runContentGeneration` over HTTP and **awaited the full result**. That had four problems we hit or saw coming:

1. **Reliability.** Process restart mid-run = lost work. No retry, no resume. Burned Anthropic spend with nothing to show. Bad enough manually; **silent for the cron** (a daily scheduled run dying at site 7 of 20 produces 13 missing articles that nobody notices for days).
2. **Scheduler blast radius.** The cron loop processes sites sequentially. At 100 sites × ~60s each = 100 minutes of wall time. CloudGrid cron has limits well under that. Either we hit timeouts and silently skip the rest, or we have to rearchitect anyway.
3. **No observability into in-flight state.** Was that job actually running? Stalled? Is the LLM slow today, or did our worker die? No way to tell without log-grepping.
4. **Throughput cap.** Per-process concurrency (3 in flight) × one process = ~30 articles/min ceiling. The 10K/day target requires multiple workers acting on shared work. Without a queue, multiple workers race-claim the same jobs.

The queue solves all four:

- **Reliability:** Jobs are durable in Redis. Worker dies → BullMQ lease expires → another worker resumes from the queue. Idempotent retries (the agent already dedups on URL + slug).
- **Blast radius:** Cron tick enqueues 100 jobs in seconds and returns. Workers chew through them at their own pace.
- **Observability:** Bull Board shows every job's state, attempts, progress, and error. Live API queries BullMQ for "what's happening right now" without waiting for GitHub flushes.
- **Throughput:** Multiple worker replicas (or higher per-replica concurrency) process the queue in parallel without coordination — Redis claim semantics handle who gets what.

---

## Decision: Upstash Redis (not CloudGrid's native Redis)

This is the most non-obvious choice in the migration, so it gets a section to itself.

### CloudGrid offers Redis. We aren't using it. Why?

CloudGrid v0.8 supports Redis via `requires:` declaration in `cloudgrid.yaml`. Two modes:

| Mode | Memory | Persistence | Eviction policy |
|---|---|---|---|
| Shared (`requires: [redis]`) | shared cluster | (depends on cluster config) | (depends) |
| Private (`requires: [redis: private]`) | **64 MB cap** | **None — memory-only** | **`allkeys-lru`** |

For caching, rate limiting, session storage — CloudGrid Redis is fine. **For a job queue, those three private-mode properties are footguns:**

- **`allkeys-lru` evicts ANY key under memory pressure**, including pending jobs. BullMQ's persistence model assumes its keys are stable; an evicted pending job is **silently lost**. BullMQ's documentation explicitly warns against running on a Redis with eviction enabled — `noeviction` is the recommended policy, which CloudGrid private Redis doesn't offer.
- **No persistence** means a Redis container restart (platform updates, memory pressure, K8s pod evictions) wipes the entire queue. Every in-flight or pending job vanishes.
- **64 MB cap** is generous for caching, tight for a queue at 10K jobs/day. Steady-state we'd be ~5-10 MB, but a retry storm or a payload spike pushes us over fast — and the eviction policy means the queue silently corrupts when it does.

### Upstash gives us what BullMQ needs

| Property | Upstash | CloudGrid private Redis |
|---|---|---|
| Persistence | Yes (AOF) | No |
| Replication | Yes (multi-AZ on paid tiers) | No |
| Eviction policy | `noeviction` (configurable) | `allkeys-lru` (fixed) |
| Memory | 256 MB+ entry tier, scales | 64 MB hard cap |
| Cost | Free tier covers dev; ~$5-10/mo for our prod load | Included in CloudGrid |

The cost difference (~$5-10/mo) is trivial compared to:
- Anthropic spend on lost-then-regenerated articles
- Editorial trust in the system (silent job loss is the worst class of bug)
- Engineering time investigating "why did this site not publish today" mysteries

### When CloudGrid Redis would be the right answer

We're not anti-CloudGrid-Redis on principle. Use it for:
- The dashboard's session store (if we ever add Redis-backed sessions)
- AI Gateway response caching
- Any **cache-style** workload where eviction is desired and persistence isn't required

For **state-of-record**, **coordination primitives**, or **job queues**, use a Redis with proper persistence. Upstash is the cheapest credible option in that category for a small team.

### Wiring

```yaml
# cloudgrid.yaml — content-pipeline service
content-pipeline:
  type: node
  lang: typescript
  path: /pipeline
  env:
    NETWORK_REPO: atomicfuse/atomic-labs-network
    CONTENT_AGGREGATOR_URL: https://content-aggregator-v2-34cd.atomic.cloudgrid.io
  # Secrets: GITHUB_TOKEN, GEMINI_API_KEY, REDIS_URL ←─── new
```

`REDIS_URL` is set via `cloudgrid secrets set atomic-content-platform REDIS_URL=rediss://...` from Upstash's connection string. Both the HTTP enqueuer and the BullMQ worker (same process) read it.

Dashboard service also needs `REDIS_URL` (it enqueues jobs):

```yaml
dashboard:
  # ... existing ...
  # Secrets: NEXTAUTH_SECRET, GITHUB_TOKEN, ..., REDIS_URL ←─── new
```

---

## The two trigger paths

Both go through the same queue. Same worker. Same retry semantics.

### Path A — Manual generation (user clicks "Generate")

```
USER                  DASHBOARD                          REDIS                  WORKER
                      ─────────                          ─────                  ──────

 click ─────────► POST /api/agent/generate
                      │
                      ├─ queue.add({ siteDomain, count, branch })
                      │                                  ──► waiting list
                      │                                  ◄── jobId
                      │
                      ├─ try { job.waitUntilFinished(90s) }
                      │   ╔══════════════════════════════════════════════════╗
                      │   ║              waiting for outcome ...             ║
                      │   ║                                                  ║
                      │   ║                                  ──► claim       ║─► Worker picks up
                      │   ║                                                  ║
                      │   ║                                  ◄── progress    ║   updates progress
                      │   ║                                                  ║   in job hash
                      │   ║                                                  ║
                      │   ║                                  ◄── complete    ║─► Worker finishes,
                      │   ║                                                  ║   batch-commits to git
                      │   ║                                  ──► returnvalue ║
                      │   ╚══════════════════════════════════════════════════╝
                      │
                      ├─ FAST PATH: finished within 90s
                      │   └─ return result (status 200)             ◄────── browser sees same shape as today
                      │
                      └─ SLOW PATH: still running after 90s
                          └─ return { status: "running", jobId }    ◄────── browser shows "still working"
                                     status 202

                      (later, browser optionally polls)
                          GET /api/agent/job/<jobId>
                              └─ queries Redis for state + progress
```

**Why `waitUntilFinished` with timeout fallback?** It lets us add the queue without changing the dashboard frontend. For typical batches (1-5 articles in 30-60s), the API behaves identically to today. The `202 + jobId` path is graceful degradation for long jobs — the dashboard can implement polling later as a pure additive change.

### Path B — Scheduled publish (cron or "Run Now")

```
CLOUDGRID CRON                    CONTENT-PIPELINE                       REDIS                  WORKERS
─────────────                     ────────────────                       ─────                  ───────

 hourly tick ────────────► GET /scheduled-publish
                                   │
                                   ├─ readSchedulerConfig (Layer 1 gate)
                                   │   if hour mismatch → return early (≤50ms, no flow created)
                                   │
                                   ├─ listActiveSites
                                   ├─ filter by per-site cadence (Layer 2)
                                   │
                                   ├─ if no due sites → write empty history entry, return
                                   │
                                   └─ create BullMQ Flow:
                                        parent: scheduler-run-<runId>
                                        children: N × generate jobs
                                                                          ──► all jobs queued
                                   return { runId, enqueued: N }                                ◄── workers pull
                                                                                                   children, process,
                                                                                                   complete

                                                                          ◄── all children done
                                                                          ──► parent ready

                                                                                                ◄── one worker picks up
                                                                                                    parent job
                                                                                                    │
                                                                                                    ├─ reads each child's
                                                                                                    │  returnvalue / failedReason
                                                                                                    │
                                                                                                    ├─ builds SchedulerRunEntry
                                                                                                    │
                                                                                                    └─ writes to GitHub
                                                                                                       (scheduler/history.json)
                                                                                                       — ONE commit total
```

**Why BullMQ Flows + parent job (instead of incremental Redis accumulator)?** Read the "Why BullMQ Flows for scheduler" decision section below. Short version: cleaner GitHub history, no race conditions on the YAML, and live mid-run visibility moves to a dedicated API rather than YAML snapshots.

---

## The job — what's inside

Same payload regardless of which path enqueued it:

```ts
// queue: "content-generation"
type GenerateJobData = {
  siteDomain: string;          // e.g. "coolnews-atl"
  count: number;               // articles to produce in this batch
  branch: string;              // "staging/<domain>" — required, prevents local-FS write path
  runId?: string;              // present only when scheduler enqueued (parent flow ID)
  triggeredBy: "manual" | "scheduled" | "scheduled-forced";
};

type GenerateJobResult = BatchContentGenerationResult;
// existing type — unchanged from current runContentGeneration() return value
```

The job's processor wraps `runContentGeneration(jobData, config)`. The agent function itself **does not change** — the work it does, the order, the per-article failure handling, the batch commit — all unchanged. We're just calling it from a BullMQ worker instead of an HTTP handler.

**Important:** `runContentGeneration` has a top-level try/catch — it never throws. It returns a result object with `status: "error"` on failure. For BullMQ to see failures (and trigger retries / dead-lettering), the worker processor wrapper must inspect the result and throw when appropriate:

```ts
async function processGenerateJob(job: Job<GenerateJobData>): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = job.data;

  // Pre-flight checks — throw UnrecoverableError BEFORE calling the agent
  const siteEntry = await findSiteEntry(siteDomain);
  if (!siteEntry) throw new UnrecoverableError(`Site "${siteDomain}" not in dashboard-index`);

  const brief = await readSiteBrief(siteDomain, branch);
  if (!brief?.schedule) throw new UnrecoverableError(`No publishing schedule for ${siteDomain}`);

  // Call the agent — it returns a result, never throws
  const result = await runContentGeneration(config, siteDomain, branch, count);

  // Inspect result — if ZERO articles created and errors present, surface to BullMQ
  const created = result.results.filter(r => r.status === "created").length;
  if (created === 0 && result.results.length > 0) {
    // All articles failed — likely transient (LLM down, rate limit)
    throw new Error(`All ${result.results.length} articles failed for ${siteDomain}`);
  }

  // Partial success (some articles created, some failed) — treat as success.
  // Per-article failures are captured in the result and don't warrant a retry
  // (retrying would re-spend LLM tokens on the successful articles too).
  return result;
}
```

This means `UnrecoverableError` is thrown **before** `runContentGeneration` (no LLM spend wasted), and transient total-failures trigger BullMQ retries.

---

## The job lifecycle

```
                  ┌────────┐
                  │ added  │  ◄── queue.add(...)
                  └───┬────┘
                      │
                      ▼
                  ┌────────┐
                  │waiting │   in Redis list, ready for any worker to claim
                  └───┬────┘
                      │ worker.process() pops it (atomic)
                      ▼
                  ┌────────┐
                  │ active │   leased to one worker; others can't claim
                  └───┬────┘
                      │
       ┌──────────────┼──────────────┬──────────────────────────┐
       │              │              │                          │
       ▼              ▼              ▼                          ▼
   ┌──────┐      ┌────────┐    ┌──────────┐              ┌─────────┐
   │ done │      │ failed │    │ stalled  │              │  Unrec- │
   │      │      │(retry) │    │          │              │  overab-│
   │      │      │        │    │          │              │   le    │
   └──────┘      └───┬────┘    └────┬─────┘              └────┬────┘
                     │              │                         │
                     │ exponential  │ lease expired           │ throw UnrecoverableError
                     │ backoff      │ (worker died /          │ → no retry, straight to failed-permanent
                     │              │  stuck)                 │
                     ▼              ▼                         ▼
                  ┌────────┐    ┌────────┐              ┌─────────────┐
                  │waiting │    │waiting │              │   failed    │
                  │(retry) │    │ (auto- │              │ (permanent) │
                  └────────┘    │ recover│              └─────────────┘
                                │  -ed)  │
                                └────────┘
```

**Each transition is atomic via Redis Lua scripts.** That's the whole point of using BullMQ — we're not reinventing distributed locks. The library handles claim-and-lease, stalled-job recovery, retry-with-backoff, and dead-lettering correctly.

### Retry policy

```ts
// applied to every job at enqueue time
{
  attempts: 3,                                       // 1 original + 2 retries
  backoff: { type: 'exponential', delay: 30_000 },   // 30s, 60s before retry attempts 2 and 3
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
}
```

**Why 3 attempts:** covers the common transient failures (Anthropic rate limit, network blip, GitHub commit conflict) without burning excessive tokens on doomed retries. The token-waste concern is bounded — the only retry path that re-spends LLM credits is "agent succeeded, batch commit failed" (rare; GitHub commits don't usually fail). Per-article failures don't bubble up, so they don't trigger BullMQ retries. (See "Why per-site granularity" decision below.)

**Why exponential 30s/60s instead of more aggressive backoff:** matches typical transient-failure recovery windows. Anthropic rate limits reset per-minute; GitHub rate limits are hourly but rare for our volume. Beyond 2 minutes, a "transient" issue probably isn't.

**Why retain failures 30 days:** postmortems sometimes happen weeks later. Successes age out fast (1 week / 1000) to keep Redis tidy.

### `UnrecoverableError` — skip retries for permanent failures

```ts
import { UnrecoverableError } from "bullmq";

// inside the worker processor wrapper — BEFORE calling runContentGeneration()
if (!siteEntry) {
  throw new UnrecoverableError(`Site "${siteDomain}" not in dashboard-index`);
}
if (!brief?.schedule) {
  throw new UnrecoverableError(`No publishing schedule for ${siteDomain}`);
}
```

**Why:** these failures will fail every retry. 3× retry on a misconfigured site = 90+ seconds wasted clock time and confusing log noise. `UnrecoverableError` makes BullMQ skip remaining attempts and move the job straight to `failed`. Engineer fixes the underlying config, manually re-enqueues if needed.

Note: `UnrecoverableError` is thrown in the **worker processor wrapper**, not inside `runContentGeneration()` itself. The agent function's try/catch stays unchanged — it returns error results, never throws. See "The job — what's inside" for the full wrapper pattern.

---

## Sync vs async — the new model

Recall the three layers from the wizard guide. Content generation has its own version:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Layer 1 — Browser UX (manual generation)                                       │
│   User clicks Generate, sees progress, eventually result.                      │
│   BEFORE: 60s blocking call. AFTER: same look, plus 202+jobId fallback.       │
└────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────┐
│ Layer 2 — Enqueuer side (dashboard route OR scheduler)                         │
│   Sequential awaits to enqueue, then EITHER waitUntilFinished (manual)         │
│   OR return immediately (scheduler).                                           │
│   Manual: 50ms enqueue + up to 90s wait.                                       │
│   Scheduler: ~5s for 100 enqueues.                                             │
└────────────────────────────────────────────────────────────────────────────────┘
                                ▼
                         (REDIS — durable
                          handoff layer)
                                ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Worker side (truly decoupled, persistent across restarts)            │
│   Pulls jobs, runs runContentGeneration, batch-commits to git.                 │
│   Survives process restarts. Multi-replica safe.                               │
│   ~30-60s per site batch.                                                      │
└────────────────────────────────────────────────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ Layer 4 — Sync-kv.yml CI (unchanged)                                           │
│   git commit → CI fires → KV/R2 updated → next request renders                 │
│   ~30-60s after commit.                                                        │
└────────────────────────────────────────────────────────────────────────────────┘
```

### What changed vs. the old model

| Old | New |
|---|---|
| Layer 2 = the entire generation work, blocking | Layer 2 = just enqueue. Generation moved to Layer 3. |
| No durable handoff between enqueuer and worker | Redis is the durable handoff. |
| Enqueuer crash mid-run = lost work | Enqueuer crash = jobs already in queue, workers continue. |
| One process did everything | Enqueuer (HTTP handler) and worker (BullMQ consumer) are separate concurrent paths in the same Node process. They communicate only through Redis. |

### Why dashboard uses `waitUntilFinished` instead of always returning a jobId

`waitUntilFinished(timeout)` blocks the HTTP handler in the dashboard route until the job completes (or 90s elapses). For 1-5 article batches that complete in <90s — the dominant case — the response shape is identical to the pre-migration response. The frontend doesn't change.

The 202+jobId path activates only when generation legitimately takes longer than 90s. At that point we want the user to be told "still working" rather than waiting on a stalled-looking spinner.

**This is intentionally an interim design.** Eventually we'll add a real polling UI in `ContentGenerationPanel` that hits `/api/agent/job/[id]` every few seconds and shows real progress (instead of the fake timer). That's an additive change — backend doesn't need to move. Until product cares about that UX upgrade, the current pattern is fine.

### Why scheduler returns immediately (no wait)

The scheduler doesn't run in a request context where someone is waiting on a response. CloudGrid cron fires it; its only job is to enqueue the day's work and exit. Whether the work takes 5 minutes or 60, the cron tick is done in seconds. Any caller wanting status looks at `scheduler/history.json` (after) or queries the live API (during).

---

## Why per-site jobs (not per-article)

This was a real architectural decision. Per-article would seem more granular and fault-tolerant — each article fails or succeeds independently, retries don't drag siblings down. But:

| Concern | Per-site | Per-article |
|---|---|---|
| Maps to existing `runContentGeneration` boundary | ✅ One-line change | ❌ Major rewrite |
| Aggregator API calls per generation run | 1 (paginate, 20 items, dedup, pick N) | N+ (each article needs its own item) |
| GitHub commits per run | 1 batch commit per site | N commits per site, OR a coordinator job to batch (complex) |
| `sync-kv.yml` runs per day at 10K articles | ~100 (one per site batch) | ~10,000 (one per article) → CI billing explosion |
| Per-article failure isolation | **Already provided by `processItem`'s try/catch** — failures are returned as `{ status: "error" }`, don't throw | Granular but overkill given the existing isolation |
| Retry token cost on real failure | Bounded per batch (~$3-8 worst case, rare) | Bounded per article — slightly cheaper, but the case is rare anyway |

**Decision: per-site jobs.** The existing `processItem` already isolates per-article failures inside a site batch. We don't need BullMQ to give us granularity the agent already provides. And avoiding the aggregator/CI/git-history multiplication is a substantial win.

If retry-token-waste ever becomes a real problem at scale, the future-proof escape valve is **in-job checkpointing**: the agent persists each completed article to a Redis temp key as it goes, and on retry skips already-completed articles. Stays in the per-site model. Don't build it speculatively — wait for evidence.

---

## Why the worker runs in content-pipeline (not as a separate service)

```
content-pipeline (single CloudGrid service)
├── HTTP server (existing)
│   ├── GET /health              ← extended: includes Redis connectivity + queue stats
│   ├── POST /content-generate   ← REMOVED from active use (dashboard enqueues directly to Redis)
│   │                              kept as a direct-execution fallback for testing/debugging
│   ├── GET /scheduled-publish   ← Layer-1 gate, then enqueues N flow children, returns
│   └── GET /job/:jobId          ← NEW: query job state (used by dashboard polling)
│
└── BullMQ Worker (new — same Node process, concurrency: 3)
    ├── consumes "content-generation" queue → processGenerateJob wrapper → runContentGeneration()
    └── consumes "scheduler-run" queue → parent processor → writes history to GitHub
```

The textbook answer is "separate worker service for clean separation." The pragmatic answer for our shape is colocate. Why:

1. **Our scaling axis isn't HTTP request volume — it's external API rate limits.** Anthropic, OpenAI, Gemini, GitHub. We tune throughput via BullMQ's `concurrency` and `limiter` regardless of process topology.
2. **Independent deploys are theoretical insurance we won't use.** content-pipeline gets deployed weekly at most. BullMQ's stalled-job recovery handles those events correctly — a worker disappearing for 30s, another picking up the job — that's literally what BullMQ is built for.
3. **CloudGrid favors fewer services.** Each service is real overhead: cloudgrid.yaml entry, secret duplication (REDIS_URL, GITHUB_TOKEN, GEMINI_API_KEY in two places), separate logs to correlate, separate health checks.
4. **Generation is IO-bound, not CPU-bound.** A Node event loop running 10 in-flight LLM calls (mostly waiting on network) has no meaningful contention with a `/health` HTTP request. Microseconds of overhead.

**When we'd split: when team size or scale changes.** If content-pipeline ever has a non-generation HTTP surface that scales differently (rare), or if we want different replica counts for API vs. workers (rare), splitting is a 2-hour PR — extract worker bootstrap to a separate entry-point file, add a `content-worker` service to cloudgrid.yaml. The agent code itself doesn't move.

---

## Why BullMQ Flows for the scheduler (not Redis-accumulator + incremental flushes)

Both options can produce a final `scheduler/history.json` entry. The question is **how we get there** and **what mid-run visibility looks like**.

### What we tried first (mentally): Redis accumulator

Each generate job carries `runMetadata: { runId, ... }`. On completion: `HSET scheduler-run:<runId>:results <site> <result>`, then trigger a flush check that writes the partial state to GitHub if N results accumulated or T seconds elapsed.

Mirrors the existing in-memory `RunHistoryAccumulator` pattern but with Redis as the buffer.

### Why we rejected it

- **Many GitHub commits per run.** Even with batching, you're committing N times to `scheduler/history.json` via Contents API. Each commit needs read SHA → modify → write → retry on 409 (concurrent edit). At 100 sites = 5-20 commits per run = git history pollution.
- **Race conditions on the YAML file.** Two completing jobs trying to flush at the same time both read the current SHA, both modify, only one wins. The other retries. Adds complexity for marginal benefit.
- **Mid-run YAML snapshots are stale by definition.** Last write minus N seconds. Editorial is checking at hour H+1 anyway; they don't care if the snapshot is fresh-to-the-second.

### What we picked: BullMQ Flows + live API

```
parent: scheduler-run-<runId>            ← created by /scheduled-publish handler
  └── children: 1 generate job per due site
```

When all children resolve (success or terminal failure), BullMQ marks the parent ready. Parent's processor:
1. Reads each child's `returnvalue` (success) or `failedReason` (failure)
2. Builds the `SchedulerRunEntry`
3. Writes to GitHub **once**

For mid-run visibility (when editorial WANTS fresh state): a new endpoint `/api/scheduler/active-run`:
```ts
// queries Redis directly, no GitHub flush
// returns: { runId, total, completed, inFlight, failed, sites: [...] }
```

This is fresher than YAML snapshots ever could be (real-time, not flush-cadence-bound) and doesn't pollute git history.

### Why this is better

| Property | Redis-accumulator | BullMQ Flows + live API |
|---|---|---|
| GitHub commits per run | N (or batched, ~5-20) | **1** |
| Race conditions on YAML file | Yes (handled with retry) | None |
| Mid-run visibility | YAML snapshots, stale by N seconds | Live API, real-time |
| Implementation complexity | Custom flush coordination | Built into BullMQ Flows |
| Editorial UX | Reads YAML | Reads YAML for history; live API for "what's happening now" |
| Engineer UX | Reads YAML + log-grep | Bull Board + live API + YAML |

Decision: Flows. The "incremental git history" feature isn't a feature — it was a workaround for not having a queue.

### Scheduler double-enqueue guard

At 100+ sites, a scheduled run can exceed 1 hour. Without protection, the next hourly cron tick would create a second Flow, doubling LLM spend for the same sites. BullMQ's deterministic `jobId` prevents this:

```ts
// In /scheduled-publish handler, when creating the Flow:
const runId = new Date().toISOString().slice(0, 13); // "2026-05-03T14" — hourly granularity

await flowProducer.add({
  name: "scheduler-run",
  queueName: "scheduler-run",
  data: { runId, timezone: schedCfg.timezone, forced: force, skipped },
  opts: {
    jobId: `scheduler-run-${runId}`,  // deterministic — BullMQ rejects duplicate
  },
  children,
});
```

If a `scheduler-run-2026-05-03T14` job is already active/waiting, `flowProducer.add()` silently returns the existing job. The handler detects this and returns early:

```ts
if (existingJob) {
  return { status: "skipped", reason: "active run in progress" };
}
```

**Why deterministic `jobId` instead of an explicit `getActive()` check:** race-free. Two concurrent cron ticks calling `getActive()` could both see zero active jobs and both proceed. The `jobId` check is atomic in Redis.

---

## Observability — three audiences

### Engineers (debugging "what broke?")

**Bull Board** — the de-facto BullMQ UI. Shows every job, retries, stalled detection, payload, error stack, timing. Free, open-source.

Mounted at `/admin/queues` in the dashboard, auth-gated to admin users:

```ts
// services/dashboard/src/app/admin/queues/[[...path]]/route.ts
// Bull Board does NOT have an official Next.js App Router adapter.
// Use a catch-all API route that creates a custom handler:
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
// See implementation for the App Router integration pattern.
// Do NOT use ExpressAdapter — it requires Express middleware,
// which is incompatible with Next.js App Router route handlers.
```

Capabilities engineers use:
- Live state of every job
- Retry a failed job manually
- Drain the queue (emergency)
- Inspect job payload, return value, error reason
- Filter by status, runId, age

### Editorial team ("did everything publish today?")

**`scheduler/history.json`** in the network repo — unchanged content, populated by the parent job's processor at end of run. Existing dashboard pages (`/scheduler/history`) read this; no changes needed.

For the small "what's happening right now?" use case (unusual but real — e.g. checking right after triggering a Run Now): the new `/api/scheduler/active-run` endpoint queries BullMQ. Dashboard surfaces it as a "Current run" card on the scheduler page.

### Manual generation users (the dashboard's existing toast)

For the manual flow, the existing toast pattern works:
- Success: "5 articles created — check the Worker Preview in 60s"
- Permanent fail: "Generation failed: <reason>" (BullMQ's `failedReason` propagates through)

No new UI surface needed. The 202+jobId path quietly enables polling later but doesn't surface anything different to the user today.

### Alerting (SkipFor v1)

We're not adding Slack/email alerts in v1. Add when we observe a pattern that warrants it (e.g. "5 jobs failed with the same error in the last hour" — this would warrant a webhook alert). Premature otherwise.

---

## What changes vs. stays exactly the same

| Concern | Today | After migration |
|---|---|---|
| `runContentGeneration()` agent function | Called directly from HTTP handler | **Unchanged.** Called from BullMQ worker. |
| `processItem` per-article logic (route → generate → image → SEO → score) | Sequential awaits, cross-model fallback | **Unchanged.** |
| `processWithConcurrency` (3 in-flight per agent run) | Used | **Unchanged.** |
| Aggregator pagination + dedup | Per-site | **Unchanged.** |
| Batch git commit at end | One commit per site batch | **Unchanged.** |
| `sync-kv.yml` CI flow | Triggered by commit on staging branch | **Unchanged.** |
| KV / R2 / Worker-side | (unrelated) | **Unchanged.** |
| Dashboard `/api/agent/generate` route | Sync proxy to content-pipeline via HTTP | Enqueues directly to Redis (bypasses content-pipeline HTTP). `waitUntilFinished(90s)` + 202 fallback. `getAgentUrl()` pattern no longer used for this route. |
| Dashboard `/api/agent/job/[id]` (new) | — | Queries BullMQ for state/progress |
| `/scheduled-publish` endpoint | Inline runs `runScheduledPublish` synchronously | Enqueues a Flow, returns runId |
| `runScheduledPublish` function | Iterates sites, calls runContentGeneration sequentially | Iterates sites, enqueues child jobs as Flow children |
| `RunHistoryAccumulator` | In-memory, flushes per site | **Deleted.** Replaced by parent-job processor at end of run. |
| `writeRunHistory(...)` | Called incrementally during run | Called once by parent-job processor at run end |
| `/api/scheduler/active-run` (new) | — | Queries BullMQ for in-progress run state |
| ContentGenerationPanel.tsx | Fake progress timer + 60s blocking fetch | **Unchanged for v1** (waitUntilFinished keeps the contract). Real polling deferred. |
| Scheduler dashboard page | Reads `scheduler/history.json` | Same + adds optional "Current run" card calling the new API |
| cloudgrid.yaml | (current) | + `REDIS_URL` secret on dashboard + content-pipeline |

The thing to internalize: **the agent itself doesn't change.** We're putting a queue in front of it. The blast radius of the migration is the orchestration layer (HTTP handlers, scheduler entry function), not the generation logic.

---

## Failure modes — what happens if X breaks

| Failure | Detection | Recovery |
|---|---|---|
| Worker process crashes mid-job | BullMQ lease expires (~30s) | Another worker picks up, retries from start. Token cost: ~30s of LLM work re-spent. Article slugs are idempotent so no duplicates. |
| Anthropic API down | `processItem` cross-model fallback to OpenAI | If both fail: per-article error captured in batch result, batch continues. No retry needed. |
| GitHub commit fails (rate limit, transient) | `runContentGeneration` returns error result; worker wrapper throws | BullMQ retries with exponential backoff (30s, 60s). After 3 attempts → failed. |
| Site missing from dashboard-index | Worker wrapper throws `UnrecoverableError` before calling agent | No retry. Job moves straight to failed-permanent. Visible in Bull Board. |
| Redis connection lost | Worker pause; jobs queue up at producers | Workers reconnect when Redis back. Queue continues. Producers (dashboard, scheduler) error out cleanly. |
| Upstash Redis dies / data loss | Hard failure — we lose the queue | Recovery: GitHub commits are still source of truth for content. Editor manually re-runs scheduler. We don't have an audit log of "what was enqueued" — accept this; Upstash uptime is high. |
| `scheduler/history.json` GitHub write fails (parent-job processor) | BullMQ retries the parent | Children's results are still in BullMQ. Worst case: history entry delayed a few minutes. |
| Two cron ticks overlap (run takes >1 hour) | Deterministic `jobId` rejects duplicate | Parent job uses `jobId: scheduler-run-YYYY-MM-DD-HH`. BullMQ rejects the duplicate `add()` if a job with that ID is still active. Cron tick returns early with `{ status: "skipped", reason: "active run in progress" }`. |
| Content-pipeline down, dashboard up | Dashboard enqueues to Redis, but no worker consuming | `waitUntilFinished` times out at 90s, returns 202 + jobId. Jobs queue up in Redis. Once pipeline restarts, worker drains the backlog. User sees "still working" during the gap. |

---

## File map — what to create / modify

### New files

```
services/content-pipeline/src/
├── queue/
│   ├── connection.ts            ← Redis connection + IORedis/BullMQ Connection helper
│   ├── content-generation.ts    ← Queue, Worker, QueueEvents instances
│   ├── scheduler-flow.ts        ← Flow producer (parent + children) + parent processor
│   └── index.ts                 ← exports + worker bootstrap (called from agents/.../index.ts)

services/dashboard/src/
├── lib/
│   └── queue.ts                 ← Queue + QueueEvents instances for enqueueing + waitUntilFinished
├── app/api/agent/job/[id]/route.ts   ← Status endpoint (GET) — proxies to content-pipeline /job/:id
└── app/api/scheduler/active-run/route.ts   ← Live run state (GET)

services/dashboard/src/app/admin/queues/[[...path]]/route.ts   ← Bull Board mount (Next.js App Router adapter)
```

### Modified files

```
services/content-pipeline/src/agents/content-generation/index.ts
  ↳ Worker.start() called at boot alongside HTTP server.
  ↳ /content-generate POST handler: kept as a direct-execution fallback for testing.
    Dashboard no longer calls this — it enqueues to Redis directly.
  ↳ /job/:id GET handler added: returns job state from BullMQ for dashboard polling.

services/content-pipeline/src/agents/scheduled-publisher/index.ts
  ↳ runScheduledPublish: Layer 1+2 gating unchanged.
  ↳ Site loop: instead of `await runContentGeneration(...)`, calls scheduler-flow.ts to add a Flow child.
  ↳ At end: returns runId + counts. No more in-loop history accumulation.

services/content-pipeline/src/agents/scheduled-publisher/history.ts
  ↳ Mostly unchanged (writeRunHistory function signature stays).
  ↳ Caller moves: was the loop, now the parent-job processor.
  ↳ RunHistoryAccumulator class can be deleted (unused after migration).

services/content-pipeline/src/agents/content-generation/agent.ts
  ↳ No changes to runContentGeneration itself — it stays a pure function that returns results.
  ↳ UnrecoverableError checks live in the worker processor wrapper (queue/content-generation.ts),
    NOT inside the agent function. The agent's top-level try/catch is preserved.

services/dashboard/src/app/api/agent/generate/route.ts
  ↳ Enqueue + waitUntilFinished + 202 fallback. ~30 lines.

services/dashboard/src/app/api/scheduler/run-now/route.ts
  ↳ Calls /scheduled-publish?force=true (unchanged endpoint, but now returns runId fast).

cloudgrid.yaml
  ↳ Add REDIS_URL to secrets list for dashboard + content-pipeline.

services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx
  ↳ Defer changes to a follow-up PR. waitUntilFinished keeps backward compatibility.

services/dashboard/src/app/scheduler/page.tsx (or equivalent)
  ↳ Add a "Current run" card that hits /api/scheduler/active-run.
```

---

## What we're NOT doing in this migration (deferred items)

These are real improvements but don't belong in the queue migration. Track them as separate tasks:

1. **Real progress polling UI in `ContentGenerationPanel`.** Currently a fake timer. After the queue is in, it's a pure additive change to the frontend. UX upgrade, not correctness.
2. **In-job article-level checkpointing for retry token-waste mitigation.** Premature without evidence we're losing meaningful Anthropic spend on retries. Add when observed.
3. **Per-site Slack/email alerts on permanent failure.** Premature without observed pattern. Bull Board + scheduler-history covers current observability needs.
4. **Splitting worker into a separate `content-worker` CloudGrid service.** 2-hour PR if/when team size or scaling profile changes.
5. **Higher worker concurrency / multiple replicas.** Today: 1 replica × concurrency 10 = ~30 articles/min. At 10K articles/day target: ~7/min average, well within. If we onboard the planned 100 sites all at once and need bursts, increase replicas. Not needed for v1.
6. **KV-backed dedup index (replacing `getAllExistingArticles` reading every article from GitHub).** Real bottleneck once any site has 500+ articles. Out of scope for queue migration but worth doing soon.

---

## Migration order — how to ship safely

**Don't do this as one giant PR.** Three steps, each independently revertable:

### Step 1 — Set up Redis + queue infra (no behavior change)

- Provision Upstash Redis. Add `REDIS_URL` to CloudGrid secrets for both services.
- Create `queue/` module in content-pipeline. Queue + Worker classes instantiated but the worker's processor is a stub that throws `"queue not yet wired"`.
- Add Bull Board mount.
- Deploy. Verify Redis reachable, Bull Board accessible, no jobs enqueued (existing flows unchanged).

**Rollback:** delete the new files, remove the secret. Nothing else changed.

### Step 2 — Migrate manual generation

- Wire `/api/agent/generate` to enqueue + waitUntilFinished.
- Worker processor: calls existing `runContentGeneration`. Add UnrecoverableError throws.
- Deploy.
- Test: click Generate on a site. Job appears in Bull Board. Result returns within 90s. Article appears in network repo, then on Worker Preview.

**Rollback:** revert `/api/agent/generate` route to direct HTTP proxy. Worker stays in place but receives no jobs. No data loss because work happens in the same agent function regardless.

### Step 3 — Migrate scheduled publish

- Wire `/scheduled-publish` to create a BullMQ Flow.
- Implement parent-job processor that builds and writes the SchedulerRunEntry.
- Add `/api/scheduler/active-run` endpoint.
- Deploy. Trigger a manual Run Now. Verify: enqueue is fast, workers process, history entry written at end.

**Rollback:** revert `/scheduled-publish` to inline `runScheduledPublish`. Parent-job processor goes unused but no harm.

After Step 3 is stable for ~a week: delete `RunHistoryAccumulator` and any remaining dead code. That's the final cleanup PR.

---

## Quick reference

**Queue name:** `content-generation` (jobs), `scheduler-run` (parent flows)
**Job payload:** `{ siteDomain, count, branch, runId?, triggeredBy }`
**Job result:** `BatchContentGenerationResult` (existing type)
**Worker concurrency:** 3 (matches pre-migration `MAX_SITES_CONCURRENT`; tune based on Anthropic/GitHub rate limits)
**Defaults:** 3 attempts, exponential 30s backoff, removeOnComplete 7d/1000, removeOnFail 30d
**Permanent-failure escape:** `throw new UnrecoverableError(...)` from the processor wrapper (not inside `runContentGeneration`)
**Scheduler guard:** deterministic `jobId: scheduler-run-YYYY-MM-DD-HH` prevents overlapping runs
**Live state:** `GET /api/agent/job/<id>` (single job), `GET /api/scheduler/active-run` (current scheduler run)
**Engineer UI:** Bull Board at `/admin/queues`
**Scheduler history (audit):** `atomic-labs-network` repo → `scheduler/history.json` → one commit per run
**Redis client:** `ioredis` (required by BullMQ — do NOT use `@upstash/redis` HTTP client)

---

## Companion docs

- `docs/developer-guide-site-creation.md` — wizard flow (foundational; covers the architecture diagram + sync/async layers + GitHub helpers shared with this flow)
- `docs/flow-map-he.md` — Hebrew-language flow map for non-technical stakeholders
- `~/.claude/projects/.../memory/flow_map_atl_network.md` — English memory file (terse reference, kept in sync with the Hebrew version)

When this content-generation flow changes (new queue, new failure mode, retry tuning), update **this** doc + the corresponding section in the flow maps. Treat doc updates as part of the change diff.
