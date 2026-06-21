# Site Checks (Health Monitoring) API — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** michal + Claude Code
**Sibling specs:** Generation Stats (foundation), Cost Tracking, Slack Alerts & Reminders

## Problem

For each site, the ops console needs a **Checks** block:

> **Checks** — Uptime · Sync (+ last) · SSL · Tracking (GA · GTM · Pixel) · (Domain expiry, informational)

## Key decision: reuse the existing Domains Dashboard, don't rebuild

An existing internal service — the **Domains Dashboard** (`https://domains-dashboard-53a6--atomic.cloudgrid.io`,
JSON, no auth) — already monitors **uptime, SSL, domain registration/expiry, DNS/DNSSEC, and nameservers** for our
domains, with health checks every 2h and a daily registrar/SSL sync. **All our live custom-domains are covered.**

So this subsystem does **not** build an HTTP/TLS prober, a `site-checks` cron, or a `site_checks` Mongo
collection. It **consumes** the Domains Dashboard for uptime/SSL/domain, and builds only the two ATL-specific
checks the Domains Dashboard can't know about: **Sync** (KV `sync-status`) and **Tracking** (config-presence).

### Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Uptime / SSL | **Consume the Domains Dashboard API.** Drop our own probers. |
| Domain expiry | **Surface it (`renewal.daysLeft`) for visibility; no Slack alert from us** (the Domains Dashboard owns domain/SSL/down alerting). |
| Sync check | **Ours** — read `sync-status:<siteId>` from CONFIG_KV. |
| Tracking check | **Ours** — config-presence of GA4/GTM/Pixel IDs in the resolved config (no headless/runtime firing). |
| Coverage | All live custom-domains are in the Domains Dashboard; staging-only sites (no custom domain) → external checks are `n/a`. |

## What each check means and where it comes from

| Check | Source | Field(s) |
|---|---|---|
| **Uptime** | Domains Dashboard `GET /api/domains/:domain` | `latestSnapshot.health.statusCode`, `responseTimeMs`, `health.checkedAt`, `overallStatus` (`healthy`/`warning`/`critical`/`not_live`/`unknown`) |
| **SSL** | Domains Dashboard | `latestSnapshot.ssl.status`, `ssl.expiresAt`, `ssl.daysLeft` |
| **Domain expiry** (informational) | Domains Dashboard | `latestSnapshot.renewal.expiresAt`, `renewal.daysLeft`, `renewal.autoRenew` |
| **Sync (+ last)** | CONFIG_KV `sync-status:<siteId>` | `{ ok, syncedAt, committedAt, gitSha, error? }` |
| **Tracking** | Resolved config `site-config:<siteId>` (or `site.yaml`) | presence of `tracking.ga4`, `tracking.gtm`, `tracking.facebook_pixel` |

> **Sync ≡ "build".** There is no separate build step post-Workers migration — `sync-kv` *is* the deploy. The
> Alerts spec's "build failed" condition collapses into "sync failed"; this subsystem exposes a single `sync` check.

## Architecture — read-through, no new datastore

Checks are computed **on read** (no cron, no persisted collection):

- **content-pipeline** owns the ATL-specific checks (consistent with the other subsystems owning backend data):
  `GET /site-checks[/:domain]` reads **sync** (KV `sync-status`) and **tracking** (resolved config) from CONFIG_KV.
  - **New credentials:** content-pipeline needs `CLOUDFLARE_API_TOKEN` (Workers KV Storage:**Read** is enough),
    `CLOUDFLARE_ACCOUNT_ID`, and the CONFIG_KV namespace ids (prod `b258e47065274b8b8af1a0b6d6529c1d` /
    staging `f6c35e1fa8c841b8b193509a3a237f7f`). The **dashboard** already holds the token; content-pipeline does
    not today. KV is read via the Cloudflare KV **REST API** (no Worker binding outside the Worker).
  - **Dual-account:** prod sites are on the **Assets** account; legacy `financenewsbase` + `coolnews.dev` are on
    **Dev1**. Resolve the right namespace per site by reusing the dashboard's `isDev1Domain()` / `getKvNamespaces()`
    logic — extract it into a shared lib (`shared-types` or a shared util) so both services use one copy.
