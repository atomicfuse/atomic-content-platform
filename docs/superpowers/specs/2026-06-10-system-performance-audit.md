# System Performance Audit — 2026-06-10

## Problem

After deploying the ops dashboard, the system feels slow/heavy. This spec documents all background activity, identifies what's taxing the system, and proposes fixes.

---

## 1. Cron Jobs

Two CloudGrid crons run on the content-pipeline service:

### Cron 1: `scheduled-publisher` — Hourly (`0 * * * *` EST)

| Step | External calls | Cost |
|------|----------------|------|
| Read `scheduler/config.yaml` | 1 GitHub API call | Low |
| Check global gate (enabled, hour match) | None (pure logic) | — |
| **If gate closed → exit** | **Total: 1 GitHub call, ~50ms** | **Cheap** |
| Read `dashboard-index.yaml` | 1 GitHub API call | Low |
| Per site: read `site.yaml` from staging branch | N GitHub API calls | Medium |
| Per eligible site: run content generation | Claude/OpenAI API + GitHub commits + n8n image webhooks + MongoDB writes | **Very high** |

**Key insight:** Most hourly ticks are **no-ops** (~50ms) because the global gate defaults to `run_at_hours: [14]`. Only the 2 PM EST tick does real work. The gate check costs 1 GitHub API call per hour = **24 calls/day**.

### Cron 2: `run-alerts` — Daily (`0 13 * * *` EST, = 9 AM EST)

| Step | External calls per site | With 6 sites |
|------|------------------------|--------------|
| Read `scheduler/alerts.yaml` | 1 GitHub call | 1 |
| Read `dashboard-index.yaml` | 1 GitHub call | 1 |
| Per site: `sync-status:<domain>` from KV | 1 Cloudflare KV REST API call | 6 |
| Per site: `site-config:<domain>` from KV | 1 Cloudflare KV REST API call | 6 |
| Per site: `article-index:<domain>` from KV | 1 Cloudflare KV REST API call | 6 |
| Per site: MongoDB aggregations (created/failed 14d/30d) | 2-3 MongoDB queries | ~18 |
| Evaluate conditions + update `alert_state` | MongoDB read/write | ~12 |
| Fire Slack notifications (if conditions met) | Slack webhook | 0-6 |

**Total per run:** ~2 GitHub + ~18 Cloudflare KV + ~30 MongoDB + 0-6 Slack = **~50 external calls**. Runs once daily. **Not a performance concern.**

---

## 2. Ops Dashboard Polling — THE MAIN SUSPECT

The ops dashboard (homepage) polls **5 API routes every 60 seconds** while any browser tab is open.

### Per-poll breakdown (every 60s)

| Dashboard route | Content-pipeline endpoint | External calls | Notes |
|-----------------|--------------------------|----------------|-------|
| `/api/site-stats` | `GET /site-stats` | **1 GitHub** (dashboard-index, 3s timeout) + **1 GitHub** (scheduler config, 2s timeout) + N MongoDB aggregations | Dashboard reads Git; pipeline reads MongoDB |
| `/api/site-checks` | `GET /site-checks` | **1 GitHub** (dashboard-index) + **2N Cloudflare KV REST** (sync + tracking per site, concurrency=5) + **1 Domains Dashboard** (external, 5s timeout) | **12 KV calls for 6 sites** per poll |
| `/api/site-costs` | `GET /site-costs` | N MongoDB aggregations | MongoDB only |
| `/api/attention` | `GET /attention` | 1 MongoDB query | Lightweight |
| `/api/r2-usage` | `GET /r2-usage` | 1 MongoDB read | Lightweight |

### Total external calls per 60s poll cycle (with 6 sites)

| Target | Calls per cycle | Calls per hour | Calls per day |
|--------|-----------------|----------------|---------------|
| **GitHub API** | 3 (dashboard-index x2 + scheduler config) | 180 | 4,320 |
| **Cloudflare KV REST API** | 12 (2 per site) | 720 | **17,280** |
| **Domains Dashboard** | 1 | 60 | 1,440 |
| **MongoDB queries** | ~15 (aggregations) | 900 | 21,600 |
| **Content-pipeline internal HTTP** | 5 | 300 | 7,200 |

### Scaling concern

With 50 sites (post-WordPress migration):

| Target | Calls per cycle | Calls per hour | Calls per day |
|--------|-----------------|----------------|---------------|
| **GitHub API** | 3 | 180 | 4,320 |
| **Cloudflare KV REST API** | 100 | 6,000 | **144,000** |
| **MongoDB queries** | ~55 | 3,300 | 79,200 |

**The Cloudflare KV REST API calls are the biggest scaling problem.** Each `/site-checks` poll makes 2 KV calls per site (sync + tracking), via the Cloudflare REST API (not Worker bindings — the content-pipeline is a Node service, not a Worker).

### Multiple tabs / users multiply everything

If two people have the dashboard open, all numbers double. Three tabs = triple.

---

## 3. GitHub API Rate Limit Budget

GitHub allows **5,000 requests/hour** per token.

Current consumption per hour (1 dashboard tab open):

| Source | Calls/hour |
|--------|------------|
| Ops dashboard polling (site-stats + site-checks) | ~180 |
| Scheduled-publisher gate check | 1 |
| Dashboard page navigations (tree reads, site config, articles) | ~50-200 (variable) |
| **Total** | **~230-380** |

