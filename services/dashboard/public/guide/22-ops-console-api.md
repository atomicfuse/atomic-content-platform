# Ops Console API

Per-site operational data for the content network: **generation stats, health checks, AI cost, and alerts**. These are public dashboard API endpoints (`/api/*`) you can query directly for QA, monitoring, or external integrations.

## Base URL & conventions

- **Prod:** `https://sites-platform-e297--atomic.cloudgrid.io`
- **Local (`cloudgrid dev`):** `http://localhost:3001`
- All endpoints are `GET`, return JSON, and are **not auth-gated** (`/api/*` is excluded from auth).
- `:domain` is the **site folder name** (e.g. `travelswire`), not the custom domain.

## Before data appears

The endpoints respond immediately but stay empty/zero/`unknown` until the backing data exists:

- **MongoDB must be reachable** (`requires: mongodb` provisions it in prod; set `MONGODB_URL` locally) — otherwise stats/costs/attention return `503`.
- **Stats & costs fill on generation** — `generation_events`/`cost_events` are written when an article-generation run happens (scheduler, dashboard "Generate", or worker). A one-time backfill (`pnpm tsx src/stats/backfill.ts`) seeds stats from `scheduler/history.json`.
- **Checks need credentials** — content-pipeline needs `CLOUDFLARE_API_TOKEN` (Workers KV Storage:Read) for sync/tracking; uptime/SSL/domain come from the Domains Dashboard.
- **Alerts need Slack** — set `SLACK_WEBHOOK_URL` for messages to actually post.

---

## 1. Generation Stats — `/api/site-stats`

`GET /api/site-stats` returns `{ "sites": [ <SiteStat> ] }`.
`GET /api/site-stats/:domain` returns `{ "site": <SiteStat> }`.

Each `<SiteStat>` contains:

