# Ops Dashboard — Design Spec

**Date:** 2026-06-08
**Status:** Draft
**Replaces:** Current dashboard homepage (StatsPanel + SitesTable + ActivityFeed)

## Overview

Rebuild the dashboard homepage as an operational console. The current sites table moves exclusively to `/sites`. The new dashboard surfaces per-site health, generation stats, AI costs, and alerts through filter cards, a cost strip, a sortable table, and expandable site detail panels.

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Card-as-filter, full-width table (no persistent sidebar) | Simpler, table gets full width |
| Row expand | Multi-expand | Compare multiple sites simultaneously |
| Detail actions | View Site, Review Queue, Re-seed KV, Generate Images | Quick-action without navigating away |
| Data gaps | Extend API first, then build UI | No stubs or placeholders |
| R2 metrics | MongoDB running tally + backfill | Fast reads, no runtime R2 scan |
| Published today | `articlesPerDay` only on `preferredDays` | Respects schedule, zero on off-days |
| Sort order | Priority-tiered (down > sync fail > failures > alerts > healthy) | Clear severity ordering without opaque scores |
| Sync failed card | Sync only (renamed from "Failed 24h build/sync") | Builds don't exist post-migration |
| Data freshness | Server-render + client polling (60s) | Ops dashboard stays current without reload |
| Light theme | AtomicLabs brand palette (#6D4AFF primary) | Linear/Vercel/Stripe SaaS aesthetic |

## Architecture

### Data Flow

```
page.tsx (server component)
│
├── Promise.all([
│     readDashboardIndex(),            ← site list + status + vertical + customDomain
│     fetch("/api/site-stats"),
│     fetch("/api/site-checks"),
│     fetch("/api/site-costs"),
│     fetch("/api/attention"),
│     fetch("/api/r2-usage"),
│   ])
│
└── <OpsDashboard
      initialIndex={index}             ← DashboardSiteEntry[] (status, vertical, customDomain)
      initialStats={stats}
      initialChecks={checks}
      initialCosts={costs}
      initialAttention={attention}
      initialR2={r2}
    />
        │
        ├── useEffect: poll 5 API endpoints every 60s (index is static, not polled)
        ├── useMemo: merge index + API data into unified OpsRow[]
        ├── useMemo: compute card counts from merged rows
        ├── useMemo: compute cost strip totals
        └── useState: activeCard, expandedRows, search, filters
```

**6 data sources:** The server component fetches the dashboard index (for `status`, `customDomain`, `vertical` — fields not available in any API endpoint) plus the 5 API endpoints in parallel for fast first paint. The client component receives all initial data as props. Only the 5 API endpoints are polled on a 60-second interval — the dashboard index is static (site metadata doesn't change between page loads). A "Last refreshed: Xs ago" indicator and manual "Refresh now" button are in the header.

### Merged Row Type

Each table row joins data from the dashboard index + 4 site-keyed API responses on `siteDomain`. The merge happens in `ops-helpers.ts` → `mergeOpsRows()`, which flattens nested API fields and renames for clarity:

```ts
type OpsRow = {
  // from dashboard index (DashboardSiteEntry)
  domain: string;
  status: SiteStatus;
  customDomain: string | null;
  vertical: string;                    // for Category filter dropdown

  // from /api/site-stats — flattened from failedArticles.last7d → failedArticles7d
  failedArticles7d: number;
  failedArticles30d: number;
  imageGenFailed7d: number;
  imageGenFailed30d: number;
  reviewCount: number;
  generalImages: number;
  todayCreated: number;               // from today.created (new field)
  todayExpected: number;              // from today.expected (new field)
  thisWeekCreated: number;            // from thisWeek.created — needed for cost formulas
  schedule: {
    articlesPerDay: number;
    preferredDays: string[];
    weeklyTarget: number;
    nextRun: string | null;           // ISO string (JSON-serialized Date)
  } | null;
  recentArticles: {
    title: string;
    score: number | null;
    status: string;
    slug: string;
    publishDate: string;
  }[];
  lastAdded: { at: string; source: string; count: number } | null;
  lastFailedAt: string | null;

  // from /api/site-checks — matches MergedChecks shape
  uptime: { state: string; ok: boolean; statusCode: number | null; responseTimeMs: number | null };
  sync: { state: string; ok: boolean; syncedAt: string | null; error: string | null };
  ssl: { state: string; status: string | null; daysLeft: number | null; expiresAt: string | null };
  tracking: { state: string; ga4: boolean; gtm: boolean; pixel: boolean };
  domainExpiry: { state: string; daysLeft: number | null; expiresAt: string | null; autoRenew: boolean | null };
  // Note: API field is `domain` in MergedChecks; renamed to `domainExpiry` to avoid
  // collision with the `domain: string` field above.

  // from /api/attention — API field is `alerting`; renamed to `alerts` during merge
  alerts: { condition: string; severity: string; since: string; value: number | null }[];

  // computed by mergeOpsRows()
  tier: 0 | 1 | 2 | 3 | 4;
};
```

**Field mapping notes** (implemented in `mergeOpsRows()`):
- `failedArticles.last7d` → `failedArticles7d` (flatten)
- `imageGenFailed.last7d` → `imageGenFailed7d` (flatten)
- `checks.domain` → `domainExpiry` (rename to avoid collision)
- `alerting[]` → `alerts[]` (rename for clarity)
- Nullable check fields (`statusCode`, `responseTimeMs`, `daysLeft`, etc.) preserve `null` — UI components handle null display ("n/a", "—")

## API Extensions

### 1. `/api/site-stats` — add daily granularity

Add `today` field to each `SiteStat` in the response:

```jsonc
{
  "today": {
    "created": 2,
    "expected": 3  // articlesPerDay if today is a preferredDay, else 0
  }
}
```

**Two-part implementation:**

1. **Content-pipeline** (`/site-stats` response): Add `today.created` — count of `generation_events` where `createdAt >= startOfDay(today, UTC)` and `status = "published"` for each site. This is a new MongoDB aggregation in `services/content-pipeline/src/stats/repo.ts` (the existing stats query module).

2. **Dashboard enrichment** (`enrichSite()` in `site-stats.ts`): Add `today.expected` — computed from the site's `schedule.articlesPerDay` and `schedule.preferredDays`, same day-of-week check as `computeNextRun()`. For sites with `schedule: null` (never generated), defaults to `{ created: 0, expected: 0 }`. Uses site-level `articlesPerDay` (not per-topic — per-topic scheduling is a content-pipeline internal detail; the site-level schedule is the resolved value).

### 2. `/api/site-costs` — add daily + aggregate fields

Extend `windows` in each `SiteCost`:

```jsonc
{
  "windows": {
    "todayUsd": 0.42,
    "thisWeekUsd": 1.12,
    "last30dUsd": 6.40,
    "allTimeTokens": { "input": 5200000, "output": 1800000 },
    "avgPerArticle7dUsd": 0.18
  }
}
```

- `todayUsd`: sum of `cost_events` where date = today (UTC).
- `allTimeTokens`: sum of all `tokensUse.input` / `.output` across all `cost_events`.
- `avgPerArticle7dUsd`: `sum(cost 7d) / count(articles created 7d)` — joins `cost_events` with `generation_events`.
- `created7d`: count of articles created in the last 7 days for this site (from `generation_events`). Needed by the CostStrip for network-wide average computation.

All new fields are computed in `services/content-pipeline/src/costs/repo.ts` (where `getSiteCosts` / `SiteCostsResponse` is defined). The dashboard's `/api/site-costs/route.ts` is a thin proxy and passes through unchanged.

### 3. `/api/site-checks` — no changes

The "Sync failed (24h)" card is computed client-side: `sync.ok === false && Date.now() - new Date(sync.syncedAt) < 86400000`. No API changes needed.

### 4. `/api/r2-usage` — new endpoint

New dashboard API route:

```jsonc
// GET /api/r2-usage
{
  "totalBytes": 4831838208,
  "totalImages": 14200,
  "capacityPct": 4.5,
  "lastUpdated": "2026-06-08T12:00:00Z"
}
```

Reads from a MongoDB `r2_usage` collection (single document, upserted on each write).

**Write path:** Every R2 upload increments the tally:
- `seed-kv.ts` image uploads: `$inc: { totalBytes: size, totalImages: 1 }`
- Dashboard article image upload (`/api/articles/upload`): same `$inc`
- Content-pipeline image generation: same `$inc`

**Backfill:** One-time `services/content-pipeline/src/stats/backfill-r2.ts` script. Lists all objects in `atl-assets-prod` via S3 API, sums sizes, counts objects, writes the initial tally to MongoDB. Idempotent (overwrites the tally document).

**Capacity calculation:** `capacityPct = totalBytes / R2_CAPACITY_BYTES * 100`. `R2_CAPACITY_BYTES` defaults to 10GB (free tier). Configurable via env var if the plan changes.

## Component Design

### Component Hierarchy

```
services/dashboard/src/
├── app/page.tsx                           # server component: fetch + render
├── components/ops/
│   ├── OpsDashboard.tsx                   # "use client" — polling, state, merge
│   ├── FilterCards.tsx                    # 7 clickable metric cards
│   ├── CostStrip.tsx                     # single-line cost/usage bar
│   ├── FilterBar.tsx                     # search input + status/category dropdowns
│   ├── OpsTable.tsx                      # table container (header + rows + pagination)
│   ├── OpsTableRow.tsx                   # single row with expand toggle
│   └── SiteDetailPanel.tsx              # 5-panel detail + action buttons
└── lib/
    └── ops-helpers.ts                    # merge, tier, card predicates, cost sums
```

### FilterCards

Seven cards in a horizontal grid (`grid-cols-7`). Each card displays:
- Icon in a colored circle (status-colored background)
- Uppercase label
- Bold count number

Active card gets a `#6D4AFF` (purple) border. Clicking a card sets it as the active filter. Clicking the active card deselects it (shows all sites). Card counts are always computed from **unfiltered** data so they stay accurate regardless of active filter.

| Card | Label | Count source | Color |
|------|-------|-------------|-------|
| All Sites (Live) | `ALL_LIVE` | `rows.filter(r => r.status === "Live").length` | Purple (accent) |
| Needs Attention | `ATTENTION` | `rows.filter(r => r.alerts.length > 0).length` | Warning orange |
| Failed Articles (7d) | `FAILED_ARTICLES` | `rows.filter(r => r.failedArticles7d > 3).length` | Error red |
| Sites Down | `SITES_DOWN` | `rows.filter(r => !r.uptime.ok).length` | Error red |
| Sync Failed (24h) | `SYNC_FAILED` | `rows.filter(r => !r.sync.ok && within24h(r.sync.syncedAt)).length` | Warning orange |
| Published Today | `PUBLISHED_TODAY` | `sum(todayCreated) / sum(todayExpected)` display format | Success green |
| In Review | `IN_REVIEW` | `sum(rows[].reviewCount)` total | Info purple |

**Card filter predicates** (applied to table when card is active):

| Card | Filter predicate |
|------|-----------------|
| All Sites (Live) | `r.status === "Live"` |
| Needs Attention | `r.alerts.length > 0` |
| Failed Articles (7d) | `r.failedArticles7d > 3` |
| Sites Down | `r.uptime.ok === false` |
| Sync Failed (24h) | `r.sync.ok === false && within24h(r.sync.syncedAt)` |
| Published Today | `r.todayExpected > 0` (shows all sites scheduled for today) |
| In Review | `r.reviewCount > 0` |

### CostStrip

Single horizontal bar with 5 metrics separated by light dividers:

| Metric | Source | Computation | Format |
|--------|--------|-------------|--------|
| AI spend today | `/api/site-costs` | `sum(sites[].windows.todayUsd)` | `$X.XX` |
| Avg/article (7d) | `/api/site-costs` | `totalCost7d / totalCreated7d` (see below) | `$X.XX` |
| Expected monthly | derived | `networkAvgPerArticle × projectedMonthlyArticles` (see below) | `$XX.XX` |
| Total tokens | `/api/site-costs` | `sum(sites[].windows.allTimeTokens.input)`, same for `.output` | `X.XM in · X.XM out` |
| R2 storage | `/api/r2-usage` | `totalBytes`, `capacityPct`, `totalImages` directly | `X.X GB · XX% · XX,XXX imgs` |

**Cost formula details:**

- `totalCost7d` = `sum(sites[].windows.thisWeekUsd)` — network-wide AI spend last 7 days.
- `totalCreated7d` = `sum(sites[].windows.created7d)` — network-wide articles created last 7 days (new field from API extension #2).
- `networkAvgPerArticle` = `totalCost7d / totalCreated7d` — the true network average (not an average of per-site averages).
- `projectedMonthlyArticles` = `sum(sites[].schedule.articlesPerDay × sites[].schedule.preferredDays.length × 4.33)` — from site-stats schedule data, only for sites with `schedule !== null`.
- `Expected monthly` = `networkAvgPerArticle × projectedMonthlyArticles`.
- If `totalCreated7d === 0`, display "—" for Avg/article and Expected monthly (avoid division by zero).

### OpsTable

10 columns:

| Column | Source | Display |
|--------|--------|---------|
| Site | `domain` / `customDomain` | Text, bold |
| Status | `status` | Colored badge (Live=green, Staging=amber, etc.) |
| Failed 7d | `failedArticles7d` | Red if > 3, muted gray if 0 |
| Img Fail | `imageGenFailed7d` | Orange if > 0, muted gray if 0 |
| Uptime | `uptime.ok` | Green dot "Up" / Red dot "Down" / gray "n/a" |
| Sync | `sync.ok` | Green dot "OK" / Red dot "Fail" |
| Review | `reviewCount` | Purple if > 15, gray otherwise |
| SSL | `ssl.status` | Green checkmark / red X / gray "n/a" |
| Tracking | `tracking.ga4/gtm/pixel` | Three inline labels, green if true, muted if false |
| Domain | `domainExpiry.daysLeft` | Days number, orange if < 60, red if < 30, "—" if null |

**Default sort:** Priority-tiered (tier ascending, then alphabetical within tier).

**Pagination:** Same pattern as existing SitesTable — page size selector (10, 25, 50, 100), prev/next buttons, page number selector.

**Row click:** Toggles expand/collapse for that row (multi-expand enabled).

**Row highlighting:** Problem rows (tier 0) get a light red background (`#FEF2F2`).

### Priority Tiers

| Tier | Condition | Visual |
|------|-----------|--------|
| 0 — critical | `uptime.ok === false` | Red background row |
| 1 — error | `sync.ok === false && within 24h` | Normal row, red sync indicator |
| 2 — warning | `failedArticles7d > 3` OR `reviewCount > 15` | Normal row, red/purple counts |
| 3 — info | `alerts.length > 0` (not covered above) | Normal row |
| 4 — healthy | No issues | Normal row, all green |

Within each tier: alphabetical by domain.

### SiteDetailPanel

Expands below the clicked row with a purple top border (`#6D4AFF`). Contains a 5-column grid of white cards on a gray background:

| Panel | Content |
|-------|---------|
| **Schedule** | Preferred days, articles/day, next run datetime |
| **Failed Articles** | 7d count (bold, red), 30d count |
| **Image Gen Failed** | 7d count (bold, orange), 30d count |
| **Checks** | Uptime (status + response time), Sync (status + last sync time), SSL (status + days left), Tracking (GA4/GTM/Pixel booleans) |
| **Recent Articles** | Up to 5 articles: title, quality score (color-coded), status |

Sub-card borders are semantic: red border for Failed Articles, amber for Image Gen Failed, purple for the rest.

**Action buttons row** below the panels:

| Button | Style | Action |
|--------|-------|--------|
| View Site → | Primary (solid purple) | `router.push(/sites/${domain})` |
| Review Queue → | Secondary (purple outline) | `router.push(/sites/${domain}?tab=content&filter=review)` |
| Re-seed KV | Secondary | Calls `POST /api/sites/reseed` (see below) |
| Generate Images → | Secondary | `router.push(/general-images?site=${domain})` |

### Re-seed KV Endpoint

**`POST /api/sites/reseed`** — new dashboard API route.

```jsonc
// Request
{ "domain": "travelswire" }

// Response (success)
{ "ok": true, "message": "KV re-seed triggered for travelswire" }

// Response (error)
{ "ok": false, "error": "seed-kv failed: ..." }
```

Implementation: Calls a new content-pipeline `/seed-kv` endpoint (internal, proxied like other agent calls using the `getAgentUrl()` fallback pattern). The content-pipeline runs `seed-kv.ts` for the requested site. Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` on the content-pipeline side. Returns success/failure — the UI shows a toast notification.

The button is disabled with a spinner while the request is in-flight. On success: green toast "KV re-seeded for {domain}". On failure: red toast with the error message.

### FilterBar

Horizontal row above the table:
- Search input (filters by domain, debounced 300ms)
- Status dropdown (All / Live / Staging / WordPress / etc.)
- Category dropdown (populated from `vertical` field on `DashboardSiteEntry` — deduplicated list of all unique verticals across sites)
- "Reset filters" link (purple text)

Filters compose with the active card filter. Search + dropdown filters are AND-ed. Card filter is AND-ed on top.

## Theme

Uses existing `next-themes` dark/light toggle. No hardcoded hex values in components — all colors via Tailwind classes.

### Light Mode Palette (AtomicLabs brand)

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#6D4AFF` | Active card border, selected state, links, primary buttons, pagination active |
| Primary hover | `#5B3EF0` | Button hover |
| Primary light | `#F3F0FF` | Icon circles, active row background, info background |
| Primary border | `#D9CCFF` | Secondary button border, info card border |
| Page background | `#F8F9FC` | Canvas |
| Card background | `#FFFFFF` | Cards, table, inputs |
| Card border | `#E7E8F0` | Default card/table border |
| Divider | `#EEF0F5` | Table row borders, section dividers |
| Secondary text | `#6B7280` | Labels, muted values |
| Primary text | `#111827` | Values, counts |
| Heading text | `#0F172A` | Site names, section headings |
| Success | `#10B981` | Up, OK, published, good scores |
| Success bg | `#ECFDF5` | Live badge background |
| Success border | `#A7F3D0` | Live badge border |
| Warning | `#F59E0B` | Sync failed, image fail, moderate scores |
| Warning bg | `#FFFBEB` | Staging badge, warning card icon bg |
| Warning border | `#FCD34D` | Staging badge border, image fail card border |
| Error | `#EF4444` | Down, failed articles, critical |
| Error bg | `#FEF2F2` | Problem row highlight, error card icon bg |
| Error border | `#FECACA` | Failed articles card border |
| Muted | `#D1D5DB` | Zero values, missing data, disabled tracking labels |

### Dark Mode

Uses the existing dashboard dark theme (already in place via `next-themes`). Purple remains the primary accent in both modes — `#d2a8ff` in dark mode maps to the same semantic role as `#6D4AFF` in light mode (active card border, primary buttons, links, selected states).

| Token | Hex | Light equivalent |
|-------|-----|-----------------|
| Page background | `#0d1117` | `#F8F9FC` |
| Surface | `#161b22` | `#FFFFFF` |
| Border | `#30363d` | `#E7E8F0` |
| Primary (accent) | `#d2a8ff` | `#6D4AFF` |
| Primary light | `#1c1433` | `#F3F0FF` |
| Primary border | `#4c3a80` | `#D9CCFF` |
| Success | `#3fb950` | `#10B981` |
| Error | `#f85149` | `#EF4444` |
| Warning | `#f0883e` | `#F59E0B` |
| Muted | `#484f58` | `#D1D5DB` |

Tailwind CSS variables map these via `dark:` variants. The `--color-primary` variable switches between `#6D4AFF` (light) and `#d2a8ff` (dark) so components use a single class (e.g. `text-primary`, `border-primary`) without per-mode overrides.

### Shadow

```css
box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05),
            0 8px 24px rgba(15, 23, 42, 0.04);
```

## Files Changed

| File | Change |
|------|--------|
| **Dashboard — page + components** | |
| `services/dashboard/src/app/page.tsx` | Replace current content — server-fetch 6 sources (index + 5 APIs), render `<OpsDashboard>` |
| `services/dashboard/src/components/ops/OpsDashboard.tsx` | **New** — main client component (polling, state, merge) |
| `services/dashboard/src/components/ops/FilterCards.tsx` | **New** — 7 filter cards |
| `services/dashboard/src/components/ops/CostStrip.tsx` | **New** — cost/usage bar |
| `services/dashboard/src/components/ops/FilterBar.tsx` | **New** — search + status/category dropdowns |
| `services/dashboard/src/components/ops/OpsTable.tsx` | **New** — table with header, rows, pagination |
| `services/dashboard/src/components/ops/OpsTableRow.tsx` | **New** — row + expand toggle |
| `services/dashboard/src/components/ops/SiteDetailPanel.tsx` | **New** — 5-panel detail + action buttons |
| `services/dashboard/src/lib/ops-helpers.ts` | **New** — `mergeOpsRows()`, tier computation, card predicates, cost strip math |
| **Dashboard — API routes** | |
| `services/dashboard/src/app/api/r2-usage/route.ts` | **New** — R2 metrics from MongoDB |
| `services/dashboard/src/app/api/sites/reseed/route.ts` | **New** — `POST` proxies to content-pipeline `/seed-kv` for a single site |
| `services/dashboard/src/app/api/site-stats/route.ts` | Extend — add `today.expected` in `enrichSite()` |
| `services/dashboard/src/lib/site-stats.ts` | Extend — `enrichSite()` adds `today.expected` computation |
| **Content-pipeline** | |
| `services/content-pipeline/src/stats/repo.ts` | Extend — add `today.created` to `/site-stats` response (daily aggregation query) |
| `services/content-pipeline/src/costs/repo.ts` | Extend — add `todayUsd`, `allTimeTokens`, `avgPerArticle7dUsd`, `created7d` to `SiteCostsResponse.windows` |
| `services/content-pipeline/src/stats/r2-tally.ts` | **New** — R2 tally `$inc` helpers + `/r2-usage` query |
| `services/content-pipeline/src/stats/backfill-r2.ts` | **New** — one-time R2 backfill script |
| **R2 upload call sites** | |
| `packages/site-worker/scripts/seed-kv.ts` | Add `$inc` R2 tally on image upload |
| `services/dashboard/src/app/api/articles/upload/route.ts` | Add `$inc` R2 tally on article image upload |
| `services/content-pipeline/src/agents/content-generation/agent.ts` | Add `$inc` R2 tally on image generation upload |

**Untouched:** `SitesTable.tsx`, `StatsPanel.tsx`, `ActivityFeed.tsx` — remain for `/sites`. The dashboard page stops importing them.

## Edge Cases

- **MongoDB down:** All endpoints return 503. `OpsDashboard` shows a banner: "Unable to load ops data — check MongoDB connection." Cards show "—" instead of counts. Last-known data from previous successful poll is preserved in state.
- **Content-pipeline down:** `/api/site-stats` and `/api/site-costs` return 502. Dashboard shows partial data (checks from Domains Dashboard still work). Affected cards show "—".
- **No generation history:** New sites show zero counts across all stats. Cards compute correctly (zero doesn't trigger alerts).
- **Staging-only sites:** Uptime, SSL, Domain columns show "n/a". These sites never appear in "Sites Down" or domain expiry warnings.
- **Polling failure:** If a poll fails, the previous successful data is retained. The "Last refreshed" timer keeps counting up. After 3 consecutive failures, a subtle warning appears.
- **Multiple dashboard users:** Each browser polls independently. At 60s intervals with 5 lightweight endpoints, this is negligible load. Content-pipeline already caches upstream responses.
