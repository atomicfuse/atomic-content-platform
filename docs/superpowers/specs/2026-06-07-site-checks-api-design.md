# Site Checks (Health Monitoring) API — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** michal + Claude Code
**Sibling specs:** Generation Stats (foundation), Cost Tracking, Slack Alerts & Reminders

## Problem

For each site, the ops console needs a **Checks** block:

> **Checks** — Uptime · Sync (+ last) · SSL · Tracking (GA · GTM · Pixel)

None of this is monitored today: there are **no liveness probes, no SSL checks, and no in-app sync-status reads**.
The live `/_ping` endpoint exists on the Worker but nothing calls it. This subsystem adds a **periodic prober**
plus a `site_checks` collection and exposes the results through the same content-pipeline-owned-Mongo +
dashboard-proxy pattern as the Stats subsystem.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Tracking check | **Config-presence** — verify GA/GTM/Pixel IDs are present in the site's resolved config. Not runtime-firing (no headless browser). Leave a clean hook for runtime verification later. |
| Domain expiry | **Dropped** — not in scope (no registrar/WHOIS data source wired). |
| Architecture | Same as Stats: content-pipeline owns Mongo + the prober; dashboard `/api/site-checks` proxies. |

## What each check means

| Check | Definition | Source |
|---|---|---|
| **Uptime** | Live site responds 200 to `GET /_ping` (the Worker health route, `no-store`). Store last status + a rolling success ratio. | HTTP probe of the site's custom domain (or staging URL if not Live). |
| **Sync** | The site's last KV sync succeeded, with its timestamp. | `sync-status:<siteId>` in CONFIG_KV (`{ ok, syncedAt, committedAt, gitSha, error? }`). |
| **SSL** | TLS cert for the custom domain is valid and not expiring soon; store `notAfter` + days-remaining. | TLS handshake to the custom domain; read cert `notAfter`. |
| **Tracking** | GA4, GTM, and Meta Pixel IDs are present (configured) in the site's resolved config. Per-channel boolean. | Resolved config (`tracking.ga4`, `tracking.gtm`, `tracking.facebook_pixel`) — config-presence only. |

> **Sync ≡ "build".** There is no separate build step in the post-Workers architecture — `sync-kv` *is* the
> deploy. So the alerts spec's "build failed" condition collapses into "sync failed"; this subsystem exposes a
> single `sync` check.

## Data sourcing — important constraints (verified against code)

- **`sync-status:<siteId>` lives in CONFIG_KV** and is **not read by any app code today** — it's written by CI
  (`sync-kv.yml`) and read only by the Worker. Reading it from a service needs **Cloudflare KV REST access**.
  The **dashboard already holds `CLOUDFLARE_API_TOKEN`** (Workers KV Storage:Edit scope) and account ID; the
  content-pipeline does **not** today. **Decision:** add `CLOUDFLARE_API_TOKEN` (read scope sufficient) +
  `CLOUDFLARE_ACCOUNT_ID` + the CONFIG_KV namespace id (`b258e47065274b8b8af1a0b6d6529c1d` prod /
  `f6c35e1fa8c841b8b193509a3a237f7f` staging) as content-pipeline secrets, and read sync-status via the KV REST
  API. (Alternative considered: read the latest `sync-kv.yml` workflow-run conclusion via the existing Octokit —
  rejected as less granular; KV sync-status is per-site and canonical.)
- **Dual-account reality:** prod sites are on the **Assets** account behind `atl-sites-workers-manager`; two
  legacy sites (`financenewsbase`, `coolnews.dev`) are still on **Dev1**. The prober must resolve the right KV
  namespace / probe host per site, reusing the dashboard's existing `isDev1Domain()` / `getKvNamespaces()` logic
  (move the small shared helper into `shared-types` or a shared lib if needed).
- **Probe target:** Live sites → `https://<custom_domain>/_ping`; non-Live sites → the staging worker URL with
  `?_atl_site=<domain>` (or skip uptime/SSL for staging-only sites and mark `n/a`).
- **Resolved config for tracking** is already in KV as `site-config:<siteId>` (or read the site's `site.yaml`
  via Octokit). Prefer the resolved KV config so it reflects the full org→group→override→site merge.

