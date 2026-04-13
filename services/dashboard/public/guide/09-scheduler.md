# Scheduler Agent

The Scheduler Agent decides **when** the network's autonomous content generation runs. It pairs a single hourly CloudGrid cron with a config file in the network repo, so schedule changes never require a platform redeploy.

## At a Glance

| Concern | Answer |
|---------|--------|
| **What fires the tick?** | CloudGrid cron, `0 * * * *` EST, one shared cron for the whole network |
| **What decides if a tick publishes?** | `scheduler/config.yaml` on the `main` branch of the network repo |
| **What decides per-site cadence?** | `brief.schedule.articles_per_day` + `brief.schedule.preferred_days` on the site's staging branch |
| **Where is it configured from the UI?** | Dashboard → **Scheduler** (sidebar) |
| **Where do generated articles land?** | The site's staging branch (`staging/<domain>`), committed via GitHub API, which triggers Cloudflare Pages |

## Architecture

```
   CloudGrid cron (hourly)                       Dashboard
         |                                           |
         v                                           v
  GET /scheduled-publish                 PUT /api/scheduler        (write config.yaml on main)
         |                               POST /api/scheduler/run-now
         |                                           |
         v                                           v
  content-pipeline::runScheduledPublish(config, force)
         |
         +-- read scheduler/config.yaml (network repo, main)
         |        |
         |        +-- enabled=false?            -> skip (skippedGlobal=disabled)
         |        +-- current_hour not in       -> skip (skippedGlobal=hour_not_matched)
         |            run_at_hours?
         |
         +-- list sites from dashboard-index.yaml (main)
         |
         +-- for each active site:
         |     read brief from staging/<domain> (fallback: main)
         |     today in preferred_days? --no--> skipped
         |     resolve articles_per_day (dual-read)
         |     runContentGeneration({ siteDomain, count, branch: staging/<domain> })
         |          -> writer commits each article via GitHub API
         |          -> Cloudflare Pages builds + deploys staging site
         |
         v
  response: { configStatus, skippedGlobal?, triggered[], skipped[], errors[] }
```

## Two Layers of Control

The scheduler has **two independent layers**. Both must pass for an article to be generated.

### Layer 1 — Global (when does the network tick?)

Lives in `scheduler/config.yaml` on `main` in the network repo:

```yaml
enabled: true
run_at_hours: [14]      # 0-23 in the configured timezone
timezone: EST
```

- `enabled: false` → every cron tick returns immediately. Nothing is published.
- `run_at_hours` is an allowlist. Only ticks whose hour matches any entry proceed. Example: `[9, 14, 20]` → publishes three times per day.
- `timezone` accepts IANA names (`America/New_York`) or the shortcuts Node's `Intl.DateTimeFormat` supports (`EST`, `UTC`).

This file is **not shipped in the platform repo**. It lives in the network repo so schedule changes do not require a CloudGrid redeploy — the dashboard writes to it via the standard `commitNetworkFiles` helper.

If the file does not exist, defaults apply (`enabled: true`, `run_at_hours: [14]`, `timezone: EST`).

### Layer 2 — Per-Site (which sites publish today?)

Lives in each site's `brief.schedule`:

```yaml
schedule:
  articles_per_day: 3
  preferred_days:
    - Monday
    - Wednesday
    - Friday
```

- `articles_per_day` — integer count generated on each matching day. If the per-site tick fires, this many articles are generated in one batch.
- `preferred_days` — days of the week (English names, case-insensitive). Empty list ⇒ every day is valid.
- `articles_per_week` (legacy) — still read as a fallback: `ceil(articles_per_week / preferred_days.length)`. New saves always use `articles_per_day`.

## The Cron + Config Pattern

The CloudGrid cron entry is minimal:

```yaml
# cloudgrid.yaml
scheduled-publisher:
  type: cron
  schedule: "0 * * * *"
  timezone: EST
  run: http://content-pipeline-app/scheduled-publish
```

23 out of 24 ticks are no-ops that return in ~50ms (hour not in `run_at_hours`). At 50+ sites the GitHub API surface is only hit on matching hours, making the load effectively constant regardless of network size.

This is the trade we chose over the alternative of dynamic CloudGrid cron entries:

