# Scheduler Weekly Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MongoDB-backed weekly summary that tracks per-site daily article generation (actual vs expected) plus cumulative review counts, exposed via API and a dashboard page.

**Architecture:** New `weekly_summaries` and `review_counts` MongoDB collections written after each scheduler run. Content-pipeline serves `GET /scheduler-summary` and `POST /review-counts/decrement`. Dashboard proxies the GET, calls decrement on review approve/reject, and renders a color-coded table at `/scheduler-summary`.

**Tech Stack:** TypeScript, MongoDB (via existing `mongodb` driver), Node HTTP server (content-pipeline), Next.js 15 App Router (dashboard), React 19, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-06-14-scheduler-weekly-summary-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `services/content-pipeline/src/stats/weekly-summary.ts` | `getDayIndexAndWeekOf()`, `updateWeeklySummary()`, `getWeeklySummary()`, `decrementReviewCount()` |
| `services/content-pipeline/src/__tests__/weekly-summary.test.ts` | Unit tests for weekly-summary module |
| `services/dashboard/src/app/api/scheduler-summary/route.ts` | Dashboard proxy → content-pipeline |
| `services/dashboard/src/app/scheduler-summary/page.tsx` | Weekly summary UI page |

### Modified files

| File | What changes |
|------|-------------|
| `services/content-pipeline/src/stats/types.ts` | Add `DayCell`, `WeeklySummary`, `ReviewCount` interfaces + collection names |
| `services/content-pipeline/src/stats/recorder.ts` | Add review count `$inc` inside `recordGeneration()` |
| `services/content-pipeline/src/queue/types.ts` | Expand `SchedulerRunData.enqueuedDomains` to carry `count` per site |
| `services/content-pipeline/src/queue/scheduler-flow.ts` | Update `createSchedulerFlow()` and `processSchedulerRun()` for new type + call `updateWeeklySummary()` |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | Call `updateWeeklySummary()` after `history.finalize()` |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Add `GET /scheduler-summary` and `POST /review-counts/decrement` HTTP handlers |
| `services/dashboard/src/actions/review.ts` | Fire-and-forget decrement calls after approve/reject |
| `services/dashboard/src/app/settings/scheduler-log/page.tsx` | Add "Weekly Summary" link |

---

## Task 1: Add types and collection constants

**Files:**
- Modify: `services/content-pipeline/src/stats/types.ts:47-51`

- [ ] **Step 1: Write the failing test**

Create `services/content-pipeline/src/__tests__/weekly-summary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "../stats/types.js";

describe("COLLECTIONS", () => {
  it("includes weekly_summaries and review_counts", () => {
    expect(COLLECTIONS.weeklySummaries).toBe("weekly_summaries");
    expect(COLLECTIONS.reviewCounts).toBe("review_counts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: FAIL — `COLLECTIONS.weeklySummaries` is undefined.

- [ ] **Step 3: Add types and collection names**

In `services/content-pipeline/src/stats/types.ts`, add after the `ImageGenEvent` interface (after line 45), before the `COLLECTIONS` const:

```typescript
export interface DayCell {
  expected: number;
  created: number;
}

export interface WeeklySummary {
  _id: string;                        // weekOf Sunday, YYYY-MM-DD
  sites: Record<string, DayCell[]>;   // siteId -> 7-element array [Sun..Sat]
  updatedAt: Date;
}