- **dashboard** `GET /api/site-checks[/:domain]` (public, NextAuth) **merges**: it proxies content-pipeline for
  `sync` + `tracking` (standard `CONTENT_AGENT_URL` fallback, landmine #4) **and** fetches the Domains Dashboard
  API for `uptime` + `ssl` + `domain`. Lists all sites from `dashboard-index.yaml`; staging-only sites get
  `uptime/ssl/domain: { status: "n/a" }`.
- **Caching:** Domains Dashboard data refreshes every 2h/daily, and sync/tracking are cheap KV reads — a short
  read cache (e.g. 5–15 min, reuse the existing cache pattern) avoids hammering. No persistence required.

## Read API — response block

Merges into the per-site aggregate as `checks`:

```jsonc
"checks": {
  "uptime":   { "ok": true,  "statusCode": 200, "responseTimeMs": 142, "overallStatus": "healthy", "checkedAt": "…", "source": "domains-dashboard" },
  "ssl":      { "status": "active", "daysLeft": 90, "expiresAt": "…", "source": "domains-dashboard" },
  "domain":   { "daysLeft": 285, "expiresAt": "…", "autoRenew": true, "source": "domains-dashboard" },   // informational
  "sync":     { "ok": true,  "syncedAt": "…", "gitSha": "abc1234", "error": null },
  "tracking": { "ga4": true, "gtm": false, "pixel": true }
}
```

- **Block state convention:** every block carries a `state` of `ok` | `n/a` | `unknown` (distinct from
  `ssl.status`, which is the *upstream* SSL enum `active`/`validation_failed`/…). Use `state` for OK-vs-degraded;
  don't overload `ssl.status` with sentinels. `not_live` surfaces as `uptime.state: "ok"` is **false** with
  `overallStatus: "not_live"` so down / not_live / n/a are distinguishable.
- **Fetch once:** the all-sites listing fetches the Domains Dashboard **bulk** `GET /api/domains` a single time and
  indexes by domain (not N per-site calls); the single-site endpoint uses `GET /api/domains/:domain`.
- For staging-only sites: `uptime/ssl/domain` → `{ "state": "n/a" }`.
- If the Domains Dashboard is unreachable, those three blocks return `{ "status": "unknown", "error": "…" }`
  rather than failing the whole response (sync/tracking still resolve).
- If a domain is unexpectedly missing from the Domains Dashboard (Domains Dashboard `404`): same `unknown`/`n/a`
  treatment, logged.

## Error handling

- Each of the five checks is independently try/caught; one failing (KV timeout, Domains Dashboard down) yields a
  falsy/`unknown` block with an `error` string — never fails the whole site or the endpoint.
- Domains Dashboard fetch uses a short timeout (e.g. 5s).
- Read API: total failure (e.g. can't list sites) → `503`.

## Testing

- **Unit:** map Domains Dashboard `latestSnapshot` → our `uptime`/`ssl`/`domain` blocks (incl. `not_live`,
  `unknown`, missing-domain `404`); sync-status parse incl. `ok:false` + `error`; tracking presence across
  resolved-config shapes (missing `tracking`, partial IDs); `n/a` for staging-only sites; dual-account namespace
  selection picks the right KV id per site.
- **Integration:** stub the Domains Dashboard API + KV REST; assert one source failing doesn't blank the others;
  dashboard merge proxies pipeline (sync/tracking) and overlays external (uptime/ssl/domain) correctly.

## Out of scope

- Building any uptime/SSL/domain probing — delegated to the Domains Dashboard.
- Runtime "is the tag actually firing" verification (headless browser) — presence-check only; hook left for later.
- Slack alerting on down/SSL/domain — **owned by the Domains Dashboard** (see Alerts spec; our engine only fires
  ATL-specific conditions sync/tracking/failed-articles/in-review).
- Any persisted checks history (the Domains Dashboard keeps health/alert history; we read current state).

## Dependency: Domains Dashboard API (consumed)

- `GET /api/domains/:domain` → `latestSnapshot.{health,ssl,renewal,overallStatus}` (primary read, per site).
- `GET /api/domains` → bulk variant (all monitored domains) for the all-sites listing.
- No auth required. Base URL `https://domains-dashboard-53a6--atomic.cloudgrid.io`. Health every 2h; SSL/registrar
  daily. Reference: `/Users/michal/domains-dashboard/services/web/docs/API.md`.
