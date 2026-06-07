# Ops Console API — QA / Reference

Per-site operational data for the content network: generation stats, health checks, AI cost, and alerts.
This doc is for **manually QA-ing** the endpoints built across the four ops-console subsystems.

## Base URLs

| Surface | URL | Notes |
|---|---|---|
| **Dashboard API (QA here)** | `https://sites-platform-e297.atomic.cloudgrid.io` (prod) · `http://localhost:3001` (`cloudgrid dev`) | Public — `/api/*` is **not** auth-gated (middleware excludes `/api/`). This is the surface external consumers + you use. |
| content-pipeline (internal) | `http://content-pipeline-app` (cluster) · `http://localhost:5000` (`cloudgrid dev`) | Internal only — the dashboard proxies it. You only hit it directly for the alerts cron (`/run-alerts`), which has no dashboard proxy. |

All responses are JSON. All `GET`. `:domain` is the **site folder name** (e.g. `travelswire`), *not* the custom domain.

---

## Prerequisites before data appears (read this first)

The endpoints respond immediately but will be **empty/zero/`unknown`** until the backing data exists:

1. **MongoDB must be provisioned + reachable.** In prod: `requires: mongodb: private` in `cloudgrid.yaml` injects `MONGODB_URL`/`MONGODB_URI` after deploy. Locally: set `MONGODB_URL` (e.g. a local mongod or Atlas) before `cloudgrid dev`, or stats/costs/attention return `503`.
2. **Stats/costs fill on generation.** `generation_events`/`cost_events` only get written when an article-generation run happens (scheduler tick, dashboard "Generate", or worker). Run a generation, then query. Optionally seed history with the **backfill** (below).
3. **Checks need credentials.** content-pipeline needs `CLOUDFLARE_API_TOKEN` (Workers KV Storage:Read) + `CLOUDFLARE_ACCOUNT_ID` for the sync/tracking checks; uptime/SSL/domain come from the **Domains Dashboard** (`DOMAINS_DASHBOARD_URL`, no auth). Without the CF token, `sync`/`tracking` return `state:"unknown"`.
4. **Alerts need Slack + a trigger.** Set `SLACK_WEBHOOK_URL` (content-pipeline) for messages to actually post. Alerts evaluate on the daily `run-alerts` cron and after each generation run; `/attention` reflects current state regardless.

### Backfill (seed stats from existing scheduler history)
One-time, idempotent. Imports `scheduler/history.json` into Mongo:
```bash
# inside content-pipeline service env (MONGODB_URL + GITHUB_TOKEN + NETWORK_REPO set)
cd services/content-pipeline && pnpm tsx src/stats/backfill.ts
```

---

## 1. Generation Stats — `/api/site-stats`

What it answers (the 6 original requirements + extras):

| You asked for | Field |
|---|---|
| When it last added articles (scheduler or dashboard) | `lastAdded.at` + `lastAdded.source` |
| How many it added | `lastAdded.count` |
| How many it *should* generate | `schedule.articlesPerDay` / `schedule.weeklyTarget` |
| Which days it generates | `schedule.preferredDays` (+ `schedule.nextRun`) |
| Last time it failed (empty if never) | `lastFailedAt` (null = never fully failed) |
| Generated vs expected | `thisWeek.created` vs `thisWeek.expected` |
| (added) Failed articles 7d/30d | `failedArticles.last7d` / `.last30d` |
| (added) Image-gen failures 7d/30d | `imageGenFailed.last7d` / `.last30d` |
| (added) Recent articles | `recentArticles[]` (title · score · status) |

**`GET /api/site-stats`** → `{ "sites": [ <SiteStat> ] }`
**`GET /api/site-stats/:domain`** → `{ "site": <SiteStat> }`

