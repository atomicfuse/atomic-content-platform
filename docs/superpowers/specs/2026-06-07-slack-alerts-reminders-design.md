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

This engine fires only the **ATL-specific** conditions. The **Domains Dashboard owns down/SSL/domain-expiry
alerting** (decision: "they own infra alerts; we own ATL-specific"), so the original #2 (site down), #6 (SSL),
and #7 (domain expiry) are **not** fired here — they're handled by that service. Our console still *displays*
their status via the Checks block, but Slack delivery for them is theirs.

Thresholds are config constants. Each condition has an enable flag (so #9 ships off).

| # | Condition | Alerts when | Slack message | Fires |
|---|---|---|---|---|
| 1 | Failed articles | `failedArticles.last7d > 3` | `⚠ {site}: {n} failed articles in 7d (limit 3)` | daily check **+** after each run |
| 3 | Sync failed | last KV sync `ok:false` | `🔴 {site}: content sync failed — visitors see old content` | daily check (reads `sync-status`) |
| 5 | In review | review-count `> 15` | `⚠ {site}: {n} articles in review (limit 15)` | on crossing 15 |
| 8 | Tracking off | GA/GTM **or** Pixel not present | `⚠ {site}: analytics/pixel not firing` | daily check |
| 9 | Image gen failed | *(disabled)* | — | — (flip on with a threshold) |

**Owned by the Domains Dashboard, not this engine:** #2 site down, #4 build (≡ sync, no build step exists),
#6 SSL, #7 domain expiry.

### Reminders (scheduled nudges — not site health)

| Reminder | Slack message | Fires |
|---|---|---|
| Review backlog | `{n} articles waiting for review across the network` | weekly digest |
| Create new site | `Time to create a new site` | scheduled cadence |

## Data sources per condition (all already produced by sibling specs)

All inputs are read by the engine in content-pipeline. `failedArticles` is in its own Mongo; `sync`/`tracking`
are the ATL checks it already computes from CONFIG_KV (see Checks spec — content-pipeline gains a CF read token
for `sync-status` + resolved config); `reviewCount` is a cheap KV `article-index` count.

| # | Reads from |
|---|---|
| 1 | Stats Mongo (`generation_events`) → `failedArticles.last7d` (local) |
| 3 | KV `sync-status:<siteId>` → `ok` (the same read the Checks `sync` block uses) |
| 5 | **Review count per site** — count of `article-index:<siteId>` entries with `status: "review"` (single KV read). Reminder "Review backlog" reuses this summed across the network. |
| 8 | Resolved config `tracking.{ga4,gtm,facebook_pixel}` presence (the Checks `tracking` block) |

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

- **Transition-only** (fire once on OK→alerting, silent until it clears):
  - #3 sync (fire once when `sync-status.ok` goes false; reset when it's ok again).
  - #5 in-review ("on crossing 15" → fire when `>15` and previous `≤15`; reset when it drops back).
  - #8 tracking (fire once on transition to "off"; reset when present again).
- **Transition + daily re-remind** while still alerting:
  - #1 failed articles ("daily check + after each run" → fire on entering alerting, then at most once/day while
    still over the limit; the after-each-run trigger also fires on a fresh crossing).

Every condition's fire policy is therefore one of: `transition-only` or `transition + daily-re-remind`.
The policy + its threshold live in config (see Config).

A shared `evaluateCondition(state, currentValue, policy, now) → { newState, shouldFire }` encapsulates this so
every condition uses the same throttle/edge logic. `now` is **passed in** (never `Date.now()` inside) for testability.