- `schedule` — `{ articlesPerDay, preferredDays, weeklyTarget, nextRun }` (null until the site's first run; `nextRun` null if the scheduler is globally disabled).
- `lastAdded` — `{ at, source, count }` — when articles were last added, by whom (`scheduler` / `dashboard` / `wp-import`), and how many.
- `lastFailedAt` — ISO timestamp of the last full-failure run (0 created, status error); null if it never fully failed.
- `thisWeek` — `{ created, expected }` — articles created this week (since most-recent Monday 00:00 UTC) vs the weekly target.
- `failedArticles` — `{ last7d, last30d }` — count of article-level failures.
- `imageGenFailed` — `{ last7d, last30d }` — count of failed image generations (from the n8n callback).
- `reviewCount` — number of articles currently in `review` status (full count, no threshold).
- `generalImages` — number of articles still on a default/general image (featuredImage missing or containing `general-article`).
- `recentArticles` — up to 5 newest articles, each `{ title, score, status, slug, publishDate }` (status `published` / `review` / `draft`; score null if unscored).

Example:

```bash
curl -s "$BASE/api/site-stats/travelswire" | jq
```

**Quick check:** trigger a dashboard "Generate" → within seconds `lastAdded.source` reads `"dashboard"` and `lastAdded.count` matches what you generated.

---

## 2. Site Checks — `/api/site-checks`

`GET /api/site-checks` returns `{ "sites": [ { "siteDomain", "checks": <Checks> } ] }`.
`GET /api/site-checks/:domain` returns `{ "siteDomain", "checks": <Checks> }` (the merged object directly).

Each `<Checks>` contains five blocks, each with a `state` of `ok` / `n/a` / `unknown`:

- `uptime` — `{ state, ok, statusCode, responseTimeMs, overallStatus, checkedAt }`. `overallStatus` is one of `healthy` / `warning` / `critical` / `not_live` / `unknown`. (Source: Domains Dashboard.)
- `ssl` — `{ state, status, daysLeft, expiresAt }`. (Source: Domains Dashboard.)
- `domain` — `{ state, daysLeft, expiresAt, autoRenew }` — domain-registration expiry, informational only. (Source: Domains Dashboard.)
- `sync` — `{ state, ok, syncedAt, gitSha, error }`. `ok:false` means the last KV sync for the site failed. (Source: our KV `sync-status`.)
- `tracking` — `{ state, ga4, gtm, pixel }` — config-presence of each tag. (Source: our resolved config.)

Notes:

- Staging-only sites (no custom domain) show `uptime`/`ssl`/`domain` as `state: "n/a"`.
- A WordPress site not yet migrated shows `uptime.overallStatus: "not_live"` (HTTP 429) with `uptime.ok: false`.

```bash
curl -s "$BASE/api/site-checks/travelswire" | jq '.checks | {status: .uptime.overallStatus, sync, ssl, tracking}'
```

---

## 3. Cost Tracking — `/api/site-costs`

`GET /api/site-costs` returns `{ "status": "ok", "sites": [ <SiteCost> ] }`.
`GET /api/site-costs/:domain` returns `{ "status": "ok", "site": <SiteCost> }`.

Each `<SiteCost>` contains:

- `totalCostUsd` — all-time total.
- `byModel` — an array, one entry per model: `{ model, tokensUse: { input, output }, images, costForToken, costUsd, estimated }`.
- `windows` — `{ thisWeekUsd, last30dUsd }`.

About `estimated`: Claude runs through the CloudGrid AI Gateway, which returns no token counts, so those are **estimated** (~4 chars/token, `estimated: true`). OpenAI and the local Anthropic SDK report exact counts (`estimated: false`). Image cost is always `count × per-image price`.

```bash
curl -s "$BASE/api/site-costs/travelswire" | jq '.site | {totalCostUsd, byModel}'
```

---

## 4. Alerts ("Needs Attention") — `/api/attention`

`GET /api/attention` returns `{ "status": "ok", "sites": [ <SiteAttention> ] }`.
`GET /api/attention/:domain` returns `{ "status": "ok", "site": <SiteAttention> }`.

Each `<SiteAttention>` has an `alerting` array of currently-firing conditions: `{ condition, severity, since, value }` (`severity` is `warn` or `critical`; `value` is the number for numeric conditions, null for boolean ones).

Conditions this engine fires (and the Slack message it sends):

- `failed_articles` — failed articles in 7d exceed the limit (default 3). `⚠ {site}: {n} failed articles in 7d (limit 3)`. Re-reminds at most once/day while over.
- `sync_failed` — last KV sync failed. `🔴 {site}: content sync failed — visitors see old content`. Once per transition.
- `in_review` — review count exceeds the limit (default 15). `⚠ {site}: {n} articles in review (limit 15)`. Once on crossing.
- `tracking_off` — GA/GTM or the Meta pixel is not present. `⚠ {site}: analytics/pixel not firing`. Once per transition.

Network-wide reminders: **Review backlog** (`{n} articles waiting for review across the network`, weekly) and **Create new site** (`Time to create a new site`, on a cadence).

Down / SSL / domain-expiry alerting is owned by the Domains Dashboard, not this engine. `imageGenFailed` ships disabled.

The engine evaluates on a daily cron (`/run-alerts`) and after every generation run; `/api/attention` reflects the current state at any time. Conditions de-dupe — they fire once on transition and clear when the condition resolves.

---

## 5. Scheduler Weekly Summary — `/api/scheduler-summary`

`GET /api/scheduler-summary` (dashboard proxy) returns the current week's per-site daily generation grid merged with review counts.

The dashboard proxies to the content-pipeline's `GET /scheduler-summary` endpoint. Data is written by the scheduler after each run (cron or forced).

### Response shape

```json
{
  "weekOf": "2026-06-08",
  "timezone": "EST",
  "days": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  "sites": [
    {
      "domain": "travelswire",
      "days": [
        { "expected": 0, "created": 0 },
        { "expected": 3, "created": 3 },
        { "expected": 0, "created": 0 },
        { "expected": 3, "created": 2 },
        { "expected": 0, "created": 0 },
        { "expected": 3, "created": 3 },
        { "expected": 0, "created": 0 }
      ],
      "needReview": 5
    }
  ]
}
```

- `weekOf` — the Sunday that starts the current week (`YYYY-MM-DD`).
- `days[7]` — `{ expected, created }` for Sun through Sat. `0/0` means the site was skipped or not scheduled that day.
- `needReview` — cumulative articles pending review (incremented on generation, decremented on approve/reject). Floored to 0.

```bash
curl -s "$BASE/api/scheduler-summary" | jq '.sites[] | {domain, needReview, days: [.days[] | "\(.created)/\(.expected)"]}'
```

### Dashboard page

The summary is also rendered at `/scheduler-summary` — a color-coded table with green (met), yellow (partial), red (missed), and grey (no activity) cells. Linked from the Scheduler Log page header ("Weekly Summary →").

---

## 6. Review Count Decrement — `POST /review-counts/decrement`

`POST /review-counts/decrement` (content-pipeline, **not** a dashboard proxy) decrements the review count for a site after articles are approved or rejected.

The dashboard calls this fire-and-forget from `applyReviewDecisions()` — you don't normally need to call it manually.

### Request

```bash
curl -X POST http://localhost:5000/review-counts/decrement \
  -H "Content-Type: application/json" \
  -d '{"domain": "travelswire", "count": 3}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | Yes | Site domain (folder name, e.g. `travelswire`) |
| `count` | number | Yes | Positive integer to subtract from the review count |

### Response

```json
{ "status": "ok" }
```

### Errors

- `400` — missing `domain`, non-positive `count`, or invalid JSON.
- `413` — payload too large.

---

## Errors

- `503` (stats / checks / costs / attention): MongoDB unreachable.
- `502` (any dashboard route): the content-pipeline service is unreachable.
- `404`: unknown site on `/api/site-checks/:domain` (other endpoints return empty/zero defaults for unknown sites).

## All-in-one example

```bash
BASE=http://localhost:3001; S=travelswire; jq -n \
  --argjson stats "$(curl -s "$BASE/api/site-stats/$S")" \
  --argjson checks "$(curl -s "$BASE/api/site-checks/$S")" \
  --argjson costs "$(curl -s "$BASE/api/site-costs/$S")" '{
    site: $S,
    status:         $checks.checks.uptime.overallStatus,
    failedArticles: $stats.site.failedArticles,
    imageFail:      $stats.site.imageGenFailed,
    generalImages:  $stats.site.generalImages,
    uptime:         {lastStatus: $checks.checks.uptime.statusCode, checkedAt: $checks.checks.uptime.checkedAt},
    sync:           $checks.checks.sync,
    inReview:       $stats.site.reviewCount,
    ssl:            $checks.checks.ssl,
    tracking:       $checks.checks.tracking,
    tokenUsage:     [$costs.site.byModel[]? | {model, tokensUse, estimated}]
  }'
```
