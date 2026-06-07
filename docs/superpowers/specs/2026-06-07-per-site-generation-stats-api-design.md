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
  "source":     "scheduler" | "dashboard",
  "forced":     false,            // scheduler force / dashboard bypassSchedule
  "topicName":  null,             // string for per-topic runs, else null
  "requested":  3,                // articlesRequested
  "created":    2,                // articlesCreated
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
    "weeklyTarget":   6                     // articlesPerDay * preferredDays.length (or articles_per_week)
  },
  "updatedAt":      "2026-06-07T14:02:11Z"
}
```

`thisWeek.created` (#6) is **computed on read** by aggregating `generation_events` for the current week
(it is not stored in the rollup, so it stays correct as the week rolls over without a write).

## Write path

A thin **recorder** runs immediately after `runContentGeneration()` returns, on **both** call paths
(the BullMQ worker and the direct-execution fallback), so scheduler and dashboard runs are both captured.

1. Map `BatchContentGenerationResult` → one `generation_events` insert.
2. Upsert `site_stats`:
   - always set `lastRunAt`, `updatedAt`, increment `totalCreated` by `created`;
   - set `lastAddedAt` / `lastAddedSource` / `lastAddedCount` **only when `created > 0`**;
   - set `lastFailedAt` **only when `status === "error"` and `created === 0`**;
   - overwrite the `schedule` snapshot from the brief loaded for this run.
3. `source` is a **new parameter** to the generation entrypoint: scheduler passes `"scheduler"`,
   the `/content-generate` HTTP handler passes `"dashboard"`.

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

## Out of scope

- Alerting / notifications on failures or under-delivery (the API exposes the data; consumers decide).
- A finished dashboard UI page (this design covers the API + data layer; the UI is a follow-up).
- Per-article failure tracking (#5 is run-level "full failure"; per-run `failed`/`status` are stored for future use).
