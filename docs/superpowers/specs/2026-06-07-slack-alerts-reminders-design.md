# Slack Alerts & Reminders ("Needs Attention") — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** michal + Claude Code
**Sibling specs:** Generation Stats, Site Checks, Cost Tracking (this subsystem consumes their data)

## Problem

A "Needs Attention" model that evaluates per-site conditions and posts Slack alerts, plus scheduled Slack
reminders. This is the **top layer** — it reads the data produced by Stats and Checks and decides when to notify.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Slack delivery | **Single incoming webhook / one channel** via the existing `SLACK_WEBHOOK_URL`. |
| Reuse | Build on the **existing** `dispatch()` / `sendSlack()` helper in `content-pipeline/src/lib/notifications.ts` (already posts to Slack with 🔴/🟡 severity prefixes; already used by `notifyImageDefaultFallback`). |
| Domain expiry (#7) | **Removed.** |
| Build failed (#4) | **Merged into Sync failed (#3)** — there is no separate build step (sync-kv *is* the deploy). |
| Image-gen failed (#9) | **Off** (informational). Wiring present but disabled; flip on with a threshold later. |
| Architecture | Engine lives in **content-pipeline** (owns crons + the Slack helper); state in the shared Mongo; dashboard `/api/attention` proxies a read-only view. |

## Conditions

Thresholds are config constants. Each condition has an enable flag (so #9 ships off).

| # | Condition | Alerts when | Slack message | Fires |
|---|---|---|---|---|
| 1 | Failed articles | `failedArticles.last7d > 3` | `⚠ {site}: {n} failed articles in 7d (limit 3)` | daily check **+** after each run |
| 2 | Site down | uptime probe unreachable | `🔴 {site} is down ({duration})` | on failed health check |
| 3 | Sync failed | last KV sync `ok:false` | `🔴 {site}: content sync failed — visitors see old content` | on sync failure |
| 5 | In review | review-count `> 15` | `⚠ {site}: {n} articles in review (limit 15)` | on crossing 15 |
| 6 | SSL | invalid **or** expires `< 14d` | `⚠ {site}: SSL expires in {n}d` | daily until renewed |
| 8 | Tracking off | GA/GTM **or** Pixel not present | `⚠ {site}: analytics/pixel not firing` | periodic check |
| 9 | Image gen failed | *(disabled)* | — | — (flip on with a threshold) |

(#4 build / #7 domain expiry intentionally absent — see Decisions.)

### Reminders (scheduled nudges — not site health)

| Reminder | Slack message | Fires |
|---|---|---|
| Review backlog | `{n} articles waiting for review across the network` | weekly digest |
| Create new site | `Time to create a new site` | scheduled cadence |

## Data sources per condition (all already produced by sibling specs)

| # | Reads from |
|---|---|
| 1 | Stats `site_stats` / `generation_events` → `failedArticles.last7d` |
| 2 | Checks `site_checks.uptime` (incl. `firstDetectedAt` for `{duration}`) |
| 3 | Checks `site_checks.sync.ok` |
| 5 | **Review count per site** — count of articles with `status: "review"`, from the existing article read path (`readArticlesWithKVFallback`, same as the review queue). *New small dependency:* expose `reviewCount` per site (cheap; computed during the same article read the Stats "recent articles" panel already does). Reminder "Review backlog" reuses this summed across the network. |
| 6 | Checks `site_checks.ssl.daysRemaining` / `ok` |
| 8 | Checks `site_checks.tracking.{ga4,gtm,pixel}` |

## Edge-triggering & dedup — the core of the engine

Naive evaluation would re-fire every tick. Each condition is **stateful**.

**Collection `alert_state`** — one doc per `(siteDomain, conditionId)`:

```jsonc
{
  "_id":            "travelswire:in_review",   // `${domain}:${conditionId}`
  "status":         "alerting" | "ok",
  "firstDetectedAt":"2026-06-07T14:00:00Z",    // when it entered alerting (for {duration})
  "lastFiredAt":    "2026-06-07T14:00:00Z",    // last Slack send
  "lastValue":      17                          // last evaluated value (for crossing logic)
}
```

**Fire policy per condition** (config-driven):

- **Transition-only** (fire once on OK→alerting, silent until it clears): #3 sync, #5 in-review ("on crossing 15"
  → fire when `>15` and previous `≤15`; reset state when it drops back).
- **Transition + daily re-remind** while still alerting: #6 SSL ("daily until renewed"), #1 failed articles
  ("daily check + after each run" → fire on entering, then at most once/day while still over limit; the
  after-each-run trigger also fires on a fresh crossing).
- **Transition + duration in message**: #2 site down (fire on going down; `{duration}` from `firstDetectedAt`;
  optional re-remind cadence while down).
- **Periodic**: #8 tracking (evaluate on the prober cadence; fire on transition, re-remind throttled).

A shared `evaluateCondition(state, currentValue, policy, now) → { newState, shouldFire }` encapsulates this so
every condition uses the same throttle/edge logic. `now` is **passed in** (never `Date.now()` inside) for testability.

## Fire triggers (when the engine runs)

1. **Daily cron** (`run-alerts`, new CloudGrid cron, e.g. 09:00 EST): evaluate **all** conditions for all sites;
   emit reminders when due (weekly review-backlog digest on its configured weekday; "create new site" on its
   cadence). This is the catch-all that satisfies "daily check" / "daily until renewed".
2. **After each generation run**: evaluate #1 for that site (hook at the same post-`runContentGeneration`
   boundary the Stats recorder uses).
3. **After each checks run**: evaluate #2/#3/#6/#8 for probed sites (hook at the end of the Checks prober, which
   already runs ~every 15 min).

All evaluations go through the same engine + `alert_state`, so the same condition can be driven by multiple
triggers without double-firing (state is the single arbiter).

## Slack delivery

- One channel via existing `SLACK_WEBHOOK_URL` + `dispatch()` in `notifications.ts`. Map severity: `🔴` messages
  → critical, `⚠` → warning (the helper already prefixes severity; preserve the user's exact message text).
- Reminders post their literal templates with `{n}` substituted.
- Delivery is best-effort: a Slack failure is logged and must not break the cron (and must not flip `alert_state`
  to "fired" — only mark `lastFiredAt` on a successful post, so a transient Slack outage retries next tick).

## Config

A small config object (constants + optional `scheduler/alerts.yaml` in the network repo, mirroring
`scheduler/config.yaml`) holding: per-condition `enabled` + thresholds (`failedArticles: 3`, `inReview: 15`,
`sslDays: 14`), the review-backlog digest weekday, the "create new site" cadence, and a global enable. Defaults
in code if the file is absent (same pattern as the scheduler gate).

## Read API (for the console's "Needs Attention" panel)

- **content-pipeline** (internal): `GET /attention[/:domain]` → current `alert_state` per site (which conditions
  are alerting, since when), so the UI can show the same red/amber flags without re-deriving.
- **dashboard** (public, NextAuth): `GET /api/attention[/:domain]` → proxies (standard `CONTENT_AGENT_URL`
  fallback). Read-only; the engine does the writing/firing.

```jsonc
"attention": {
  "alerting": [
    { "condition": "in_review", "severity": "warn", "since": "2026-06-07T14:00:00Z", "value": 17 },
    { "condition": "ssl",        "severity": "warn", "since": "2026-06-05T09:00:00Z", "value": 9 }
  ]
}
```

## Error handling

- Each condition evaluated independently (one failing eval doesn't skip the rest of the site or the run).
- Slack send failure → log, leave `lastFiredAt` unchanged so it retries; never throw out of the cron.
- Mongo unreachable: the engine logs and exits cleanly (no alerts that tick); read API → `503`.

## Testing

- **Unit (the engine is the critical surface):** `evaluateCondition` edge cases per policy —
  - in-review crossing 15 fires once, not again at 16/17; resets and can re-fire after dropping to ≤15;
  - SSL fires daily while `<14d`, stops after renewal;
  - failed-articles fires on crossing and re-reminds at most once/day;
  - site-down `{duration}` derives from `firstDetectedAt`;
  - `now` injection (no wall-clock in logic).
- **Reminders:** weekly digest fires only on its weekday; "create new site" respects cadence + `lastFiredAt`.
- **Delivery:** a stubbed Slack failure does not advance `lastFiredAt` and does not throw.
- **Integration:** `mongodb-memory-server`; multi-trigger (after-run + daily) doesn't double-fire the same alert.

## Out of scope

- Multi-channel / per-severity routing, Slack bot/threads (single webhook for now).
- Acknowledge/snooze UI.
- Spend-based alerts (cost thresholds) — possible future condition reading the Cost subsystem.
- Image-gen-failure alerting beyond today's existing `notifyImageDefaultFallback` notice (#9 stays off).