```jsonc
// <SiteStat>
{
  "siteDomain": "travelswire",
  "schedule": {                              // null until the site's first generation run
    "articlesPerDay": 3,
    "preferredDays": ["Monday", "Wednesday"],
    "weeklyTarget": 6,
    "nextRun": "2026-06-08T18:00:00.000Z"    // null if scheduler globally disabled
  },
  "lastAdded": { "at": "2026-06-07T14:02:11.000Z", "source": "scheduler", "count": 2 }, // source: scheduler|dashboard|wp-import; nulls if never added
  "lastFailedAt": null,                       // ISO string only on a full-failure run (0 created, status error)
  "thisWeek": { "created": 4, "expected": 6 },// week = since most-recent Monday 00:00 UTC
  "failedArticles": { "last7d": 1, "last30d": 3 },
  "imageGenFailed": { "last7d": 0, "last30d": 2 },
  "recentArticles": [
    { "title": "Best Thriller Movies 2026", "score": 87, "status": "published", "slug": "best-thriller-movies-2026", "publishDate": "2026-06-07" }
    // status: published | review | draft ; score null if unscored ; newest first, max 5
  ]
}
```
```bash
curl -s https://sites-platform-e297.atomic.cloudgrid.io/api/site-stats | jq
curl -s https://sites-platform-e297.atomic.cloudgrid.io/api/site-stats/travelswire | jq
```
**QA tip:** trigger a dashboard "Generate" for a site → within seconds `lastAdded.source` should read `"dashboard"` and `lastAdded.count` should match what you generated. Run the scheduler (or wait for its cron) → `source` reads `"scheduler"`.

---

## 2. Site Checks — `/api/site-checks`

Uptime · SSL · Domain-expiry (from the **Domains Dashboard**) + Sync · Tracking (ours from KV).

**`GET /api/site-checks`** → `{ "sites": [ { "siteDomain", "checks": <Checks> } ] }`
**`GET /api/site-checks/:domain`** → `{ "siteDomain": "...", "checks": <Checks> }`  *(note: bare object, not wrapped in `site`)*

```jsonc
// <Checks>
{
  "uptime": { "state": "ok", "ok": true, "statusCode": 200, "responseTimeMs": 142, "overallStatus": "healthy", "checkedAt": "…", "source": "domains-dashboard" },
  "ssl":    { "state": "ok", "status": "active", "daysLeft": 90, "expiresAt": "…" },
  "domain": { "state": "ok", "daysLeft": 285, "expiresAt": "…", "autoRenew": true },   // informational, no alert
  "sync":   { "state": "ok", "ok": true, "syncedAt": "…", "gitSha": "abc1234", "error": null }, // ok=false means last KV sync failed
  "tracking": { "state": "ok", "ga4": true, "gtm": false, "pixel": true }
}
```
- `state`: `"ok"` (data present) · `"n/a"` (staging-only site, no custom domain → uptime/ssl/domain) · `"unknown"` (source unreachable).
- `not_live` (HTTP 429, WordPress not-yet-migrated): `uptime.ok=false`, `uptime.overallStatus="not_live"`.
```bash
curl -s https://sites-platform-e297.atomic.cloudgrid.io/api/site-checks/travelswire | jq
```
**QA tip:** a Live site with a custom domain should show `uptime`/`ssl`/`domain` from the Domains Dashboard; a staging-only site shows those as `state:"n/a"`. `sync.ok=false` indicates the last `sync-kv` for that site failed.

---

## 3. Cost Tracking — `/api/site-costs`

Per-site AI spend by model (text tokens + image generation).

**`GET /api/site-costs`** → `{ "status": "ok", "sites": [ <SiteCost> ] }`
**`GET /api/site-costs/:domain`** → `{ "status": "ok", "site": <SiteCost> }`

```jsonc
// <SiteCost>
{
  "siteDomain": "travelswire",
  "totalCostUsd": 15.39,
  "byModel": [
    { "model": "claude-sonnet-4-6", "tokensUse": { "input": 1200000, "output": 410000 }, "images": 0,
      "costForToken": { "input": 3.0, "output": 15.0 }, "costUsd": 9.75, "estimated": true },
    { "model": "gpt-4o-mini",        "tokensUse": { "input": 300000, "output": 90000 }, "images": 0,
      "costForToken": { "input": 0.15, "output": 0.6 }, "costUsd": 0.099, "estimated": false },
    { "model": "gemini-2.5-flash-image", "tokensUse": { "input": 0, "output": 0 }, "images": 142,
      "costForToken": { "perImage": 0.039 }, "costUsd": 5.54, "estimated": false }
  ],
  "windows": { "thisWeekUsd": 1.12, "last30dUsd": 6.40 }
}
```
- **`estimated: true`** = token counts were estimated (Claude via the CloudGrid AI Gateway returns no usage, so we estimate ~4 chars/token). `false` = exact (OpenAI, local Anthropic SDK). Image cost is always `count × per-image`.
- `costForToken` is the static rate (USD/MTok for text, per-image for images).
```bash
curl -s https://sites-platform-e297.atomic.cloudgrid.io/api/site-costs/travelswire | jq
```
**QA tip:** generate a few articles, then check `byModel` — Claude text shows `estimated:true` in prod; `totalCostUsd` should be the sum of the per-model `costUsd`.