export interface ReviewCount {
  _id: string;     // siteId
  count: number;
  updatedAt: Date;
}
```

Then update the `COLLECTIONS` const to add the new collection names:

```typescript
export const COLLECTIONS = {
  generationEvents: "generation_events",
  siteStats: "site_stats",
  imageGenEvents: "image_gen_events",
  weeklySummaries: "weekly_summaries",
  reviewCounts: "review_counts",
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/stats/types.ts services/content-pipeline/src/__tests__/weekly-summary.test.ts
git commit -m "feat(stats): add WeeklySummary and ReviewCount types and collection names"
```

---

## Task 2: Implement `getDayIndexAndWeekOf()` with tests

**Files:**
- Create: `services/content-pipeline/src/stats/weekly-summary.ts`
- Test: `services/content-pipeline/src/__tests__/weekly-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `services/content-pipeline/src/__tests__/weekly-summary.test.ts`:

```typescript
import { getDayIndexAndWeekOf } from "../stats/weekly-summary.js";

describe("getDayIndexAndWeekOf", () => {
  it("returns dayIndex=0 and the same date for a Sunday", () => {
    // 2026-06-14 is a Sunday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-14T12:00:00Z"));
    expect(result.dayIndex).toBe(0);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=1 and walks back to Sunday for a Monday", () => {
    // 2026-06-15 is a Monday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.dayIndex).toBe(1);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=6 and walks back to Sunday for a Saturday", () => {
    // 2026-06-20 is a Saturday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-20T12:00:00Z"));
    expect(result.dayIndex).toBe(6);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles EST timezone correctly near midnight UTC", () => {
    // 2026-06-16T03:00:00Z = Mon Jun 15 at 11 PM EST (still Monday EST)
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-16T03:00:00Z"));
    expect(result.dayIndex).toBe(1); // Monday in EST
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles week boundary: early Sunday UTC is still Saturday EST", () => {
    // 2026-06-14T02:00:00Z = Sat Jun 13 at 10 PM EST (still Saturday)
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-14T02:00:00Z"));
    expect(result.dayIndex).toBe(6); // Saturday in EST
    expect(result.weekOf).toBe("2026-06-07"); // previous week's Sunday
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: FAIL — `getDayIndexAndWeekOf` not found.

- [ ] **Step 3: Implement `getDayIndexAndWeekOf()`**

Create `services/content-pipeline/src/stats/weekly-summary.ts`:

```typescript
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { DayCell } from "./types.js";

/**
 * Map common timezone abbreviations to IANA names.
 * Same map as scheduled-publisher/index.ts — duplicated to keep
 * the stats module self-contained (no cross-directory agent import).
 */
const TIMEZONE_MAP: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
};

function resolveTimezone(tz: string): string {
  return TIMEZONE_MAP[tz.toUpperCase()] ?? tz;
}

/**
 * Compute the day-of-week index (0=Sun..6=Sat) and the week-of Sunday
 * date string (YYYY-MM-DD) for a given timezone and instant.
 *
 * @param timezone - Scheduler timezone abbreviation or IANA name
 * @param now - Current instant (injectable for testing)
 */
export function getDayIndexAndWeekOf(
  timezone: string,
  now: Date = new Date(),
): { dayIndex: number; weekOf: string } {
  const resolved = resolveTimezone(timezone);

  // Get current day-of-week in the scheduler's timezone (0=Sun..6=Sat)
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: resolved,
  }).format(now);
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayIndex = Math.max(0, DAY_NAMES.indexOf(dayName));

  // Get today's date in the scheduler's timezone (YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Walk back to Sunday
  const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
  const sundayMs = todayMs - dayIndex * 86_400_000;
  const sunday = new Date(sundayMs);
  const weekOf = sunday.toISOString().slice(0, 10);

  return { dayIndex, weekOf };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/stats/weekly-summary.ts services/content-pipeline/src/__tests__/weekly-summary.test.ts
git commit -m "feat(stats): implement getDayIndexAndWeekOf with timezone support"
```

---

## Task 3: Implement `updateWeeklySummary()` with tests

**Files:**
- Modify: `services/content-pipeline/src/stats/weekly-summary.ts`
- Test: `services/content-pipeline/src/__tests__/weekly-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `services/content-pipeline/src/__tests__/weekly-summary.test.ts`. These tests mock MongoDB. Replace the file's imports and add a **single module-level mock** that supports all MongoDB operations used across Tasks 3 and 4:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { COLLECTIONS } from "../stats/types.js";
import { getDayIndexAndWeekOf, updateWeeklySummary } from "../stats/weekly-summary.js";