**Reminders reuse `alert_state` with reserved network-scoped keys** (they're network-wide, not per-site):
`__network__:review_backlog` and `__network__:create_new_site`. Same `lastFiredAt` mechanism drives their
cadence (weekly weekday / N-day cadence) so the digest doesn't double-send within a period.

## Fire triggers (when the engine runs)

1. **Daily cron** (`run-alerts`, new CloudGrid cron, e.g. 09:00 EST): evaluate **all** conditions (#1, #3, #5, #8)
   for all sites by reading their inputs (Mongo failedArticles + KV sync-status/tracking/review-count); emit
   reminders when due (weekly review-backlog digest on its configured weekday; "create new site" on its cadence).
   This is the catch-all "daily check".
2. **After each generation run**: evaluate #1 and #5 for that site (a run changes both failed-article counts and
   the review backlog) at the same post-`runContentGeneration` boundary the Stats recorder uses.

(There is no "after each checks run" trigger — uptime/SSL/domain are owned by the Domains Dashboard, and our
sync/tracking checks are read on the daily cron.) All evaluations go through the same engine + `alert_state`, so
a condition driven by both triggers never double-fires (state is the single arbiter).

## Slack delivery

- One channel via the existing `SLACK_WEBHOOK_URL` in `notifications.ts`.
- **API-surface reality (verified):** `notifications.ts` exports only the `notifyX` wrappers; `dispatch()` /
  `sendSlack()` / `withSeverity()` are **module-private**, and the only severities are `critical` (🔴 CRITICAL —)
  and `not_critical` (🟡 NOT CRITICAL —). There is **no "warning" tier** and no `⚠` prefix. The user's message
  templates already carry their own emoji (`🔴` / `⚠`) and exact wording. **Decision:** add one new exported
  wrapper, `notifyAttention(message: string)`, that posts the message text **verbatim** (no CRITICAL/NOT-CRITICAL
  prefix), so the templates render exactly as written and we don't get a doubled prefix. The engine calls
  `notifyAttention`; we do not reuse `withSeverity`'s prefixing.
- Reminders post their literal templates via the same `notifyAttention`, with `{n}` substituted.
- Delivery is best-effort: a Slack failure is logged and must not break the cron, and must **not** advance
  `lastFiredAt` (only set `lastFiredAt` on a successful post) so a transient Slack outage retries next tick.

## Config

A small config object (constants + optional `scheduler/alerts.yaml` in the network repo, mirroring
`scheduler/config.yaml`) holding: per-condition `enabled` + thresholds (`failedArticles: 3`, `inReview: 15`),
the review-backlog digest weekday, the "create new site" cadence, and a global enable. Defaults in code if the
file is absent (same pattern as the scheduler gate). (No SSL/domain thresholds here — those live in the Domains
Dashboard's own settings.)

## Read API (for the console's "Needs Attention" panel)

- **content-pipeline** (internal): `GET /attention[/:domain]` → current `alert_state` per site (which conditions
  are alerting, since when), so the UI can show the same red/amber flags without re-deriving.
- **dashboard** (public, NextAuth): `GET /api/attention[/:domain]` → proxies (standard `CONTENT_AGENT_URL`
  fallback). Read-only; the engine does the writing/firing.

```jsonc
"attention": {
  "alerting": [
    { "condition": "in_review",       "severity": "warn",     "since": "2026-06-07T14:00:00Z", "value": 17 },
    { "condition": "failed_articles", "severity": "warn",     "since": "2026-06-06T09:00:00Z", "value": 5 },
    { "condition": "sync_failed",     "severity": "critical", "since": "2026-06-07T13:40:00Z", "value": null }
  ]
}
```

`value` carries the numeric reading for numeric conditions (in-review count, failed-articles count) and is `null`
for boolean conditions (sync_failed, tracking) — `since` + `condition` convey those. (Down/SSL/domain are not
here — see the Checks block / Domains Dashboard for those.)

> `severity` here is a **read-API display field** for the UI (`warn`/`critical`), **not** the Slack helper's
> `Severity` type. The engine does `{n}`/`{site}` substitution into the message template before calling
> `notifyAttention(message)`; the wrapper posts the finished string verbatim. (`SLACK_WEBHOOK_URL` env →
> `config.slackWebhookUrl` in the `NotificationConfig` the engine builds.)

## Error handling

- Each condition evaluated independently (one failing eval doesn't skip the rest of the site or the run).
- Slack send failure → log, leave `lastFiredAt` unchanged so it retries; never throw out of the cron.
- Mongo unreachable: the engine logs and exits cleanly (no alerts that tick); read API → `503`.

## Testing

- **Unit (the engine is the critical surface):** `evaluateCondition` edge cases per policy —
  - in-review crossing 15 fires once, not again at 16/17; resets and can re-fire after dropping to ≤15;
  - sync_failed fires once on `ok`→false, resets when ok again;
  - tracking fires once on transition to "off", resets when present again;
  - failed-articles fires on crossing and re-reminds at most once/day;
  - `now` injection (no wall-clock in logic).
- **Reminders:** weekly digest fires only on its weekday; "create new site" respects cadence + `lastFiredAt`.
- **Delivery:** a stubbed Slack failure does not advance `lastFiredAt` and does not throw.
- **Integration:** `mongodb-memory-server`; multi-trigger (after-run + daily) doesn't double-fire the same alert.

## Out of scope

- Multi-channel / per-severity routing, Slack bot/threads (single webhook for now).
- Acknowledge/snooze UI.
- Spend-based alerts (cost thresholds) — possible future condition reading the Cost subsystem.
- Image-gen-failure alerting beyond today's existing `notifyImageDefaultFallback` notice (#9 stays off).