---

## 4. Alerts ("Needs Attention") — `/api/attention`

Currently-alerting conditions per site. The engine fires Slack for ATL-specific conditions; **down/SSL/domain alerting is owned by the Domains Dashboard, not here.**

**`GET /api/attention`** → `{ "status": "ok", "sites": [ <SiteAttention> ] }`
**`GET /api/attention/:domain`** → `{ "status": "ok", "site": <SiteAttention> }`

```jsonc
// <SiteAttention>
{
  "siteDomain": "travelswire",
  "alerting": [
    { "condition": "in_review",       "severity": "warn",     "since": "2026-06-07T14:00:00Z", "value": 17 },
    { "condition": "failed_articles", "severity": "warn",     "since": "2026-06-06T09:00:00Z", "value": 5 },
    { "condition": "sync_failed",     "severity": "critical", "since": "2026-06-07T13:40:00Z", "value": null }
  ]
}
```

### Conditions this engine fires (Slack message it sends)
| condition | fires when | Slack message | policy |
|---|---|---|---|
| `failed_articles` | `failedArticles.last7d > 3` | `⚠ {site}: {n} failed articles in 7d (limit 3)` | re-reminds daily while over |
| `sync_failed` | last KV sync `ok:false` | `🔴 {site}: content sync failed — visitors see old content` | once per transition |
| `in_review` | review count `> 15` | `⚠ {site}: {n} articles in review (limit 15)` | once on crossing 15 |
| `tracking_off` | GA/GTM **or** Pixel not present | `⚠ {site}: analytics/pixel not firing` | once per transition |

Reminders (network-wide, not per-site): **Review backlog** (`{n} articles waiting for review across the network`, weekly on Monday) · **Create new site** (`Time to create a new site`, every 14 days).

Thresholds/enables live in `scheduler/alerts.yaml` (network repo; defaults in code if absent). `imageGenFailed` ships **off**.

### Triggering alerts for QA
`/attention` reflects stored state. To make the engine **evaluate + post to Slack**:
- It runs automatically on the daily `run-alerts` cron, and a partial pass (`failed_articles` + `in_review`) after every generation run.
- Manual (internal endpoint, no dashboard proxy): from inside the cluster / locally:
  ```bash
  curl -s http://localhost:5000/run-alerts      # local cloudgrid dev
  # prod: cloudgrid exec into content-pipeline, or wait for the daily cron
  ```
- Then `curl .../api/attention/<domain>` to see the alerting state, and check your Slack channel for the message.
- **Dedup:** a condition fires once on transition (and `failed_articles` re-reminds at most once/24h). It won't re-spam on every run. Drop below the threshold to clear it, then it can fire again.

---

## Error responses
- `503` (stats/checks/costs/attention): MongoDB unreachable.
- `502` (dashboard routes): content-pipeline unreachable.
- `404`: unknown site (`/api/site-checks/:domain`) — others return zero/empty defaults for unknown sites rather than 404.

## Response-wrapper quick reference (they're not all identical)
| Endpoint | Collection shape | Single shape |
|---|---|---|
| site-stats | `{ sites: [...] }` | `{ site: {...} }` |
| site-checks | `{ sites: [...] }` | `{ siteDomain, checks }` *(bare)* |
| site-costs | `{ status:"ok", sites: [...] }` | `{ status:"ok", site: {...} }` |
| attention | `{ status:"ok", sites: [...] }` | `{ status:"ok", site: {...} }` |
