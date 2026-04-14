# Scheduler Agent

The Scheduler Agent decides **when** the network's autonomous content generation runs. It pairs a single hourly CloudGrid cron with a config file in the network repo, so schedule changes never require a platform redeploy.

## At a Glance

| Concern | Answer |
|---------|--------|
| **What fires the tick?** | CloudGrid cron (`0 * * * *` = every hour at :00, EST). One shared cron for the whole network — most ticks are ~50ms no-ops |
| **What decides if a tick publishes?** | `scheduler/config.yaml` on the `main` branch of the network repo |
| **What decides per-site cadence?** | `brief.schedule.articles_per_day` + `brief.schedule.preferred_days` on the site's staging branch |
| **Where is it configured from the UI?** | Dashboard → **Scheduler** (sidebar) |
| **Where do generated articles land?** | The site's staging branch (`staging/<domain>`), committed via GitHub API, which triggers Cloudflare Pages |

## End-to-End Flow

Every tick — whether from the hourly cron or from a manual **Run Now** — follows the same pipeline:

```
CloudGrid Cron (hourly, 0 * * * *)          Dashboard "Run Now" button
         |                                           |
         v                                           v
GET /scheduled-publish                    POST /api/scheduler/run-now
                                            → proxies to GET /scheduled-publish?force=true
         |                                           |
         +-------------------------------------------+
         |
         v
LAYER 1 — Global Gate (scheduler/config.yaml on network repo main)
         |
         |-- enabled: false?              → STOP  (skippedGlobal: "disabled")
         |-- hour not in run_at_hours?    → STOP  (skippedGlobal: "hour_not_matched")
         |-- force=true?                  → BYPASS both checks above
         |
         v
LAYER 2 — Per-Site Gate (for each site in dashboard-index.yaml)
         |
         |-- Read brief from staging/<domain> branch (fallback: main)
         |-- No brief or schedule?        → skip site
         |-- Today not in preferred_days? → skip site
         |-- articles_per_day = 0?        → skip site
         |
         v
Trigger ContentGenerationAgent
         |-- count = articles_per_day
         |-- branch = staging/<domain>    (forces GitHub API commit)
         |
         v
GitHub commit to staging/<domain>
         |
         v
Cloudflare Pages detects commit → rebuilds staging site
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

If the file does not exist, defaults apply (`enabled: true`, `run_at_hours: [14]`, `timezone: EST`). The file is created on the network repo the first time you click **Save** on the Scheduler page.

### What Happens When You Switch Off the Scheduler

When you flip the **Scheduler enabled** toggle OFF and click **Save**:

1. The dashboard writes `enabled: false` to `scheduler/config.yaml` on the network repo's `main` branch (committed via the GitHub API).
2. CloudGrid's hourly cron **still fires every hour** — it always sends `GET /scheduled-publish` to the content-pipeline.
3. The scheduled-publisher agent reads `scheduler/config.yaml`, sees `enabled: false`, and **returns immediately** (~50ms) with `skippedGlobal: "disabled"`.
4. **No sites publish. No articles are generated.** The entire pipeline is short-circuited at Layer 1.

The **Run Now** button still works when disabled — it sends `force=true`, which bypasses the enabled check. This is intentional: "Run Now" means "run the schedule right now regardless of global settings", while the toggle controls only unattended/automated runs.

To resume: flip the toggle back ON, click **Save**. The next hourly tick whose hour matches `run_at_hours` will publish normally. No CloudGrid redeploy needed — the change is immediate.

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

## How Each Action Syncs with CloudGrid

CloudGrid hosts both the **dashboard** (Next.js) and the **content-pipeline** (Node HTTP server), plus the **scheduled-publisher** cron job. Here is exactly what happens for each user action:

### Save (change schedule)

1. User edits settings on the Scheduler page (toggle, hours, timezone) and clicks **Save**.
2. Dashboard sends `PUT /api/scheduler` with `{ enabled, run_at_hours, timezone }`.
3. The API route calls `writeSchedulerConfig()`, which commits the new `scheduler/config.yaml` to the network repo's `main` branch via the GitHub API.
4. **No CloudGrid redeploy happens.** The cron entry in `cloudgrid.yaml` stays the same (`0 * * * *`). On the next hourly tick, the content-pipeline reads the updated `config.yaml` from the network repo and acts on the new values.

### Toggle Off

Same flow as Save — the dashboard writes `enabled: false` to `scheduler/config.yaml`. CloudGrid's cron keeps firing hourly but the content-pipeline sees `enabled: false` and returns immediately. Nothing is generated. See "What Happens When You Switch Off the Scheduler" above.

### Toggle On

Same flow — writes `enabled: true`. The next hourly tick that matches `run_at_hours` will proceed to Layer 2 and generate content for eligible sites.

### Run Now

1. User clicks **Run Now** on the Scheduler page.
2. Dashboard sends `POST /api/scheduler/run-now`.
3. The API route calls `triggerSchedulerRun()`, which sends `GET /scheduled-publish?force=true` to the content-pipeline. In CloudGrid, this uses the internal DNS name `http://content-pipeline-app`. Locally under `cloudgrid dev`, it falls back to `http://localhost:5000`.
4. The content-pipeline runs the full `runScheduledPublish(config, force=true)` flow:
   - **Skips Layer 1** entirely (no enabled check, no hour check).
   - **Layer 2 still applies** — per-site `preferred_days` is still checked. If today is not in a site's preferred days, that site is skipped even on a forced run.
5. For each eligible site, `ContentGenerationAgent` generates `articles_per_day` articles, commits them to `staging/<domain>` via the GitHub API, and Cloudflare Pages rebuilds the staging site.
6. The response (`ScheduledPublishResult`) is returned to the dashboard and displayed in a results panel showing triggered sites, skipped sites (with reasons), and any errors.

### Hourly Cron Tick (automated)

1. CloudGrid fires `GET http://content-pipeline-app/scheduled-publish` at the top of every hour (EST).
2. The content-pipeline runs `runScheduledPublish(config, force=false)`:
   - **Layer 1:** Reads `scheduler/config.yaml` from the network repo. If `enabled: false` → returns `skippedGlobal: "disabled"`. If current hour is not in `run_at_hours` → returns `skippedGlobal: "hour_not_matched"`. Both are ~50ms no-ops.
   - **Layer 2:** If Layer 1 passes, lists all active sites from `dashboard-index.yaml`, reads each site's brief, checks `preferred_days`, and triggers content generation for matching sites.
3. Generated articles are committed to each site's `staging/<domain>` branch, triggering Cloudflare Pages builds.

### CloudGrid's role

| Responsibility | How |
|----------------|-----|
| **Hosting** | Runs dashboard (Next.js) and content-pipeline (Node) as managed services |
| **Cron execution** | `scheduled-publisher` entry in `cloudgrid.yaml` fires hourly |
| **Internal DNS** | `http://content-pipeline-app` resolves inside CloudGrid, allowing dashboard → pipeline communication without public URLs |
| **AI Gateway** | `@cloudgrid-io/ai` provides Claude access in production without API keys |
| **Secrets** | `GITHUB_TOKEN`, `GEMINI_API_KEY`, etc. managed via `cloudgrid secrets set` |

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