This is well within limits. But the dashboard's **Infinity-TTL in-memory cache** for `dashboardIndexCache` and `treeCacheStore` means most Git reads are cache hits after the first load. The real cost is on cold start or after cache invalidation.

---

## 4. What the Dashboard Might Be Doing Wrong

### 4a. Dashboard → content-pipeline → Cloudflare KV (no caching)

The `/site-checks` endpoint on content-pipeline calls the **Cloudflare REST API** for every site, every 60 seconds, with **zero caching**. Each `getKVEntry()` is a fresh HTTPS call to `api.cloudflare.com`. This is:
- 12 HTTPS roundtrips (6 sites × 2 keys) per poll
- Each with 5s timeout
- Sequential within concurrency=5 batches

**This is likely the heaviest contributor to perceived slowness** — 12 external HTTPS calls serialized in batches of 5.

### 4b. Dashboard reads `dashboard-index.yaml` from Git twice per poll

Both `/api/site-stats` and `/api/site-checks` call `readDashboardIndex()`. The in-memory cache (Infinity TTL) should dedup this, but on cold start or after invalidation, it's 2 Git reads.

### 4c. Content-pipeline `/site-checks` also reads `dashboard-index.yaml` from Git

`getAllAtlChecks()` calls `listActiveSites()` which reads `dashboard-index.yaml` via Octokit. So dashboard-index is read up to **3 times** per poll cycle (2 on dashboard side + 1 on pipeline side).

### 4d. No server-side caching on content-pipeline check endpoints

`/site-stats`, `/site-checks`, `/site-costs` all query MongoDB/KV fresh every time. There's no short-TTL cache (e.g., "results valid for 30s") on the pipeline side.

---

## 5. What the Crons Are NOT Doing Wrong

- `scheduled-publisher` is **not** making Git calls every hour to read briefs. It exits at the gate check (1 Git call) on non-scheduled hours. Only on the scheduled hour does it read all briefs.
- `run-alerts` runs once daily. Its ~50 calls are negligible.
- Neither cron creates sustained load.

---

## 6. Proposed Improvements (Priority Order)

### P0 — Cache `/site-checks` KV results on content-pipeline (biggest win)

Sync status and tracking config don't change frequently (only on KV re-seed). A **60-second in-memory cache** on the pipeline side would eliminate 99% of Cloudflare KV REST calls.

**Impact:** -12 external HTTPS calls per poll cycle → 0 (except once per minute).
**With 50 sites:** -100 calls/cycle → 0.

### P1 — Cache `/site-stats` MongoDB results on content-pipeline

Stats don't change within a minute. A 30-60s cache on the pipeline's `/site-stats` response would eliminate redundant MongoDB aggregations.

**Impact:** -15 MongoDB queries per poll cycle.

### P2 — Cache `/site-costs` MongoDB results on content-pipeline

Same pattern. Cost data changes only when articles are generated.

**Impact:** -N MongoDB aggregations per poll cycle.

### P3 — Deduplicate `dashboard-index.yaml` reads

The dashboard calls `readDashboardIndex()` in both `/api/site-stats` and `/api/site-checks`. The Infinity-TTL cache already deduplicates after the first read, but the content-pipeline side also reads it independently via Octokit. Consider having the dashboard pass the site list to the pipeline (already known from the index) instead of the pipeline re-reading Git.

**Impact:** -1 GitHub API call per poll cycle on pipeline side.

### P4 — Increase poll interval or make it adaptive

60s is aggressive for an ops dashboard that rarely shows real-time changes. Options:
- Increase to 120s or 180s (halves/thirds all external calls)
- Adaptive: poll every 60s when the tab is focused, pause when tab is backgrounded (use `document.visibilityState`)
- Pause polling entirely if no one is looking at the ops dashboard (route-based)

**Impact:** 2-3x reduction in all external calls.

### P5 — Add response-level caching headers on pipeline endpoints

Return `Cache-Control: max-age=30` from pipeline endpoints. The dashboard's `fetch()` would serve from HTTP cache for 30s without hitting the pipeline at all.

---

## 7. Summary

| Concern | Verdict |
|---------|---------|
| Cron: scheduled-publisher | **Fine.** Most ticks are 1 Git call, ~50ms no-ops. |
| Cron: run-alerts | **Fine.** Once daily, ~50 calls total. |
| Dashboard polling: MongoDB | **Moderate.** ~15 aggregations/min, cacheable. |
| Dashboard polling: GitHub | **Fine.** Infinity-TTL cache handles it. |
| Dashboard polling: Cloudflare KV REST | **Problem.** 12+ uncached HTTPS calls to api.cloudflare.com per minute, scaling to 100+ with more sites. |
| Dashboard polling: Domains Dashboard | **Fine.** 1 call/min. |
| Multiple tabs/users | **Multiplier.** Each open tab doubles everything. |

**Root cause of "heavy" feeling:** Most likely the `/site-checks` route, which makes 12 uncached Cloudflare KV REST API calls per poll. Each is an external HTTPS roundtrip to `api.cloudflare.com` with a 5s timeout, batched in groups of 5. On a slow network or when Cloudflare is sluggish, this alone can add 2-5s of latency per poll.

**Recommended fix order:** P0 (cache KV) → P4 (adaptive polling) → P1+P2 (cache MongoDB) → P3+P5 (dedup/headers).