## Data model (MongoDB)

**Collection `site_checks`** — one rollup doc per site, upserted each prober run:

```jsonc
{
  "_id":      "travelswire",
  "uptime": {
    "ok":        true,
    "lastStatus":200,
    "checkedAt": "2026-06-07T14:10:00Z",
    "successRatio24h": 1.0       // rolling, from recent probe results
  },
  "sync": {
    "ok":        true,
    "syncedAt":  "2026-06-07T13:02:00Z",
    "gitSha":    "abc1234",
    "error":     null
  },
  "ssl": {
    "ok":         true,
    "notAfter":   "2026-08-20T00:00:00Z",
    "daysRemaining": 74,
    "checkedAt":  "2026-06-07T14:10:00Z"
  },
  "tracking": {
    "ga4":   true,
    "gtm":   false,
    "pixel": true,
    "checkedAt": "2026-06-07T14:10:00Z"
  },
  "updatedAt": "2026-06-07T14:10:00Z"
}
```

Optional `check_results` time-series collection (append-only probe log) to support `successRatio24h` and history.
Keep it lightweight (TTL index, e.g. 30 days) — flagged as a sub-decision; the rollup alone satisfies the console.

## The prober (new cron)

A new CloudGrid cron service (e.g. `site-checks`, every 15 min — frequency is a tunable) hits an internal
content-pipeline endpoint `GET /run-checks` that:

1. Lists active sites from `dashboard-index.yaml` (reuse `listActiveSites`).
2. For each site, runs the four checks concurrently (bounded concurrency), each independently failure-isolated:
   - **Uptime:** `fetch('/_ping')` with a short timeout; record status + ok.
   - **SSL:** TLS connection to the custom domain; read peer cert `notAfter`. (Node `tls.connect`.)
   - **Sync:** KV REST `GET sync-status:<siteId>`; parse `{ ok, syncedAt, ... }`.
   - **Tracking:** read resolved config; presence-check the three IDs.
3. Upserts `site_checks`. A single check failing to *execute* (e.g. KV timeout) records `ok: null`/`error`, never
   aborts the others.

`cloudgrid.yaml` gains a `site-checks` cron block mirroring the existing `scheduled-publisher` shape.

## Read API

- **content-pipeline** (internal): `GET /site-checks` and `GET /site-checks/:domain` → the `site_checks` rollup.
- **dashboard** (public, NextAuth): `GET /api/site-checks[/:domain]` → proxies (uses the standard
  `CONTENT_AGENT_URL` fallback pattern, landmine #4). Lists all sites so never-probed ones appear with nulls.

Response block (merges into the per-site aggregate as `checks`):

```jsonc
"checks": {
  "uptime":   { "ok": true,  "lastStatus": 200, "successRatio24h": 1.0, "checkedAt": "…" },
  "sync":     { "ok": true,  "syncedAt": "…", "error": null },
  "ssl":      { "ok": true,  "daysRemaining": 74, "notAfter": "…" },
  "tracking": { "ga4": true, "gtm": false, "pixel": true }
}
```

## Error handling

- Each check is independently try/caught; a failure records a falsy/`null` result with an `error` string rather
  than throwing. The prober must always complete the full site loop.
- Mongo write failures are logged and skipped (same principle as Stats).
- Probe timeouts are short (e.g. 5s) so one slow/down site can't stall the run.
- Mongo unreachable on read → API `503`.

## Testing

- **Unit:** SSL `notAfter` → days-remaining; tracking presence-check across resolved-config shapes
  (missing `tracking`, partial IDs); sync-status parse incl. `ok:false` + `error`; uptime status mapping;
  `successRatio24h` computation.
- **Integration:** prober loop with mocked fetch/TLS/KV — one site failing a single check doesn't abort others;
  `mongodb-memory-server` round-trip; dual-account namespace selection picks the right KV id per site.

## Out of scope

- Runtime "is the tag actually firing" verification (headless browser) — presence-check only; hook left for later.
- Domain-expiry / WHOIS.
- Historical uptime dashboards beyond `successRatio24h` (optional `check_results` TTL log is the only history).
- Acting on failures (paging/Slack) — that's the Alerts spec; this subsystem only measures and exposes.
