# Scheduler Weekly Summary — Design Spec

**Date:** 2026-06-14
**Status:** Draft

## Overview

Add a pre-computed weekly summary to MongoDB that tracks per-site, per-day article generation results (actual vs expected), plus a cumulative review count per site. Expose via API on content-pipeline, proxy through dashboard, and render as a color-coded table on a new `/scheduler-summary` page.

## Scope

- **V1 shows the current week only** (Sun–Sat). Historical week navigation is out of scope.
- Review counts start from zero on first deploy. Existing `status: "review"` articles in Git are not backfilled — counts build up organically from new scheduler runs.

## Goals

- See at a glance which sites hit their daily article targets and which fell short.
- Track cumulative articles pending human review per site.
- Update automatically after each scheduler run.
- Serve both the dashboard UI and external API consumers.

## Data Model

### Collection: `weekly_summaries`

One document per week, keyed by the Sunday that starts the week.

```typescript
interface DayCell {
  expected: number; // articles_per_day if today is a preferred day, else 0
  created: number;  // articles actually created
}

interface WeeklySummary {
  _id: string;                        // weekOf Sunday, e.g. "2026-06-14" (YYYY-MM-DD)
  sites: Record<string, DayCell[]>;   // siteId -> 7-element array [Sun..Sat]
  updatedAt: Date;
}
```

Each site's array is always 7 elements (index 0 = Sunday, 6 = Saturday). All sites from `dashboard-index.yaml` get a row, including sites with no schedule (all `0/0`).

**Key naming:** The `sites` map uses the site ID (folder slug, e.g. `travelswire`), not the custom domain hostname (`travelswire.com`). These IDs never contain dots, so MongoDB dot-notation in `$set` paths is safe.

Example for `travelswire` (Mon only, 2/day):

```json
"travelswire": [
  { "expected": 0, "created": 0 },
  { "expected": 2, "created": 2 },
  { "expected": 0, "created": 0 },
  { "expected": 0, "created": 0 },
  { "expected": 0, "created": 0 },
  { "expected": 0, "created": 0 },
  { "expected": 0, "created": 0 }
]
```

**`expected` semantics:** Both "not a preferred day" and "no schedule configured" result in `expected: 0`. The data model intentionally does not distinguish between these — the UI shows both as gray `0/0`.

### Collection: `review_counts`

One document per site. Tracks total articles with `status: "review"` (cumulative, not per-week).

```typescript
interface ReviewCount {
  _id: string;     // siteId (folder slug)
  count: number;   // total articles currently pending review
  updatedAt: Date;
}
```

Starts empty; counts build up as the scheduler creates articles and the dashboard approves/rejects them.

**Drift mitigation:** The `$inc`-based approach can drift over time if a decrement call fails (network error). The read path always floors at 0 (`Math.max(0, doc.count)`). If drift becomes a problem in practice, a periodic reconciliation job can be added later — it would scan article frontmatter from Git and reset MongoDB counts. This is out of scope for V1.

## Write Path

### Weekly summary — `updateWeeklySummary()`

**New file:** `services/content-pipeline/src/stats/weekly-summary.ts`

Called after the scheduler run completes. Both execution paths call it:

1. **Queue path** — in `processSchedulerRun()` (`scheduler-flow.ts`), after writing history to GitHub.
2. **Direct-execution fallback** — in `runScheduledPublish()` (`scheduled-publisher/index.ts`), after `history.finalize()`.

**Inputs:**

```typescript
interface WeeklySummaryInput {
  allSiteDomains: string[];        // full list from dashboard-index.yaml
  siteResults: Array<{             // triggered sites (from SiteRunResult)
    domain: string;
    articlesRequested: number;
    articlesCreated: number;
  }>;
  skipped: Array<{                 // skipped sites
    domain: string;
    reason: string;
  }>;
  timezone: string;                // from scheduler config, e.g. "EST"
}
```

**Queue path data availability:** The queue path's `processSchedulerRun()` already calls `listActiveSites()` for auto-publish (line 343 of `scheduler-flow.ts`), so `allSiteDomains` is available. For per-site `articlesRequested` on failed child jobs: `SchedulerRunData.enqueuedDomains` must be expanded from `string[]` to `Array<{ domain: string; count: number }>` so the parent processor knows each site's expected count. The `SchedulerRunData` type in `queue/types.ts` will be updated accordingly.

**Logic:**

1. Compute `dayIndex` (0-6, Sunday-based) using the scheduler's timezone.
2. Compute `weekOf` — the Sunday that starts the current week (YYYY-MM-DD).
3. Build a `$set` operation for all sites at once:
   - **Triggered sites** — `{ expected: articlesRequested, created: articlesCreated }`
   - **Skipped (not preferred day / no schedule)** — `{ expected: 0, created: 0 }`
   - **Error sites** — `{ expected: articlesRequested, created: 0 }`
   - Sites in `allSiteDomains` not in any other category get `{ expected: 0, created: 0 }`
4. Single `updateOne` with upsert:

```typescript
const $set: Record<string, unknown> = { updatedAt: new Date() };
for (const { domain, expected, created } of siteEntries) {
  $set[`sites.${domain}.${dayIndex}`] = { expected, created };
}

db.collection("weekly_summaries").updateOne(
  { _id: weekOf },
  { $set },
  { upsert: true },
);
```

**Failure isolation:** Wrapped in try/catch, logged as non-fatal. Same pattern as `recordGeneration()`.

**Day index and `weekOf` calculation:**

```typescript
// Uses the scheduler's timezone to get the current day name
// Reuses resolveTimezone() from scheduled-publisher for IANA mapping
function getDayIndexAndWeekOf(timezone: string): { dayIndex: number; weekOf: string } {
  const resolved = resolveTimezone(timezone);
  const now = new Date();

  // Get current day-of-week in the scheduler's timezone (0=Sun..6=Sat)
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: resolved,
  }).format(now);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = DAY_NAMES.indexOf(dayName);

  // Get today's date parts in the scheduler's timezone
  const parts = new Intl.DateTimeFormat("en-CA", {  // en-CA gives YYYY-MM-DD
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Walk back to Sunday
  const todayMs = new Date(parts + "T00:00:00Z").getTime();
  const sundayMs = todayMs - dayIndex * 86_400_000;
  const sunday = new Date(sundayMs);
  const weekOf = sunday.toISOString().slice(0, 10);  // "YYYY-MM-DD"

  return { dayIndex: dayIndex === -1 ? 0 : dayIndex, weekOf };
}
```

This handles timezone correctly — e.g., if the scheduler runs at 2 AM EST on Monday, the dayIndex is 1 (Monday) and weekOf is the preceding Sunday, regardless of what UTC date it is.

### Review counts — increment on article creation

**Where:** In `recordGeneration()` (`stats/recorder.ts`), alongside the existing `generation_events` insert and `site_stats` upsert.

The `BatchContentGenerationResult.results` array contains `ContentGenerationResultEntry` objects, each with an `articleStatus` field (`"published" | "review" | undefined`). Count entries where `articleStatus === "review"`:

```typescript
const reviewCount = result.results.filter(
  (r) => r.status === "created" && r.articleStatus === "review"
).length;

if (reviewCount > 0) {
  await db.collection("review_counts").updateOne(
    { _id: result.siteDomain },
    { $inc: { count: reviewCount }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}
```

Failure-isolated, non-fatal — same try/catch pattern.

### Review counts — decrement on approve/reject

**New content-pipeline endpoint:**

```
POST /review-counts/decrement
Content-Type: application/json
Body: { domain: string, count: number }
```

Decrements the review count for a site. Uses `$inc: { count: -count }` with a floor of 0 (enforced at read time via `Math.max(0, doc.count)`).

**Dashboard integration:** `services/dashboard/src/actions/review.ts` — `applyReviewDecisions()` processes decisions grouped by domain. After the per-domain loop completes, fire one decrement call per domain:

```typescript
// After the for-of byDomain loop, fire-and-forget decrement calls
for (const [domain, { approved, rejected }] of byDomain) {
  const decrementCount = approved.length + rejected.length;
  if (decrementCount > 0) {
    const url = `${getAgentUrl()}/review-counts/decrement`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, count: decrementCount }),
    }).catch((err) =>
      console.warn(`[review] Failed to update review count for ${domain}:`, err)
    );
  }
}
```

Uses the standard URL fallback pattern (see CLAUDE.md "Service Communication").

## Read Path

### Content-pipeline endpoint

```
GET /scheduler-summary
```

No parameters. Returns the current week (Sunday-Saturday based on scheduler timezone).

**Logic:**
1. Read scheduler config to get timezone.
2. Compute current week's Sunday (`weekOf`) using `getDayIndexAndWeekOf()`.
3. Read the `weekly_summaries` document for `_id = weekOf`.
4. Read all `review_counts` documents.
5. Merge into the response. Sites missing from `weekly_summaries` get 7x `{ expected: 0, created: 0 }`. Sites missing from `review_counts` get `needReview: 0`.
6. Sort sites alphabetically by domain.

**Response:**

```typescript
interface SchedulerSummaryResponse {
  weekOf: string;              // "2026-06-14"
  timezone: string;            // "EST"
  days: string[];              // ["Sunday", "Monday", ..., "Saturday"]
  sites: Array<{
    domain: string;
    days: Array<{ expected: number; created: number }>;
    needReview: number;
  }>;
}
```

**Error response** (when MongoDB is unavailable or another error occurs):

```typescript
// HTTP 500
{ error: string }
```

### Dashboard proxy route

```
GET /api/scheduler-summary
```

Thin proxy to `${getAgentUrl()}/scheduler-summary`. Uses the standard URL fallback pattern (see CLAUDE.md "Service Communication"). No auth required (excluded by middleware — all `/api/` routes are public).

**File:** `services/dashboard/src/app/api/scheduler-summary/route.ts`