| Approach | Schedule change | Latency | Complexity |
|----------|-----------------|---------|------------|
| Hourly cron + `config.yaml` gate **(current)** | Edit YAML in repo | 0 (next tick) | Low |
| Edit `cloudgrid.yaml` per schedule change | `cloudgrid deploy` | Minutes | Redeploy every change |
| Per-site cron entries | One cron per site × N sites | 0 | Doesn't scale |

## Run Now (Force)

The dashboard's **Run Now** button bypasses Layer 1 (the global enabled/hour gate) but **does not** bypass Layer 2 (per-site `preferred_days`).

- Dashboard `POST /api/scheduler/run-now` → proxies to `GET /scheduled-publish?force=true` on the content-pipeline.
- `force=true` skips the `enabled` check and the `run_at_hours` check. The rest of the flow is identical to a normal tick.
- Sites whose `preferred_days` does not include today are still skipped. This is intentional — Run Now is for "run the schedule as if the hour matched", not for "publish everything now".

## Write Path Invariant

The scheduler always passes an explicit `branch` to `runContentGeneration`. This matters because the writer (`lib/writer.ts`) contains a local-filesystem fallback:

```ts
function shouldWriteLocal(config: WriterConfig): boolean {
  return !!config.localNetworkPath && !config.branch;
}
```

When `LOCAL_NETWORK_PATH` is set (e.g. in dev for manual generation) **and** no branch is provided, articles are written to the local disk instead of committed to git. Passing the staging branch disables that path, so scheduler runs always commit through the GitHub API and trigger Cloudflare Pages builds.

## Response Shape

```ts
interface ScheduledPublishResult {
  status: "ok";
  configStatus: "ok" | "defaults" | "fetch_error";
  skippedGlobal?: "disabled" | "hour_not_matched" | "fetch_error";
  triggered: string[];                          // domains that generated
  skipped:  { domain: string; reason: string }[];
  errors:   { domain: string; error: string }[];
}
```

- `configStatus: "defaults"` — the file does not yet exist on main; defaults were used. Visit `/scheduler` and click **Save** to create it.
- `configStatus: "fetch_error"` — GitHub read failed. Unforced ticks fail safe (skip publishing). Forced ticks continue with defaults.
- `skippedGlobal` — present only when the tick stopped at Layer 1.

## Code Map

```
services/dashboard/
  src/app/scheduler/page.tsx                -- UI (enabled toggle, hours picker, Run Now)
  src/app/api/scheduler/route.ts            -- GET / PUT config
  src/app/api/scheduler/run-now/route.ts    -- POST → triggers content-pipeline
  src/lib/scheduler.ts                      -- readSchedulerConfig / writeSchedulerConfig / triggerSchedulerRun

services/content-pipeline/
  src/agents/scheduled-publisher/index.ts   -- runScheduledPublish(config, force?)
  src/lib/site-brief.ts                     -- listActiveSites, readSiteBriefWithFallback

cloudgrid.yaml
  services.scheduled-publisher              -- hourly cron → /scheduled-publish

<network-repo>/scheduler/config.yaml        -- global gate
<network-repo>/sites/<domain>/site.yaml     -- per-site brief.schedule (on staging branch)
<network-repo>/dashboard-index.yaml         -- authoritative site list
```

## Operations

### Change the publishing schedule
Open Dashboard → **Scheduler**, adjust, **Save**. Commits `scheduler/config.yaml` to main. Next hourly tick picks it up. No redeploy.

### Pause the scheduler network-wide
Toggle **Enabled** off on the Scheduler page. Cron keeps firing but exits immediately.

### Debug "nothing is generating"
1. Open `/scheduler` → click **Run Now**.
2. Check the returned panel:
   - `configStatus: "defaults"` → click **Save** first.
   - `skipped[]` with reason "not a preferred day" → expected; today is not in any site's `preferred_days`.
   - `skipped[]` with "no brief configured" → the site has no staging branch or no `schedule` block yet.
   - `errors[]` with 404 → GitHub permissions or missing file; check `GITHUB_TOKEN`.

### Add a new run time
Add the hour to `run_at_hours` via the Scheduler page (e.g. change `[14]` to `[9, 14, 20]`). Saves to the network repo. Effective on the next hourly tick.

### Migrate a site from `articles_per_week` to `articles_per_day`
Open the site's detail page → **Content Agent** tab → edit **Articles Per Day**. Save commits the new field and removes the legacy one.