// MongoDB mocks — single setup used by all describe blocks
const mockUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
const mockFindOne = vi.fn().mockResolvedValue(null);
const mockFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
const mockCollection = vi.fn().mockReturnValue({
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
  find: mockFind,
});
vi.mock("../lib/mongo.js", () => ({
  getMongoDb: vi.fn().mockResolvedValue({ collection: (...args: unknown[]) => mockCollection(...args) }),
}));

// ... keep the existing COLLECTIONS and getDayIndexAndWeekOf describe blocks above ...

describe("updateWeeklySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds $set with correct day index for triggered, skipped, and missing sites", async () => {
    await updateWeeklySummary({
      allSiteDomains: ["site-a", "site-b", "site-c"],
      siteResults: [{ domain: "site-a", articlesRequested: 2, articlesCreated: 2 }],
      skipped: [{ domain: "site-b", reason: "not a preferred day" }],
      timezone: "UTC",
      now: new Date("2026-06-15T12:00:00Z"), // Monday = index 1
    });

    expect(mockCollection).toHaveBeenCalledWith("weekly_summaries");
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);

    const [filter, update, options] = mockUpdateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: "2026-06-14" }); // Sunday of that week
    expect(options).toEqual({ upsert: true });

    // Check $set contains all three sites at index 1 (Monday)
    const $set = update.$set;
    expect($set["sites.site-a.1"]).toEqual({ expected: 2, created: 2 });
    expect($set["sites.site-b.1"]).toEqual({ expected: 0, created: 0 });
    expect($set["sites.site-c.1"]).toEqual({ expected: 0, created: 0 }); // not in results or skipped
    expect($set.updatedAt).toBeInstanceOf(Date);
  });

  it("does not throw on MongoDB error (failure-isolated)", async () => {
    mockUpdateOne.mockRejectedValueOnce(new Error("Mongo down"));
    await expect(
      updateWeeklySummary({
        allSiteDomains: ["site-a"],
        siteResults: [{ domain: "site-a", articlesRequested: 1, articlesCreated: 1 }],
        skipped: [],
        timezone: "UTC",
        now: new Date("2026-06-15T12:00:00Z"),
      }),
    ).resolves.toBeUndefined();
  });
});
```

Note: The module-level mock setup from Step 1 already includes `vi` and `beforeEach` imports and covers `updateOne`, `findOne`, and `find` — no additional mock changes needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: FAIL — `updateWeeklySummary` not exported.

- [ ] **Step 3: Implement `updateWeeklySummary()`**

Add to `services/content-pipeline/src/stats/weekly-summary.ts`:

```typescript
export interface WeeklySummaryInput {
  allSiteDomains: string[];
  siteResults: Array<{
    domain: string;
    articlesRequested: number;
    articlesCreated: number;
  }>;
  skipped: Array<{ domain: string; reason: string }>;
  timezone: string;
  now?: Date; // injectable for testing
}

/**
 * Upsert the weekly summary document for the current week.
 * Sets today's day-cell for every site in allSiteDomains.
 *
 * Failure-isolated — catches and logs errors, never throws.
 */