**Error handling:** If the content-pipeline is unreachable or returns non-200, the proxy returns `{ error: "Failed to fetch scheduler summary" }` with HTTP 502. The client component shows an error message in the UI.

## Dashboard UI

### New page: `/scheduler-summary`

**File:** `services/dashboard/src/app/scheduler-summary/page.tsx`

Standalone page. Accessible via direct URL. A link to this page should be added to the existing Scheduler Log page (`/settings/scheduler-log`) as a "Weekly Summary" link in the header area.

**Header:** "Scheduler Summary — Week of Jun 14 - Jun 20, 2026"

**Table:**

| Site | Sun | Mon | Tue | Wed | Thu | Fri | Sat | Need Review |
|------|-----|-----|-----|-----|-----|-----|-----|-------------|
| travelswire | 0/0 | 2/2 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 1 |
| coffeeactually | 0/0 | 2/2 | 2/2 | 2/2 | 2/2 | 0/0 | 0/0 | 0 |

**Cell format:** `created/expected`

**Cell colors:**
- **Gray text** — `0/0` (not scheduled that day)
- **Green text/bg** — `created === expected && expected > 0` (target met)
- **Dark yellow text/bg** — `created > 0 && created < expected` (partial)
- **Red text/bg** — `created === 0 && expected > 0` (scheduled but nothing created)

**Need Review column:**
- **Gray** — `0`
- **Amber/orange** — `> 0`

**Data fetching:** Client component with `useEffect` on mount, fetches `GET /api/scheduler-summary`. Shows loading spinner while fetching. Shows error message if fetch fails.

**Sorting:** Alphabetical by domain (matches API).

## Files to Create / Modify

### New files

| File | Purpose |
|------|---------|
| `services/content-pipeline/src/stats/weekly-summary.ts` | `updateWeeklySummary()`, `getWeeklySummary()`, `getDayIndexAndWeekOf()` helpers |
| `services/dashboard/src/app/api/scheduler-summary/route.ts` | Dashboard proxy to content-pipeline |
| `services/dashboard/src/app/scheduler-summary/page.tsx` | Scheduler summary UI page |

### Modified files

| File | Change |
|------|--------|
| `services/content-pipeline/src/stats/types.ts` | Add `WeeklySummary`, `DayCell`, `ReviewCount` interfaces and collection names to `COLLECTIONS` |
| `services/content-pipeline/src/stats/recorder.ts` | Add `$inc` to `review_counts` when `articleStatus === "review"` on created results |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | Call `updateWeeklySummary()` after direct-execution finalize |
| `services/content-pipeline/src/queue/scheduler-flow.ts` | Call `updateWeeklySummary()` after history write in `processSchedulerRun()` |
| `services/content-pipeline/src/queue/types.ts` | Expand `SchedulerRunData.enqueuedDomains` from `string[]` to `Array<{ domain: string; count: number }>` |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Add `GET /scheduler-summary` and `POST /review-counts/decrement` handlers (this is the HTTP server entrypoint, not the agent module) |
| `services/dashboard/src/actions/review.ts` | Fire-and-forget per-domain calls to `/review-counts/decrement` after approve/reject loop |
| `services/dashboard/src/app/settings/scheduler-log/page.tsx` | Add "Weekly Summary" link to `/scheduler-summary` |

## Edge Cases

- **Scheduler hasn't run this week yet:** API returns all sites with 7x `{ expected: 0, created: 0 }`, `needReview` from the `review_counts` collection.
- **MongoDB is down:** Write path fails silently (logged). Read path returns 500 from content-pipeline; dashboard proxy returns 502; UI shows error state.
- **Multiple scheduler runs in one day:** Second run overwrites today's cell via `$set`. `expected` reflects the last run's requested count; `created` reflects the last run's created count. The scheduler is designed to run once per day; manual "Run Now" could produce a second run, but the last result is the most relevant.
- **Site added mid-week:** Appears with `0/0` for past days, actual values from its first run onward.
- **Site deleted mid-week:** Stays in the document for that week (historical data). Dashboard could filter out deleted sites if desired.
- **Review count goes negative:** `$inc: { count: -N }` could theoretically go below 0 if the decrement endpoint is called with stale data. The read path floors at 0: `Math.max(0, doc.count)`.
- **Timezone change mid-week:** If `scheduler/config.yaml` timezone changes mid-week, `weekOf` is recomputed from the new timezone. In practice the timezone never changes, but if it did near a day boundary, one day's data could land in the wrong week document. Accepted risk — timezone changes are extremely rare.
- **Concurrent scheduler runs (duplicate cron tick):** MongoDB single-document `updateOne` is atomic — last write wins. Both runs write the same day index, so the result is correct (identical data from the same run, or last-write-wins if truly concurrent).
- **Dashboard approve/reject decrement fails:** Review count drifts upward. Mitigated by `Math.max(0, count)` at read time (prevents negative display). Periodic reconciliation can be added if drift becomes a problem.
