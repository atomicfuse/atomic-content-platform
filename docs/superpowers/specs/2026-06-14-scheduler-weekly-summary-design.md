# Scheduler Weekly Summary — Design Spec

**Date:** 2026-06-14
**Status:** Draft

## Overview

Add a pre-computed weekly summary to MongoDB that tracks per-site, per-day article generation results (actual vs expected), plus a cumulative review count per site. Expose via API on content-pipeline, proxy through dashboard, and render as a color-coded table on a new `/scheduler-summary` page.

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
  _id: string;                        // weekOf, e.g. "2026-06-14"
  weekOf: string;                     // same as _id (Sunday start, YYYY-MM-DD)
  sites: Record<string, DayCell[]>;   // domain -> 7-element array [Sun..Sat]
  updatedAt: Date;
}
```

Each site's array is always 7 elements (index 0 = Sunday, 6 = Saturday). All sites from `dashboard-index.yaml` get a row, including sites with no schedule (all `0/0`).

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

**Index:** `{ weekOf: 1 }` (unique) — though `_id` is already indexed.

### Collection: `review_counts`

One document per site. Tracks total articles with `status: "review"` (cumulative, not per-week).

```typescript
interface ReviewCount {
  _id: string;     // siteDomain
  count: number;   // total articles currently pending review
  updatedAt: Date;
}
```

Starts empty; counts build up as the scheduler creates articles and the dashboard approves/rejects them.

## Write Path

### Weekly summary — `updateWeeklySummary()`

**New file:** `services/content-pipeline/src/stats/weekly-summary.ts`

Called after the scheduler run completes. Both execution paths call it:

1. **Queue path** — in `processSchedulerRun()` (`scheduler-flow.ts`), after writing history to GitHub.
2. **Direct-execution fallback** — in `runScheduledPublish()` (`scheduled-publisher/index.ts`), after `history.finalize()`.

**Inputs:**
- `allSites` — full list from `dashboard-index.yaml` (domains only)
- `siteResults` — triggered sites with `{ domain, articlesRequested, articlesCreated }`
- `skipped` — skipped sites with `{ domain, reason }`
- `errors` — errored sites with `{ domain, articlesRequested }`
- `timezone` — scheduler timezone (from config, typically `"EST"`)

**Logic:**

1. Compute `dayIndex` (0-6, Sunday-based) using the scheduler's timezone.
2. Compute `weekOf` — the Sunday that starts the current week (YYYY-MM-DD).
3. Build a `$set` operation for all sites at once:
   - **Triggered sites** — `{ expected: articlesRequested, created: articlesCreated }`
   - **Skipped (not preferred day / no schedule)** — `{ expected: 0, created: 0 }`
   - **Error sites** — `{ expected: articlesRequested, created: 0 }`
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

**Day index calculation:** Uses the scheduler's timezone via `Intl.DateTimeFormat` (same `currentDayNameInTimezone()` helper from the scheduler). Sunday = 0, Saturday = 6.

### Review counts — increment on article creation

**Where:** In `recordGeneration()` or alongside it in the content-generation flow.

After a batch generation completes, count articles with `status === "review"` and increment:

```typescript
db.collection("review_counts").updateOne(
  { _id: domain },
  { $inc: { count: reviewCount }, $set: { updatedAt: new Date() } },
  { upsert: true },
);
```

Failure-isolated, non-fatal.

### Review counts — decrement on approve/reject

**New content-pipeline endpoint:**

```
POST /review-counts/decrement
Content-Type: application/json
Body: { domain: string, count: number }
```

Decrements the review count for a site. Uses `$inc: { count: -count }` with a floor of 0.

**Dashboard integration:** `services/dashboard/src/actions/review.ts` calls this endpoint (fire-and-forget, failure-isolated) after approving or rejecting articles. Approving N articles = decrement by N. Rejecting (deleting) N articles = decrement by N.

Uses the standard URL fallback pattern:

```typescript
const url = `${getAgentUrl()}/review-counts/decrement`;
fetch(url, { method: "POST", body: JSON.stringify({ domain, count }), ... })
  .catch((err) => console.warn("[review] Failed to update review count:", err));
```

## Read Path

### Content-pipeline endpoint

```
GET /scheduler-summary
```

No parameters. Returns the current week (Sunday-Saturday based on scheduler timezone).

**Logic:**
1. Read scheduler config to get timezone.
2. Compute current week's Sunday (`weekOf`).
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

### Dashboard proxy route

```
GET /api/scheduler-summary
```

Thin proxy to `${getAgentUrl()}/scheduler-summary`. Uses the standard URL fallback pattern (see CLAUDE.md "Service Communication"). No auth required.

**File:** `services/dashboard/src/app/api/scheduler-summary/route.ts`

## Dashboard UI

### New page: `/scheduler-summary`

**File:** `services/dashboard/src/app/scheduler-summary/page.tsx`

Standalone page, no sidebar entry. Client component.

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

**Data fetching:** `useEffect` on mount, fetches `GET /api/scheduler-summary`. Shows loading spinner while fetching.

**Sorting:** Alphabetical by domain (matches API).

## Files to Create / Modify

### New files

| File | Purpose |
|------|---------|
| `services/content-pipeline/src/stats/weekly-summary.ts` | `updateWeeklySummary()`, `getWeeklySummary()`, `getWeekOfSunday()` helpers |
| `services/dashboard/src/app/api/scheduler-summary/route.ts` | Dashboard proxy to content-pipeline |
| `services/dashboard/src/app/scheduler-summary/page.tsx` | Scheduler summary UI page |

### Modified files

| File | Change |
|------|--------|
| `services/content-pipeline/src/stats/types.ts` | Add `WeeklySummary`, `ReviewCount` interfaces and collection names |
| `services/content-pipeline/src/stats/recorder.ts` | Add `updateReviewCount()` call when articles have `status: "review"` |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | Call `updateWeeklySummary()` after direct-execution finalize |
| `services/content-pipeline/src/queue/scheduler-flow.ts` | Call `updateWeeklySummary()` after history write in `processSchedulerRun()` |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Add `/scheduler-summary` GET and `/review-counts/decrement` POST handlers |
| `services/content-pipeline/src/lib/mongo.ts` | Add `ensureWeeklySummaryIndexes()` (if needed beyond `_id`) |
| `services/dashboard/src/actions/review.ts` | Fire-and-forget call to `/review-counts/decrement` after approve/reject |

## Edge Cases

- **Scheduler hasn't run this week yet:** API returns all sites with 7x `{ expected: 0, created: 0 }`, `needReview` from the review_counts collection.
- **MongoDB is down:** Write path fails silently (logged). Read path returns 500 from content-pipeline; dashboard shows error state.
- **Multiple scheduler runs in one day:** Second run overwrites today's cell. `expected` reflects the last run's requested count; `created` reflects the last run's created count. This is acceptable — the scheduler shouldn't run twice on the same day in practice.
- **Site added mid-week:** Appears with `0/0` for past days, actual values from its first run onward.
- **Site deleted mid-week:** Stays in the document for that week (historical data). Dashboard could filter out deleted sites if desired.
- **Review count goes negative:** `$inc: { count: -N }` could theoretically go below 0 if the decrement endpoint is called with stale data. The read path floors at 0: `Math.max(0, doc.count)`.
- **Dot in domain name:** MongoDB keys with dots need special handling. Since site domains (e.g., `travelswire`, `coffeeactually`) are slugs without dots, this is not an issue. If a domain ever contains a dot, the key would need escaping.