export async function updateWeeklySummary(input: WeeklySummaryInput): Promise<void> {
  try {
    const { allSiteDomains, siteResults, skipped, timezone, now } = input;
    const { dayIndex, weekOf } = getDayIndexAndWeekOf(timezone, now);

    // Build lookup maps for O(1) access
    const resultMap = new Map(siteResults.map((r) => [r.domain, r]));
    const skippedSet = new Set(skipped.map((s) => s.domain));

    // Build $set for all sites
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    for (const domain of allSiteDomains) {
      const result = resultMap.get(domain);
      if (result) {
        $set[`sites.${domain}.${dayIndex}`] = {
          expected: result.articlesRequested,
          created: result.articlesCreated,
        };
      } else {
        // Skipped or not processed — 0/0
        $set[`sites.${domain}.${dayIndex}`] = { expected: 0, created: 0 };
      }
    }

    const db = await getMongoDb();
    await db.collection(COLLECTIONS.weeklySummaries).updateOne(
      { _id: weekOf as any },
      { $set },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] updateWeeklySummary failed (non-fatal): ${msg}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/stats/weekly-summary.ts services/content-pipeline/src/__tests__/weekly-summary.test.ts
git commit -m "feat(stats): implement updateWeeklySummary with failure isolation"
```

---

## Task 4: Implement `getWeeklySummary()` and `decrementReviewCount()` with tests

**Files:**
- Modify: `services/content-pipeline/src/stats/weekly-summary.ts`
- Test: `services/content-pipeline/src/__tests__/weekly-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the test file. The module-level mock already includes `mockFindOne`, `mockFind`, and `mockUpdateOne` — just add the imports and new `describe` blocks:

```typescript
// Add these imports at the top alongside existing ones:
import { getWeeklySummary, decrementReviewCount } from "../stats/weekly-summary.js";

// Add these describe blocks after the updateWeeklySummary tests:

describe("getWeeklySummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns sites from weekly_summaries merged with review_counts", async () => {
    // Mock weekly_summaries findOne
    mockFindOne.mockResolvedValueOnce({
      _id: "2026-06-14",
      sites: {
        "site-a": [
          { expected: 0, created: 0 },
          { expected: 2, created: 2 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
        ],
      },
      updatedAt: new Date(),
    });
    // Mock review_counts find
    mockFind.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ _id: "site-a", count: 3 }]),
    });

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.weekOf).toBe("2026-06-14");
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]!.domain).toBe("site-a");
    expect(result.sites[0]!.needReview).toBe(3);
    expect(result.sites[0]!.days[1]).toEqual({ expected: 2, created: 2 });
  });

  it("returns empty sites array when no document exists", async () => {
    mockFindOne.mockResolvedValueOnce(null);
    mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) });

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.sites).toEqual([]);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("floors negative review counts to 0", async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: "2026-06-14",
      sites: { "site-a": Array(7).fill({ expected: 0, created: 0 }) },
    });
    mockFind.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ _id: "site-a", count: -2 }]),
    });

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.sites[0]!.needReview).toBe(0);
  });
});

describe("decrementReviewCount", () => {
  it("calls updateOne with $inc negative count", async () => {
    await decrementReviewCount("site-a", 3);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "site-a" },
      { $inc: { count: -3 }, $set: { updatedAt: expect.any(Date) } },
      { upsert: true },
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement `getWeeklySummary()` and `decrementReviewCount()`**

Add to `services/content-pipeline/src/stats/weekly-summary.ts`:

```typescript
export interface SchedulerSummaryResponse {
  weekOf: string;
  timezone: string;
  days: string[];
  sites: Array<{
    domain: string;
    days: DayCell[];
    needReview: number;
  }>;
}

const EMPTY_WEEK: DayCell[] = Array.from({ length: 7 }, () => ({ expected: 0, created: 0 }));
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Read the weekly summary for the current week, merged with review counts.
 */
export async function getWeeklySummary(
  timezone: string,
  now: Date = new Date(),
): Promise<SchedulerSummaryResponse> {
  const { weekOf } = getDayIndexAndWeekOf(timezone, now);
  const db = await getMongoDb();

  const [weekDoc, reviewDocs] = await Promise.all([
    db.collection(COLLECTIONS.weeklySummaries).findOne({ _id: weekOf as any }),
    db.collection(COLLECTIONS.reviewCounts).find({}).toArray(),
  ]);

  const reviewMap = new Map(
    reviewDocs.map((d) => [d._id as string, Math.max(0, (d as any).count ?? 0)]),
  );

  const sitesMap = (weekDoc as any)?.sites as Record<string, DayCell[]> | undefined;
  if (!sitesMap) {
    return { weekOf, timezone, days: DAY_LABELS, sites: [] };
  }

  const sites = Object.entries(sitesMap)
    .map(([domain, days]) => ({
      domain,
      days: days.length === 7 ? days : EMPTY_WEEK,
      needReview: reviewMap.get(domain) ?? 0,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return { weekOf, timezone, days: DAY_LABELS, sites };
}

/**
 * Decrement the review count for a site. Used by dashboard after
 * approving or rejecting articles.
 *
 * Failure-isolated — catches and logs errors, never throws.
 */
export async function decrementReviewCount(domain: string, count: number): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.reviewCounts).updateOne(
      { _id: domain as any },
      { $inc: { count: -count }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] decrementReviewCount failed (non-fatal): ${msg}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/weekly-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/stats/weekly-summary.ts services/content-pipeline/src/__tests__/weekly-summary.test.ts
git commit -m "feat(stats): implement getWeeklySummary and decrementReviewCount"
```

---

## Task 5: Add review count increment to `recordGeneration()`

**Files:**
- Modify: `services/content-pipeline/src/stats/recorder.ts:91-153`

- [ ] **Step 1: Add the increment logic**

In `services/content-pipeline/src/stats/recorder.ts`, inside the `recordGeneration()` function's try block, after the `site_stats` upsert (after line 148, before the catch on line 149), add:

```typescript
    // 4. Increment review_counts for articles flagged for review
    const reviewCount = result.results.filter(
      (r) => r.status === "created" && r.articleStatus === "review",
    ).length;
    if (reviewCount > 0) {
      await db.collection(COLLECTIONS.reviewCounts).updateOne(
        { _id: event.siteDomain as any },
        { $inc: { count: reviewCount }, $set: { updatedAt: event.finishedAt } },
        { upsert: true },
      );
    }
```

Note: `COLLECTIONS.reviewCounts` will be available after Task 1. The `result.results` entries have `articleStatus?: "published" | "review"` (defined at line 122 of `agent.ts`).

- [ ] **Step 2: Run existing tests to ensure nothing breaks**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/stats/recorder.ts
git commit -m "feat(stats): increment review_counts in recordGeneration"
```

---

## Task 6: Expand `SchedulerRunData.enqueuedDomains` type

**Files:**
- Modify: `services/content-pipeline/src/queue/types.ts:16-23`
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts:68-107` (createSchedulerFlow)
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts:244-307` (processSchedulerRun — child result mapping)

- [ ] **Step 1: Update the type**

In `services/content-pipeline/src/queue/types.ts`, change line 21:

```typescript
// Before:
  /** Domains that were enqueued as child generate jobs. */
  enqueuedDomains: string[];

// After:
  /** Domains that were enqueued as child generate jobs, with expected article count. */
  enqueuedDomains: Array<{ domain: string; count: number }>;
```

- [ ] **Step 2: Update `createSchedulerFlow()` to populate the new shape**

In `services/content-pipeline/src/queue/scheduler-flow.ts`, in `createSchedulerFlow()` (~line 97), change:

```typescript
// Before:
      enqueuedDomains: sites.map((s) => s.domain),

// After:
      enqueuedDomains: sites.map((s) => ({ domain: s.domain, count: s.count })),
```

- [ ] **Step 3: Update `processSchedulerRun()` to use new shape**

In `processSchedulerRun()`, where failed children are recorded (~lines 295-307), change:

```typescript
// Before:
  const { enqueuedDomains } = job.data;
  const completedDomains = new Set(sites.map((s) => s.domain));
  for (const domain of enqueuedDomains) {
    if (!completedDomains.has(domain)) {
      sites.push({
        domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: 0,
        message: "Child job failed (all retries exhausted)",
      });
    }
  }

// After:
  const { enqueuedDomains } = job.data;
  const completedDomains = new Set(sites.map((s) => s.domain));
  for (const entry of enqueuedDomains) {
    if (!completedDomains.has(entry.domain)) {
      sites.push({
        domain: entry.domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: entry.count,
        message: "Child job failed (all retries exhausted)",
      });
    }
  }
```

- [ ] **Step 4: Run existing tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: All tests pass. The `scheduler-flow.test.ts` tests may need minor updates if they reference `enqueuedDomains` as `string[]` — update them to use the new shape.

- [ ] **Step 5: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/queue/types.ts services/content-pipeline/src/queue/scheduler-flow.ts
git commit -m "refactor(queue): expand enqueuedDomains to carry per-site article count"
```

---

## Task 7: Wire `updateWeeklySummary()` into both scheduler paths

**Files:**
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts:336-392` (processSchedulerRun, after history write)
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts:521-523` (after history.finalize)

- [ ] **Step 1: Wire into the queue path (processSchedulerRun)**

In `services/content-pipeline/src/queue/scheduler-flow.ts`:

Add import at the top:

```typescript
import { updateWeeklySummary } from "../stats/weekly-summary.js";
```

After the history write section (after line 336 — after `console.log("[scheduler-run] History written:...")`), **move** the existing `listActiveSites` call from line 343 to before the weekly summary update. Currently the code at ~line 343 reads:

```typescript
  // --- Auto-publish ---
  const activeSites = await listActiveSites(octokit, config.networkRepo);
```

Move that line up to just after the history log, then add the weekly summary call, then the auto-publish section uses the same `activeSites` variable. The result should be:

```typescript
  // Fetch all active sites (used by weekly summary + auto-publish)
  const activeSites = await listActiveSites(octokit, config.networkRepo);

  // Update weekly summary in MongoDB
  await updateWeeklySummary({
    allSiteDomains: activeSites.map((s) => s.domain),
    siteResults: sites.map((s) => ({
      domain: s.domain,
      articlesRequested: s.articlesRequested,
      articlesCreated: s.articlesCreated,
    })),
    skipped,
    timezone,
  });

  // --- Auto-publish --- (remove the old `const activeSites = ...` line here)
```

- [ ] **Step 2: Wire into the direct-execution fallback**

In `services/content-pipeline/src/agents/scheduled-publisher/index.ts`:

Add import at the top:

```typescript
import { updateWeeklySummary } from "../../stats/weekly-summary.js";
```

After line 521 (`await history.finalize();`), before the `return result;` (line 523), add:

```typescript
  // Update weekly summary in MongoDB
  const allSiteDomains = activeSites.map((s) => s.domain);
  await updateWeeklySummary({
    allSiteDomains,
    siteResults: siteOutcomes
      .filter((o): o is Extract<SiteOutcome, { kind: "triggered" }> => o.kind === "triggered")
      .map((o) => ({
        domain: o.domain,
        articlesRequested: o.siteResult.articlesRequested,
        articlesCreated: o.siteResult.articlesCreated,
      })),
    skipped: result.skipped,
    timezone: schedCfg.timezone,
  });
```

- [ ] **Step 3: Run tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: PASS

- [ ] **Step 4: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/queue/scheduler-flow.ts services/content-pipeline/src/agents/scheduled-publisher/index.ts
git commit -m "feat(scheduler): wire updateWeeklySummary into both scheduler paths"
```

---

## Task 8: Add HTTP endpoints (`GET /scheduler-summary`, `POST /review-counts/decrement`)

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`

- [ ] **Step 1: Add the `GET /scheduler-summary` handler**

In `services/content-pipeline/src/agents/content-generation/index.ts`, add import at the top (near the other stats imports around lines 58-62):

```typescript
import { getWeeklySummary, decrementReviewCount } from "../../stats/weekly-summary.js";
```

Then add the route handler. Place it after the `/run-alerts` block (~line 819) and before the `/r2-usage` block (~line 843). Follow the existing pattern:

Also add this import at the top for reading the scheduler timezone:

```typescript
import { getSchedulerTimezone } from "../../stats/weekly-summary.js";
```

Note: `getSchedulerTimezone` is a new helper (add it to `weekly-summary.ts` in this task) that reads `scheduler/config.yaml` from Git and returns the timezone string, falling back to `"EST"`. This avoids importing the private `readSchedulerConfig` from the scheduled-publisher. Add to `weekly-summary.ts`:

```typescript
import { parse as parseYaml } from "yaml";
import { createOctokit, readFile } from "../lib/github.js";
import type { AgentConfig } from "../lib/config.js";

const SCHEDULER_CONFIG_PATH = "scheduler/config.yaml";

/** Read the scheduler timezone from the network repo. Falls back to "EST". */
export async function getSchedulerTimezone(config: AgentConfig): Promise<string> {
  try {
    const octokit = createOctokit(config.github);
    const raw = await readFile(octokit, config.networkRepo, SCHEDULER_CONFIG_PATH);
    const parsed = parseYaml(raw) as { timezone?: string } | null;
    return parsed?.timezone ?? "EST";
  } catch {
    return "EST";
  }
}
```

Then in the handler:

```typescript
  // Scheduler weekly summary — GET /scheduler-summary
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/scheduler-summary") {
      try {
        const timezone = await getSchedulerTimezone(config);
        const summary = await getWeeklySummary(timezone);
        sendJson(res, 200, summary as unknown as Record<string, unknown>);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: message });
      }
      return;
    }
  }
```

- [ ] **Step 2: Add the `POST /review-counts/decrement` handler**

Add right after the scheduler-summary handler:

```typescript
  // Review count decrement — POST /review-counts/decrement
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/review-counts/decrement") {
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { status: "error", message: "Payload too large" });
      return;
    }

    let payload: { domain?: string; count?: number };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
      return;
    }

    const { domain, count } = payload;
    if (!domain || typeof count !== "number" || count <= 0) {
      sendJson(res, 400, { status: "error", message: "domain (string) and count (positive number) required" });
      return;
    }

    await decrementReviewCount(domain, count);
    sendJson(res, 200, { status: "ok" });
    return;
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(api): add GET /scheduler-summary and POST /review-counts/decrement"
```

---

## Task 9: Dashboard proxy route

**Files:**
- Create: `services/dashboard/src/app/api/scheduler-summary/route.ts`

- [ ] **Step 1: Create the proxy route**

Create `services/dashboard/src/app/api/scheduler-summary/route.ts`:

```typescript
import { NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function GET(): Promise<NextResponse> {
  try {
    const url = `${getAgentUrl()}/scheduler-summary`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `Failed to fetch scheduler summary: ${resp.status} ${text}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch scheduler summary: ${message}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/scheduler-summary/route.ts
git commit -m "feat(dashboard): add /api/scheduler-summary proxy route"
```

---

## Task 10: Dashboard UI page

**Files:**
- Create: `services/dashboard/src/app/scheduler-summary/page.tsx`

- [ ] **Step 1: Create the page component**

Create `services/dashboard/src/app/scheduler-summary/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

interface DayCell {
  expected: number;
  created: number;
}

interface SiteSummary {
  domain: string;
  days: DayCell[];
  needReview: number;
}

interface SchedulerSummaryData {
  weekOf: string;
  timezone: string;
  days: string[];
  sites: SiteSummary[];
}

function formatWeekRange(weekOf: string): string {
  const sunday = new Date(weekOf + "T00:00:00Z");
  const saturday = new Date(sunday.getTime() + 6 * 86_400_000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(sunday)} – ${fmt.format(saturday)}`;
}

function cellColor(cell: DayCell): string {
  if (cell.expected === 0 && cell.created === 0) return "text-zinc-400 dark:text-zinc-600";
  if (cell.created === 0 && cell.expected > 0) return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950";
  if (cell.created > 0 && cell.created < cell.expected) return "text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950";
  return "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950";
}

function reviewColor(count: number): string {
  if (count === 0) return "text-zinc-400 dark:text-zinc-600";
  return "text-amber-600 dark:text-amber-400";
}

export default function SchedulerSummaryPage(): React.ReactElement {
  const [data, setData] = useState<SchedulerSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scheduler-summary")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<SchedulerSummaryData>;
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-zinc-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-4">Scheduler Summary</h1>
        <p className="text-red-600 dark:text-red-400">Failed to load: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Scheduler Summary</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Week of {formatWeekRange(data.weekOf)} ({data.timezone})
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-2 px-3 font-medium">Site</th>
              {DAY_SHORT.map((d) => (
                <th key={d} className="text-center py-2 px-2 font-medium w-16">{d}</th>
              ))}
              <th className="text-center py-2 px-3 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((site) => (
              <tr key={site.domain} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <td className="py-1.5 px-3 font-mono text-xs">{site.domain}</td>
                {site.days.map((cell, i) => (
                  <td key={i} className={`text-center py-1.5 px-2 font-mono text-xs ${cellColor(cell)}`}>
                    {cell.created}/{cell.expected}
                  </td>
                ))}
                <td className={`text-center py-1.5 px-3 font-mono text-xs font-medium ${reviewColor(site.needReview)}`}>
                  {site.needReview}
                </td>
              </tr>
            ))}
            {data.sites.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-zinc-400">
                  No data yet — scheduler hasn't run this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/scheduler-summary/page.tsx
git commit -m "feat(dashboard): add /scheduler-summary page with color-coded weekly grid"
```

---

## Task 11: Add "Weekly Summary" link to Scheduler Log page

**Files:**
- Modify: `services/dashboard/src/app/settings/scheduler-log/page.tsx`

- [ ] **Step 1: Add a link**

In `services/dashboard/src/app/settings/scheduler-log/page.tsx`, in the main page component (starts around line 138), add a link in the header area. Find the `<h1>` tag and add a link next to it:

```tsx
import Link from "next/link";
```

Find the heading section and add:

```tsx
<div className="flex items-center justify-between mb-4">
  <h1 className="text-xl font-semibold">Scheduler Log</h1>
  <Link
    href="/scheduler-summary"
    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
  >
    Weekly Summary →
  </Link>
</div>
```

Replace the existing standalone `<h1>` with this wrapper `div`.

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/settings/scheduler-log/page.tsx
git commit -m "feat(dashboard): add Weekly Summary link to scheduler log page"
```

---

## Task 12: Wire dashboard review decrement calls

**Files:**
- Modify: `services/dashboard/src/actions/review.ts:71-160`

- [ ] **Step 1: Add the decrement calls**

In `services/dashboard/src/actions/review.ts`, add a helper function before `applyReviewDecisions()`:

```typescript
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";

function getAgentUrl(): string {
  if (process.env.NODE_ENV === "development" && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}
```

Then at the end of `applyReviewDecisions()`, after the `for...of byDomain` loop (after line 153), before `revalidatePath("/review")` (line 155), add:

```typescript
  // Fire-and-forget: decrement review counts in MongoDB
  for (const [domain, { approved, rejected }] of byDomain) {
    const decrementCount = approved.length + rejected.length;
    if (decrementCount > 0) {
      fetch(`${getAgentUrl()}/review-counts/decrement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, count: decrementCount }),
        signal: AbortSignal.timeout(5_000),
      }).catch((err) =>
        console.warn(`[review] Failed to update review count for ${domain}:`, err),
      );
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/actions/review.ts
git commit -m "feat(dashboard): fire-and-forget review count decrements on approve/reject"
```

---

## Task 13: Run full test suite and typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run content-pipeline tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run content-pipeline typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Run dashboard typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Run full monorepo typecheck**

Run: `pnpm typecheck`
Expected: No errors.
