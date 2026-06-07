# Per-Site Generation Stats API — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** michal + Claude Code

## Problem

We need an API that reports, for each site, its content-generation health:

1. **Last time articles were added** — by the scheduler *or* by a manual dashboard "Generate".
2. **How many articles were added** (in that last run).
3. **How many it should generate** per the scheduler config.
4. **Which days** it should generate (scheduler `preferred_days`).
5. **Last time it failed** — empty if it never failed; otherwise the timestamp of the last failed generation.
6. **Generated vs. expected** — articles created this week vs. the weekly target.

### Why the current system is insufficient

The scheduler already records per-site results to `scheduler/history.json` in the network repo
(`{ timestamp, timezone, forced, sites: [{ domain, status, articlesCreated, articlesRequested, message }], skipped }`),
and there is a `GET /api/scheduler/history` route. But:

- **Manual dashboard generations** (`POST /api/agent/generate` → content-pipeline) are **not persisted anywhere**.
- `history.json` is a **rolling cap of 50 entries in git** — older runs (and old failures) are lost, and git is a poor store to query.
- There is **no per-site rollup** to answer "what's the state of site X right now".

There is currently **no database** in the platform — persistence is Git + Cloudflare KV + R2 (+ optional Redis/BullMQ).
This design adds the platform's first MongoDB store (CloudGrid Mongo).

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Primary consumer | **Both** a dashboard monitoring UI **and** external/automated consumers (stable JSON contract). |
| Data model | **Event log + computed rollup.** Immutable per-run events + a per-site summary doc for fast reads. |
| "Expected" window (#6) | **Current week.** Created-this-week vs. weekly target. |
| Failure definition (#5) | **Full failures only** — a run with `status: "error"` and `created == 0`. (Per-run `failed`/`status` still stored, so the definition can change later without data loss.) |
| Backfill | **Yes**, one-time from `scheduler/history.json` (scheduler runs only; manual gens were never recorded). |
| Architecture | **A — content-pipeline owns Mongo (write + read); dashboard proxies the read API.** |
| Schedule source (#3/#4) | **Snapshot stamped into the rollup at generation time** (the brief is already loaded during a run). |

## Architecture

```
  Scheduler (BullMQ Flow / direct fallback) ┐
                                            ├─► runContentGeneration()  ──► [recorder] ──► MongoDB
  Dashboard "Generate" (/content-generate) ─┘                                              (content-pipeline owns it)
                                                                                                │
  External consumer ─► dashboard /api/site-stats ─(proxy)─► content-pipeline /site-stats ◄──────┘
  Dashboard UI ──────►       (public, NextAuth)              (internal, cluster DNS)
```

- **content-pipeline** is internal-only (`http://content-pipeline-app`, no public path). It owns the single Mongo connection, writes events, and serves `/site-stats`.
- **dashboard** is the public outlet with NextAuth. Its `/api/site-stats` proxies to the pipeline (the existing proxy pattern, same as `/api/agent/generate`), giving external + authenticated access.
- Mongo is declared in `cloudgrid.yaml` under the content-pipeline service's `requires:` (mirrors `- redis: private`). Exact binding key / injected env var name to be confirmed against CloudGrid docs during planning.

## Data model (MongoDB)

### Collection `generation_events` — immutable, append-only, one doc per run

```jsonc
{
  "siteDomain": "travelswire",
  "source":     "scheduler" | "dashboard" | "wp-import",
  "forced":     false,            // scheduler force / dashboard bypassSchedule
  "topicName":  null,             // string for per-topic runs, else null
  "requested":  3,                // articlesRequested
  "created":    2,                // articlesCreated
  "failed":     1,                // count of results[] with an error outcome (article-level)
  "status":     "success" | "partial" | "error" | "no_content",
  "message":    null,             // optional error/summary message
  "startedAt":  "2026-06-07T14:00:03Z",
  "finishedAt": "2026-06-07T14:02:11Z"
}
```

Indexes: `{ siteDomain: 1, finishedAt: -1 }`, `{ finishedAt: -1 }`.

### Collection `site_stats` — one rollup doc per site, upserted each run

```jsonc
{
  "_id":            "travelswire",          // siteDomain
  "lastRunAt":      "2026-06-07T14:02:11Z",
  "lastAddedAt":    "2026-06-07T14:02:11Z", // most recent run with created > 0      → #1
  "lastAddedSource":"scheduler",            //                                       → #1
  "lastAddedCount": 2,                      //                                       → #2
  "lastFailedAt":   null,                   // last run with status="error" & created=0 → #5
  "totalCreated":   128,
  "schedule": {                             // SNAPSHOT, stamped at generation time
    "articlesPerDay": 3,                    //                                       → #3
    "preferredDays":  ["Monday", "Wednesday"], //                                    → #4
    "weeklyTarget":   6                     // see weeklyTarget derivation below
  },
  "updatedAt":      "2026-06-07T14:02:11Z"
}
```

`thisWeek.created` (#6) is **computed on read** by aggregating `generation_events` for the current week
(it is not stored in the rollup, so it stays correct as the week rolls over without a write).

**`weeklyTarget` derivation (matches the scheduler's existing fallback / landmine #6):** the brief may carry
`articles_per_day` *or* only the legacy `articles_per_week`. Compute the snapshot as:
`articlesPerDay = brief.schedule.articles_per_day ?? ceil(articles_per_week / preferred_days.length)`, and
`weeklyTarget = articlesPerDay * preferredDays.length` (equivalently `articles_per_week` when only that is set).
Reuse the scheduler's existing resolution logic rather than re-deriving it.

## Write path

A thin **recorder** runs immediately after `runContentGeneration()` returns and records one event.
The non-trivial part is that the fields the recorder needs are **not** all present on the result object,
and the three callers of `runContentGeneration` each derive outcome differently today. This section is
deliberately explicit so the planner doesn't build against a shape that doesn't exist.

### What `runContentGeneration` actually returns

`BatchContentGenerationResult` (`agent.ts`) carries: `siteDomain`, `requested`, `totalSourced`,
`duplicateCount`, `availableNew`, `n8nImagesTriggered`, and `results: ContentGenerationResult[]`.
It does **not** carry `created`, `status`, `forced`, `topicName`, `message`, `startedAt`, or `finishedAt`.
Those are **derived** or **call-site context**:

- `created` = count of `results` with a "created" outcome (derive from `results[]`).
- `status` (`success` | `partial` | `error` | `no_content`) — this four-state derivation currently lives
  **only** in the scheduler (`scheduled-publisher/index.ts`, producing a `SiteRunResult`). The dashboard
  HTTP handler (`content-generation/index.ts`) and the BullMQ worker (`queue/content-generation.ts`) each
  compute their own *different* created/error notions and never produce a `status` or `message`.
- `forced`, `topicName`, `startedAt`, `finishedAt`, `source` — **call-site context**, not on the result.

### Required refactor: one shared mapper

Extract the scheduler's status-derivation into a **single shared function**
`buildGenerationEvent(result, ctx)` where `ctx = { source, forced, topicName, startedAt, finishedAt }`,
returning the `generation_events` doc (and the `SiteRunResult` the scheduler already needs, so the
scheduler is refactored to call it rather than duplicating logic). This guarantees all three callers
produce identical `created`/`status`/`message` semantics.

### Wire the recorder into all THREE call sites

There are three distinct callers, and the dashboard path is the whole reason this project exists
(manual gens are currently unrecorded). The recorder must fire on **all three**, with `source` set correctly:

1. **Scheduler direct-execution fallback** (`scheduled-publisher/index.ts`) — `source: "scheduler"`.
2. **BullMQ Flow worker** (`queue/content-generation.ts`) — shared infra used by *both* scheduler and dashboard,
   so `source` must come from the **job payload**, not be inferred from the worker.
3. **Dashboard HTTP handler** (`content-generation/index.ts`, `/content-generate`) — `source: "dashboard"`.

`source` is therefore threaded as an explicit field set at the **originating entrypoint** (scheduler enqueue/direct
→ `"scheduler"`; dashboard request → `"dashboard"`) and carried through the job payload when the BullMQ path is used.

**Reuse the existing `triggeredBy`, don't add a parallel concept.** `GenerateJobData` already carries
`triggeredBy: "manual" | "scheduled" | "scheduled-forced" | "wp-import"` (`queue/types.ts`), which already
encodes origin through the job payload. Derive `source` from it rather than introducing a second origin field
that can drift:
- `"manual"` → `source: "dashboard"`
- `"scheduled"` / `"scheduled-forced"` → `source: "scheduler"`
- `"wp-import"` → `source: "wp-import"` (**add this third enum value** to `generation_events.source` and the API;
  do not silently fold it into `dashboard`, or WP-import-triggered generations become an unmapped case).

Likewise derive `forced` from existing signals: `triggeredBy === "scheduled-forced"` (scheduler) or the
dashboard's `bypassSchedule` flag — not a new field.

### Steps (per completed run)

1. `event = buildGenerationEvent(result, ctx)` → insert into `generation_events`.
2. Upsert `site_stats`:
   - always set `lastRunAt`, `updatedAt`, increment `totalCreated` by `event.created`;
   - set `lastAddedAt` / `lastAddedSource` / `lastAddedCount` **only when `event.created > 0`**;
   - set `lastFailedAt` **only when `event.status === "error"` and `event.created === 0`**;
   - overwrite the `schedule` snapshot from the brief loaded for this run (see weeklyTarget note below).

**Failure isolation (critical):** every Mongo operation is wrapped in try/catch and logged.
A DB error must **never** break or fail generation — same principle already enforced in `history.ts`
("history persistence must never break the scheduler").

## Read API

### content-pipeline (internal)

- `GET /site-stats` → array of per-site event-derived summaries from Mongo.
- `GET /site-stats/:domain` → single site.

Returns the rollup fields plus `thisWeek.created` (aggregated for the current week).

### dashboard (public, proxied)

- `GET /api/site-stats` and `GET /api/site-stats/:domain` (NextAuth-gated).
- Lists **all** sites from `dashboard-index.yaml` (so never-generated sites still appear), proxies pipeline data, and merges.

### Response shape (per site)

```jsonc
{
  "siteDomain": "travelswire",
  "schedule":   { "articlesPerDay": 3, "preferredDays": ["Monday","Wednesday"], "weeklyTarget": 6 }, // #3, #4
  "lastAdded":  { "at": "2026-06-07T14:02:11Z", "source": "scheduler", "count": 2 },                  // #1, #2
  "lastFailedAt": null,                                                                              // #5
  "thisWeek":   { "created": 4, "expected": 6 }                                                      // #6
}
```

## Backfill (one-time)

A script (run once as a CloudGrid one-off job or locally) reads `scheduler/history.json` from network `main`:

- maps each `entry.sites[]` → a `generation_events` doc (`source: "scheduler"`, `forced: entry.forced`,
  `startedAt`/`finishedAt` from `entry.timestamp`);
- rebuilds `site_stats` from the imported events.
- **Idempotent**: each event uses a deterministic `_id` derived from `timestamp + domain`, so re-running does not duplicate.

## Known limitations

- **Snapshot schedule:** a site that has **never generated** shows `schedule: null` (and no `expected`) until its first run.
  The backfill can only set `articlesRequested` as a rough proxy for `articlesPerDay` — `history.json` does **not** store
  `preferred_days`, so `preferredDays`/`weeklyTarget` only populate accurately on the first real run after deploy.
- **Manual gens are not backfillable** — they were never recorded; history starts at deploy for the dashboard source.
- The `schedule` snapshot can be briefly **stale** if a site's cadence is changed between runs (accepted trade-off of the snapshot decision; refreshes on next run).

## Error handling

- **Writes:** try/catch per op; log and continue — generation never breaks.
- **Connection:** lazy singleton Mongo client, mirroring `queue/connection.ts`. Declared via `requires:` in `cloudgrid.yaml`.
- **Reads:** Mongo unreachable → API returns `503` with a clear error; a site with no events → nulls + `thisWeek.created: 0`.

## Testing

- **Unit:**
  - `BatchContentGenerationResult` → `generation_events` mapping.
  - Rollup rules: `lastAddedAt` only when `created > 0`; `lastFailedAt` only on full failure (`status="error"`, `created=0`); `totalCreated` increment; schedule-snapshot overwrite.
  - Current-week aggregation for `thisWeek.created`.
  - Backfill idempotency (re-run yields no duplicates).
- **Integration:**
  - `mongodb-memory-server` write→read round-trip across both collections.
  - Assert a thrown Mongo error inside the recorder does **not** propagate out of the generation path.

## Out of scope (this spec)

- A finished dashboard UI page (this design covers the API + data layer; the UI is a follow-up).
- Site health checks (uptime/sync/SSL/tracking) — see the **Site Checks** spec.
- Cost / token tracking — see the **Cost Tracking** spec.
- Slack alerting + reminders — see the **Slack Alerts & Reminders** spec. (Note: image-gen failures
  already fire a Slack notice today via `notifyImageDefaultFallback`, landmine #34 — the alerts spec
  formalizes/owns that.)

---

# 2026-06-07 Expansion — ops-console fields

This subsystem is the first of four (Stats → Checks → Costs → Alerts) that together back a per-site
"ops console". This section extends the Stats API with the remaining generation-domain fields the console
needs. The sibling subsystems live in their own specs and share the same content-pipeline-owned Mongo +
dashboard-proxy pattern.

## New requirement: failed-article counts (7d / 30d)

`generation_events` now carries `failed` (count of `results[]` with an error outcome). The API exposes:

```
"failedArticles": { "last7d": 4, "last30d": 11 }
```

Computed on read by summing `failed` over `generation_events` in each window. (Distinct from `lastFailedAt`,
which is the run-level "full failure" timestamp.)

## New requirement: image-generation failures (7d / 30d)

Image generation is **async via n8n** and completes on a **separate path** — the callback handler
`handleImageCallback` (`content-pipeline/.../n8n-image.ts`), reached via the dashboard proxy
`/api/agent/image-callback`. A failure is observable there when `payload.status !== "ok"` or `data_base64`
is missing; the payload carries `site_domain`, `slug`, and `error`.

**New collection `image_gen_events`** — one doc per image callback outcome:

```jsonc
{
  "siteDomain": "travelswire",
  "slug":       "best-thriller-movies-2026",
  "ok":         false,
  "provider":   "gemini",          // payload.meta.provider
  "error":      "…",               // payload.error, when failed
  "at":         "2026-06-07T14:05:00Z"
}
```

Index: `{ siteDomain: 1, at: -1 }`. The recorder hook lives in `handleImageCallback` (same failure-isolation
rule — never break the callback). API exposes:

```
"imageGenFailed": { "last7d": 1, "last30d": 3 }
```

(Both `ok` and failed outcomes are stored so a future success-rate metric is possible; only failures are surfaced now.)

> Note: the bulk-image path (`bulk-image.ts`) uses the **same** n8n callback, so it is covered automatically.

## New requirement: "next run" in the schedule block

`schedule` gains `nextRun` — the next datetime the scheduler would generate for this site, computed from the
global gate (`scheduler/config.yaml`: `run_at_hours`, `timezone`) intersected with the site's `preferredDays`.
Computed on read (no storage). If the scheduler is globally disabled, `nextRun: null`.

```
"schedule": { "articlesPerDay": 3, "preferredDays": ["Monday","Wednesday"], "weeklyTarget": 6, "nextRun": "2026-06-09T14:00:00-04:00" }
```

## New requirement: recent articles (title · score · status)

A per-site list of the most recent N articles (default 5), surfaced for the console's "Recent articles" panel.

- **Source:** reuse the dashboard's existing `readArticlesWithKVFallback(domain, branch, readArticles)` path
  (the same one the review queue uses) — articles are **not** in Mongo. Sort by `publishDate` desc, take N.
- **Fields:** `title`, `quality_score` (frontmatter), `status` (`published` | `review`), `slug`, `publishDate`.
- **Where:** this enrichment runs in the **dashboard** `/api/site-stats` layer (it owns article reading and the
  KV/GitHub fallback), not in content-pipeline. Keeps Mongo scoped to generation/image events.

```
"recentArticles": [
  { "title": "Best Thriller Movies 2026", "score": 87, "status": "published", "slug": "best-thriller-movies-2026", "publishDate": "2026-06-07" }
]
```

## Consolidated per-site response (Stats subsystem)

```jsonc
{
  "siteDomain": "travelswire",
  "schedule":       { "articlesPerDay": 3, "preferredDays": ["Monday","Wednesday"], "weeklyTarget": 6, "nextRun": "…" },
  "lastAdded":      { "at": "…", "source": "scheduler", "count": 2 },
  "lastFailedAt":   null,
  "thisWeek":       { "created": 4, "expected": 6 },
  "failedArticles": { "last7d": 4, "last30d": 11 },
  "imageGenFailed": { "last7d": 1, "last30d": 3 },
  "recentArticles": [ /* … */ ]
}
```

The Checks / Costs / Alerts subsystems each add their own block (`checks`, `costs`, `attention`) to the same
per-site aggregate over time; consumers can request the Stats block alone or the full aggregate.

## Expansion — additions to testing

- `failed`-count summation over 7d/30d windows.
- `image_gen_events` recorder maps a failed n8n callback correctly and never throws out of `handleImageCallback`.
- `nextRun` computation across timezone + `preferred_days` (incl. globally-disabled → null; DST boundary).
- Recent-articles sort/limit and `published`/`review` status mapping.
