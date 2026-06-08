# Ops Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard homepage with an operational console showing filter cards, cost strip, sortable table, and expandable site detail panels — all powered by the existing Ops Console API with targeted extensions.

**Architecture:** Server component fetches dashboard index + 5 API endpoints in parallel for first paint. A single `"use client"` `OpsDashboard` component receives initial data as props and polls 5 endpoints every 60s. All data merging, tier computation, and card filtering happens client-side in `ops-helpers.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, Vitest, Tailwind CSS v4, MongoDB (via content-pipeline), MongoMemoryServer (tests).

**Spec:** `docs/superpowers/specs/2026-06-08-ops-dashboard-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `services/content-pipeline/src/stats/daily.ts` | `countTodayCreated(domain, now)` — MongoDB query for articles created today |
| `services/content-pipeline/src/stats/__tests__/daily.test.ts` | Tests for daily stats |
| `services/content-pipeline/src/costs/windows.ts` | `extendWindows(domain, now)` — adds `todayUsd`, `allTimeTokens`, `avgPerArticle7dUsd`, `created7d` |
| `services/content-pipeline/src/costs/__tests__/windows.test.ts` | Tests for extended cost windows |
| `services/content-pipeline/src/stats/r2-tally.ts` | `incrementR2Tally(bytes, count)`, `getR2Usage()` — R2 running tally |
| `services/content-pipeline/src/stats/__tests__/r2-tally.test.ts` | Tests for R2 tally |
| `services/content-pipeline/src/stats/backfill-r2.ts` | One-time R2 scan → MongoDB tally |
| `services/dashboard/src/app/api/r2-usage/route.ts` | `GET /api/r2-usage` — proxies R2 tally from content-pipeline |
| `services/dashboard/src/app/api/sites/reseed/route.ts` | `POST /api/sites/reseed` — proxies to content-pipeline `/seed-kv` |
| `services/dashboard/src/lib/ops-helpers.ts` | `mergeOpsRows()`, `computeTier()`, card predicates, cost strip math |
| `services/dashboard/src/lib/__tests__/ops-helpers.test.ts` | Tests for merge, tier, predicates, cost formulas |
| `services/dashboard/src/components/ops/OpsDashboard.tsx` | Main `"use client"` component — polling, state, merge |
| `services/dashboard/src/components/ops/FilterCards.tsx` | 7 clickable metric cards |
| `services/dashboard/src/components/ops/CostStrip.tsx` | Single-line cost/usage bar |
| `services/dashboard/src/components/ops/FilterBar.tsx` | Search + status/category dropdowns |
| `services/dashboard/src/components/ops/OpsTable.tsx` | Table with header, rows, pagination |
| `services/dashboard/src/components/ops/OpsTableRow.tsx` | Single row with expand toggle |
| `services/dashboard/src/components/ops/SiteDetailPanel.tsx` | 5-panel detail + action buttons |

### Modified Files

| File | Change |
|------|--------|
| `services/content-pipeline/src/stats/repo.ts` | Import and call `countTodayCreated()`, add `today` to `SiteStatsResponse` |
| `services/content-pipeline/src/costs/repo.ts` | Import and call `extendWindows()`, add fields to `SiteCostsResponse` |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Register `/r2-usage` and `/seed-kv` routes |
| `services/content-pipeline/src/agents/content-generation/n8n-image.ts` | Call `incrementR2Tally()` after R2 upload |
| `services/dashboard/src/lib/site-stats.ts` | Add `today.expected` computation in `enrichSite()` |
| `services/dashboard/src/app/api/articles/upload/route.ts` | Call R2 tally increment after upload |
| `services/dashboard/src/app/page.tsx` | Replace with server-fetch + `<OpsDashboard>` |

---

## Phase 1: API Extensions (Content Pipeline)

### Task 1: Daily article count for site-stats

**Files:**
- Create: `services/content-pipeline/src/stats/daily.ts`
- Create: `services/content-pipeline/src/stats/__tests__/daily.test.ts`
- Modify: `services/content-pipeline/src/stats/repo.ts:5-13` (SiteStatsResponse type)
- Modify: `services/content-pipeline/src/stats/repo.ts:79-130` (getSiteStats function)

- [ ] **Step 1: Write the failing test**

Create `services/content-pipeline/src/stats/__tests__/daily.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { countTodayCreated } from "../daily.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer;
let originalUrl: string | undefined;

beforeAll(async () => {
  originalUrl = process.env.MONGODB_URL;
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});
afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.MONGODB_URL = originalUrl;
});
beforeEach(async () => {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.generationEvents).deleteMany({});
});

describe("countTodayCreated", () => {
  it("returns 0 when no events exist", async () => {
    const result = await countTodayCreated("travelswire", new Date("2026-06-08T14:00:00Z"));
    expect(result).toBe(0);
  });

  it("counts only today's published articles for the given domain", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.generationEvents);
    const today = new Date("2026-06-08T14:00:00Z");
    const yesterday = new Date("2026-06-07T14:00:00Z");

    await coll.insertMany([
      { siteDomain: "travelswire", finishedAt: today, articlesCreated: 3, status: "success" },
      { siteDomain: "travelswire", finishedAt: yesterday, articlesCreated: 2, status: "success" },
      { siteDomain: "wineoceans", finishedAt: today, articlesCreated: 1, status: "success" },
      { siteDomain: "travelswire", finishedAt: today, articlesCreated: 0, status: "error" },
    ]);

    const result = await countTodayCreated("travelswire", today);
    expect(result).toBe(3);
  });

  it("handles events at midnight boundary correctly", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.generationEvents);
    // Event at 23:59 yesterday
    await coll.insertOne({
      siteDomain: "travelswire",
      finishedAt: new Date("2026-06-07T23:59:59Z"),
      articlesCreated: 5,
      status: "success",
    });
    // Event at 00:00 today
    await coll.insertOne({
      siteDomain: "travelswire",
      finishedAt: new Date("2026-06-08T00:00:00Z"),
      articlesCreated: 2,
      status: "success",
    });

    const result = await countTodayCreated("travelswire", new Date("2026-06-08T12:00:00Z"));
    expect(result).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/daily.test.ts`
Expected: FAIL — `Cannot find module '../daily.js'`

- [ ] **Step 3: Write implementation**

Create `services/content-pipeline/src/stats/daily.ts`:

```typescript
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";

/**
 * Count articles created today (UTC) for a single site.
 * Sums `articlesCreated` from generation_events where status=success
 * and finishedAt >= start of today UTC.
 */
export async function countTodayCreated(
  domain: string,
  now: Date,
): Promise<number> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const db = await getMongoDb();
  const coll = db.collection(COLLECTIONS.generationEvents);

  const pipeline = [
    {
      $match: {
        siteDomain: domain,
        finishedAt: { $gte: startOfDay },
        status: "success",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$articlesCreated" },
      },
    },
  ];

  const results = await coll.aggregate(pipeline).toArray();
  return results[0]?.total ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/daily.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into getSiteStats**

Modify `services/content-pipeline/src/stats/repo.ts`:

Add import at the top:
```typescript
import { countTodayCreated } from "./daily.js";
```

Extend the `SiteStatsResponse` interface (around line 5-13) — add:
```typescript
  today: { created: number };
```

In `getSiteStats()` (around line 79-130), after the existing aggregation queries, add:
```typescript
  const todayCreated = await countTodayCreated(domain, now);
```

And include in the return object:
```typescript
  today: { created: todayCreated },
```

- [ ] **Step 6: Run existing stats tests to verify no regression**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/`
Expected: All existing + new tests PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/stats/daily.ts \
      services/content-pipeline/src/stats/__tests__/daily.test.ts \
      services/content-pipeline/src/stats/repo.ts
git commit -m "feat(content-pipeline): add today.created to site-stats response"
```

---

### Task 2: Extended cost windows

**Files:**
- Create: `services/content-pipeline/src/costs/windows.ts`
- Create: `services/content-pipeline/src/costs/__tests__/windows.test.ts`
- Modify: `services/content-pipeline/src/costs/repo.ts:14-19` (SiteCostsResponse type)
- Modify: `services/content-pipeline/src/costs/repo.ts:73-98` (getSiteCosts function)

- [ ] **Step 1: Write the failing test**

Create `services/content-pipeline/src/costs/__tests__/windows.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { extendWindows } from "../windows.js";
import { COST_COLLECTIONS } from "../types.js";
import { COLLECTIONS as STATS_COLLECTIONS } from "../../stats/types.js";

let mem: MongoMemoryServer;
let originalUrl: string | undefined;

beforeAll(async () => {
  originalUrl = process.env.MONGODB_URL;
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});
afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.MONGODB_URL = originalUrl;
});
beforeEach(async () => {
  const db = await getMongoDb();
  await db.collection(COST_COLLECTIONS.costEvents).deleteMany({});
  await db.collection(STATS_COLLECTIONS.generationEvents).deleteMany({});
});

describe("extendWindows", () => {
  const now = new Date("2026-06-08T14:00:00Z");

  it("returns zeroes when no events exist", async () => {
    const result = await extendWindows("travelswire", now);
    expect(result).toEqual({
      todayUsd: 0,
      allTimeTokens: { input: 0, output: 0 },
      avgPerArticle7dUsd: 0,
      created7d: 0,
    });
  });

  it("sums todayUsd from cost_events on the same UTC day", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COST_COLLECTIONS.costEvents);
    await coll.insertMany([
      { siteDomain: "travelswire", at: now, costUsd: 0.50, tokensInput: 1000, tokensOutput: 500 },
      { siteDomain: "travelswire", at: now, costUsd: 0.30, tokensInput: 800, tokensOutput: 200 },
      { siteDomain: "travelswire", at: new Date("2026-06-07T14:00:00Z"), costUsd: 1.00, tokensInput: 5000, tokensOutput: 2000 },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.todayUsd).toBeCloseTo(0.80, 2);
  });

  it("sums allTimeTokens across all cost_events", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COST_COLLECTIONS.costEvents);
    await coll.insertMany([
      { siteDomain: "travelswire", at: now, costUsd: 0.50, tokensInput: 1000, tokensOutput: 500 },
      { siteDomain: "travelswire", at: new Date("2026-01-01T00:00:00Z"), costUsd: 2.00, tokensInput: 4000, tokensOutput: 1500 },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.allTimeTokens).toEqual({ input: 5000, output: 2000 });
  });

  it("computes avgPerArticle7dUsd and created7d correctly", async () => {
    const db = await getMongoDb();
    const costColl = db.collection(COST_COLLECTIONS.costEvents);
    const genColl = db.collection(STATS_COLLECTIONS.generationEvents);
    const threeDaysAgo = new Date("2026-06-05T14:00:00Z");

    await costColl.insertMany([
      { siteDomain: "travelswire", at: threeDaysAgo, costUsd: 1.00, tokensInput: 1000, tokensOutput: 500 },
      { siteDomain: "travelswire", at: now, costUsd: 0.50, tokensInput: 800, tokensOutput: 200 },
    ]);
    await genColl.insertMany([
      { siteDomain: "travelswire", finishedAt: threeDaysAgo, articlesCreated: 3, status: "success" },
      { siteDomain: "travelswire", finishedAt: now, articlesCreated: 2, status: "success" },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.created7d).toBe(5);
    expect(result.avgPerArticle7dUsd).toBeCloseTo(0.30, 2); // 1.50 / 5
  });

  it("returns 0 avgPerArticle7dUsd when no articles created", async () => {
    const db = await getMongoDb();
    await db.collection(COST_COLLECTIONS.costEvents).insertOne({
      siteDomain: "travelswire", at: now, costUsd: 1.00, tokensInput: 1000, tokensOutput: 500,
    });

    const result = await extendWindows("travelswire", now);
    expect(result.avgPerArticle7dUsd).toBe(0);
    expect(result.created7d).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/costs/__tests__/windows.test.ts`
Expected: FAIL — `Cannot find module '../windows.js'`

- [ ] **Step 3: Write implementation**

Create `services/content-pipeline/src/costs/windows.ts`:

```typescript
import { getMongoDb } from "../lib/mongo.js";
import { COST_COLLECTIONS } from "./types.js";
import { COLLECTIONS as STATS_COLLECTIONS } from "../stats/types.js";

export interface ExtendedWindows {
  todayUsd: number;
  allTimeTokens: { input: number; output: number };
  avgPerArticle7dUsd: number;
  created7d: number;
}

export async function extendWindows(
  domain: string,
  now: Date,
): Promise<ExtendedWindows> {
  const db = await getMongoDb();
  const costColl = db.collection(COST_COLLECTIONS.costEvents);
  const genColl = db.collection(STATS_COLLECTIONS.generationEvents);

  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All three aggregations in parallel
  const [todayResult, allTimeResult, cost7dResult, created7dResult] =
    await Promise.all([
      // todayUsd
      costColl
        .aggregate([
          { $match: { siteDomain: domain, at: { $gte: startOfDay } } },
          { $group: { _id: null, total: { $sum: "$costUsd" } } },
        ])
        .toArray(),

      // allTimeTokens
      costColl
        .aggregate([
          { $match: { siteDomain: domain } },
          {
            $group: {
              _id: null,
              input: { $sum: "$tokensInput" },
              output: { $sum: "$tokensOutput" },
            },
          },
        ])
        .toArray(),

      // cost in last 7 days (for avgPerArticle)
      costColl
        .aggregate([
          { $match: { siteDomain: domain, at: { $gte: sevenDaysAgo } } },
          { $group: { _id: null, total: { $sum: "$costUsd" } } },
        ])
        .toArray(),

      // articles created in last 7 days
      genColl
        .aggregate([
          {
            $match: {
              siteDomain: domain,
              finishedAt: { $gte: sevenDaysAgo },
              status: "success",
            },
          },
          { $group: { _id: null, total: { $sum: "$articlesCreated" } } },
        ])
        .toArray(),
    ]);

  const todayUsd = todayResult[0]?.total ?? 0;
  const allTimeTokens = {
    input: allTimeResult[0]?.input ?? 0,
    output: allTimeResult[0]?.output ?? 0,
  };
  const cost7d = cost7dResult[0]?.total ?? 0;
  const created7d = created7dResult[0]?.total ?? 0;
  const avgPerArticle7dUsd = created7d > 0 ? cost7d / created7d : 0;

  return { todayUsd, allTimeTokens, avgPerArticle7dUsd, created7d };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/costs/__tests__/windows.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire into getSiteCosts**

Modify `services/content-pipeline/src/costs/repo.ts`:

Add import:
```typescript
import { extendWindows, type ExtendedWindows } from "./windows.js";
```

Extend `SiteCostsResponse` interface (line 14-19) — change `windows` to:
```typescript
  windows: {
    thisWeekUsd: number;
    last30dUsd: number;
    todayUsd: number;
    allTimeTokens: { input: number; output: number };
    avgPerArticle7dUsd: number;
    created7d: number;
  };
```

In `getSiteCosts()` (line 73-98), after existing window computation, add:
```typescript
  const extended = await extendWindows(domain, now);
```

Merge into the return's `windows` object:
```typescript
  windows: {
    thisWeekUsd,
    last30dUsd,
    ...extended,
  },
```

- [ ] **Step 6: Run existing cost tests**

Run: `cd services/content-pipeline && pnpm vitest run src/costs/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/costs/windows.ts \
      services/content-pipeline/src/costs/__tests__/windows.test.ts \
      services/content-pipeline/src/costs/repo.ts
git commit -m "feat(content-pipeline): add todayUsd, allTimeTokens, avgPerArticle7dUsd, created7d to site-costs"
```

---

### Task 3: R2 tally collection + endpoint

**Files:**
- Create: `services/content-pipeline/src/stats/r2-tally.ts`
- Create: `services/content-pipeline/src/stats/__tests__/r2-tally.test.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (add `/r2-usage` route)

- [ ] **Step 1: Write the failing test**

Create `services/content-pipeline/src/stats/__tests__/r2-tally.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { incrementR2Tally, getR2Usage, R2_COLLECTION } from "../r2-tally.js";

let mem: MongoMemoryServer;
let originalUrl: string | undefined;

beforeAll(async () => {
  originalUrl = process.env.MONGODB_URL;
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});
afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.MONGODB_URL = originalUrl;
});
beforeEach(async () => {
  const db = await getMongoDb();
  await db.collection(R2_COLLECTION).deleteMany({});
});

describe("incrementR2Tally", () => {
  it("creates tally document on first call", async () => {
    await incrementR2Tally(1024, 1);
    const usage = await getR2Usage();
    expect(usage.totalBytes).toBe(1024);
    expect(usage.totalImages).toBe(1);
  });

  it("increments existing tally", async () => {
    await incrementR2Tally(1000, 1);
    await incrementR2Tally(2000, 3);
    const usage = await getR2Usage();
    expect(usage.totalBytes).toBe(3000);
    expect(usage.totalImages).toBe(4);
  });
});

describe("getR2Usage", () => {
  it("returns zeroes when no tally exists", async () => {
    const usage = await getR2Usage();
    expect(usage).toEqual({
      totalBytes: 0,
      totalImages: 0,
      capacityPct: 0,
      lastUpdated: null,
    });
  });

  it("computes capacityPct from totalBytes", async () => {
    // 5GB of 10GB default capacity = 50%
    await incrementR2Tally(5 * 1024 * 1024 * 1024, 100);
    const usage = await getR2Usage();
    expect(usage.capacityPct).toBeCloseTo(50, 0);
    expect(usage.totalImages).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/r2-tally.test.ts`
Expected: FAIL — `Cannot find module '../r2-tally.js'`

- [ ] **Step 3: Write implementation**

Create `services/content-pipeline/src/stats/r2-tally.ts`:

```typescript
import { getMongoDb } from "../lib/mongo.js";

export const R2_COLLECTION = "r2_usage";
const TALLY_ID = "global";

// Default 10GB free tier. Override via R2_CAPACITY_BYTES env var.
const capacityBytes = Number(process.env.R2_CAPACITY_BYTES) || 10 * 1024 * 1024 * 1024;

export interface R2Usage {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

export async function incrementR2Tally(
  bytes: number,
  imageCount: number,
): Promise<void> {
  const db = await getMongoDb();
  await db.collection(R2_COLLECTION).updateOne(
    { _id: TALLY_ID },
    {
      $inc: { totalBytes: bytes, totalImages: imageCount },
      $set: { lastUpdated: new Date() },
    },
    { upsert: true },
  );
}

export async function getR2Usage(): Promise<R2Usage> {
  const db = await getMongoDb();
  const doc = await db.collection(R2_COLLECTION).findOne({ _id: TALLY_ID });

  if (!doc) {
    return { totalBytes: 0, totalImages: 0, capacityPct: 0, lastUpdated: null };
  }

  const totalBytes: number = doc.totalBytes ?? 0;
  const totalImages: number = doc.totalImages ?? 0;
  const capacityPct = (totalBytes / capacityBytes) * 100;
  const lastUpdated = doc.lastUpdated
    ? new Date(doc.lastUpdated).toISOString()
    : null;

  return { totalBytes, totalImages, capacityPct, lastUpdated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/r2-tally.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Register `/r2-usage` route in HTTP handler**

Modify `services/content-pipeline/src/agents/content-generation/index.ts`.

Add import near top:
```typescript
import { getR2Usage } from "../../stats/r2-tally.js";
```

Add route handler (near the existing `/attention` route, around line 804):
```typescript
  // GET /r2-usage
  if (req.method === "GET" && pathname === "/r2-usage") {
    try {
      const usage = await getR2Usage();
      return sendJson(res, 200, { status: "ok", ...usage });
    } catch (err) {
      return sendJson(res, 503, { status: "error", error: String(err) });
    }
  }
```

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/stats/r2-tally.ts \
      services/content-pipeline/src/stats/__tests__/r2-tally.test.ts \
      services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): add R2 tally collection and /r2-usage endpoint"
```

---

### Task 4: R2 tally increments at upload sites

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/n8n-image.ts:599` (after R2 upload)
- Modify: `services/dashboard/src/app/api/articles/upload/route.ts:123` (after R2 upload)

Note: `seed-kv.ts` uploads non-image assets via wrangler CLI (not the S3 API), and explicitly skips images. Since images are the R2 cost driver and seed-kv doesn't upload images, skip the seed-kv tally integration — it would add complexity for negligible accuracy gain.

- [ ] **Step 1: Add tally increment to content-pipeline image callback**

Modify `services/content-pipeline/src/agents/content-generation/n8n-image.ts`.

Add import near top:
```typescript
import { incrementR2Tally } from "../../stats/r2-tally.js";
```

In `processN8nImageResult()` (around line 599, after the `uploadToR2()` call succeeds), add:
```typescript
    // Increment R2 usage tally (fire-and-forget, non-blocking)
    incrementR2Tally(optimized.length, 1).catch((err) =>
      console.warn("[r2-tally] increment failed:", err),
    );
```

- [ ] **Step 2: Add tally increment to dashboard article upload**

Modify `services/dashboard/src/app/api/articles/upload/route.ts`.

This route runs in the dashboard (Next.js), not in the content-pipeline. The dashboard doesn't have direct MongoDB access for the R2 tally. Two options:

**Option chosen:** Call the content-pipeline's tally endpoint via HTTP (consistent with the proxy pattern).

Add helper at top of file:
```typescript
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return "http://localhost:5000";
  }
  return CONTENT_AGENT_URL;
}
```

After the successful R2 upload (around line 124, inside the `if (uploaded)` block), add:
```typescript
      // Increment R2 tally (fire-and-forget)
      fetch(`${getAgentUrl()}/r2-tally-increment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bytes: optimized.length, count: 1 }),
      }).catch(() => {/* non-blocking */});
```

- [ ] **Step 3: Register `/r2-tally-increment` route in content-pipeline**

Modify `services/content-pipeline/src/agents/content-generation/index.ts`.

Add import if not already present:
```typescript
import { incrementR2Tally } from "../../stats/r2-tally.js";
```

Add route handler:
```typescript
  // POST /r2-tally-increment
  if (req.method === "POST" && pathname === "/r2-tally-increment") {
    try {
      const body = await readBody(req);
      const { bytes, count } = JSON.parse(body);
      await incrementR2Tally(Number(bytes) || 0, Number(count) || 0);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err) });
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/n8n-image.ts \
      services/content-pipeline/src/agents/content-generation/index.ts \
      services/dashboard/src/app/api/articles/upload/route.ts
git commit -m "feat: increment R2 tally on image uploads (content-pipeline + dashboard)"
```

---

### Task 5: R2 backfill script

**Files:**
- Create: `services/content-pipeline/src/stats/backfill-r2.ts`

- [ ] **Step 1: Write the backfill script**

Create `services/content-pipeline/src/stats/backfill-r2.ts`:

```typescript
/**
 * One-time, idempotent backfill: scan all objects in the R2 bucket via S3 API
 * and write the totals to the r2_usage MongoDB collection.
 *
 * Usage: cd services/content-pipeline && pnpm tsx src/stats/backfill-r2.ts
 *
 * Requires: MONGODB_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID
 * Optional: R2_BUCKET (defaults to "atl-assets-prod")
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getMongoDb, closeMongo } from "../lib/mongo.js";
import { R2_COLLECTION } from "./r2-tally.js";

const BUCKET = process.env.R2_BUCKET ?? "atl-assets-prod";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

async function main(): Promise<void> {
  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    console.error("Missing R2 credentials. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });

  let totalBytes = 0;
  let totalImages = 0;
  let continuationToken: string | undefined;

  console.log(`[backfill-r2] Scanning bucket "${BUCKET}"...`);

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of resp.Contents ?? []) {
      totalBytes += obj.Size ?? 0;
      totalImages += 1;
    }

    continuationToken = resp.NextContinuationToken;
    console.log(`[backfill-r2] Scanned ${totalImages} objects so far...`);
  } while (continuationToken);

  console.log(`[backfill-r2] Total: ${totalImages} objects, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  const db = await getMongoDb();
  await db.collection(R2_COLLECTION).updateOne(
    { _id: "global" },
    { $set: { totalBytes, totalImages, lastUpdated: new Date() } },
    { upsert: true },
  );

  console.log("[backfill-r2] Tally written to MongoDB. Done.");
  await closeMongo();
}

main().catch((err) => {
  console.error("[backfill-r2] Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add services/content-pipeline/src/stats/backfill-r2.ts
git commit -m "feat(content-pipeline): add R2 backfill script"
```

---

## Phase 2: Dashboard API Routes

### Task 6: Extend enrichSite() with today.expected

**Files:**
- Modify: `services/dashboard/src/lib/site-stats.ts:392-410` (enrichSite function)
- Modify: `services/dashboard/src/lib/site-stats.ts:367-372` (EnrichedSiteStats type)
- Create: `services/dashboard/src/lib/__tests__/site-stats-today.test.ts` (focused test for today.expected)

- [ ] **Step 1: Write the failing test**

Create `services/dashboard/src/lib/__tests__/site-stats-today.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

/**
 * computeTodayExpected — pure function extracted for testability.
 * Returns articlesPerDay if today is a preferred day, else 0.
 */
import { computeTodayExpected } from "../site-stats";

describe("computeTodayExpected", () => {
  it("returns articlesPerDay when today is a preferred day", () => {
    // 2026-06-08 is a Monday
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, ["Monday", "Wednesday"], now)).toBe(3);
  });

  it("returns 0 when today is not a preferred day", () => {
    // 2026-06-08 is a Monday
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, ["Tuesday", "Thursday"], now)).toBe(0);
  });

  it("returns 0 when preferredDays is empty", () => {
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, [], now)).toBe(0);
  });

  it("handles Sunday correctly", () => {
    // 2026-06-14 is a Sunday
    const now = new Date("2026-06-14T14:00:00Z");
    expect(computeTodayExpected(2, ["Sunday"], now)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/site-stats-today.test.ts`
Expected: FAIL — `computeTodayExpected` is not exported

- [ ] **Step 3: Add computeTodayExpected to site-stats.ts**

Modify `services/dashboard/src/lib/site-stats.ts`.

Add the pure function (near `computeNextRun`, around line 293):

```typescript
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns articlesPerDay if today (UTC) is one of the preferredDays, else 0.
 */
export function computeTodayExpected(
  articlesPerDay: number,
  preferredDays: string[],
  now: Date,
): number {
  const todayName = DAY_NAMES[now.getUTCDay()];
  return preferredDays.includes(todayName) ? articlesPerDay : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/site-stats-today.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into enrichSite()**

Modify `services/dashboard/src/lib/site-stats.ts`.

Update the `EnrichedSiteStats` interface (line 367-372) to add:
```typescript
  today: { created: number; expected: number };
```

In `enrichSite()` (line 392-410), compute and add `today`:
```typescript
  const todayExpected = site.schedule
    ? computeTodayExpected(
        site.schedule.articlesPerDay,
        site.schedule.preferredDays,
        now,
      )
    : 0;

  return {
    ...site,
    ...aggregates,
    schedule: site.schedule
      ? { ...site.schedule, nextRun: computeNextRun(gate, site.schedule.preferredDays, now) }
      : null,
    today: { created: site.today?.created ?? 0, expected: todayExpected },
  };
```

Also update `emptyStats()` to include `today: { created: 0, expected: 0 }`.

- [ ] **Step 6: Run all site-stats tests**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/site-stats`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add services/dashboard/src/lib/site-stats.ts \
      services/dashboard/src/lib/__tests__/site-stats-today.test.ts
git commit -m "feat(dashboard): add today.expected computation to enrichSite"
```

---

### Task 7: New API routes — /api/r2-usage and /api/sites/reseed

**Files:**
- Create: `services/dashboard/src/app/api/r2-usage/route.ts`
- Create: `services/dashboard/src/app/api/sites/reseed/route.ts`

- [ ] **Step 1: Create /api/r2-usage route**

Create `services/dashboard/src/app/api/r2-usage/route.ts`:

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
    const resp = await fetch(`${getAgentUrl()}/r2-usage`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return NextResponse.json(
        { status: "error", error: `Upstream ${resp.status}` },
        { status: 502 },
      );
    }
    const data: Record<string, unknown> = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: String(err) },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Create /api/sites/reseed route**

Create `services/dashboard/src/app/api/sites/reseed/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { domain?: string };
    const domain = body.domain;
    if (!domain || typeof domain !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing required field: domain" },
        { status: 400 },
      );
    }

    const resp = await fetch(`${getAgentUrl()}/seed-kv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(120_000), // seed-kv can be slow
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { ok: false, error: `seed-kv failed: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, message: `KV re-seed triggered for ${domain}` });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: Register `/seed-kv` route in content-pipeline**

Modify `services/content-pipeline/src/agents/content-generation/index.ts`.

Add route handler (near `/r2-usage`):
```typescript
  // POST /seed-kv — trigger KV re-seed for a single site
  if (req.method === "POST" && pathname === "/seed-kv") {
    try {
      const body = await readBody(req);
      const { domain } = JSON.parse(body);
      if (!domain) {
        return sendJson(res, 400, { ok: false, error: "Missing domain" });
      }
      // Import and run seed-kv as a child process
      const { execSync } = await import("node:child_process");
      const cmd = `pnpm seed:kv ${domain}`;
      const cwd = path.resolve(__dirname, "../../../../packages/site-worker");
      execSync(cmd, { cwd, timeout: 120_000, stdio: "pipe" });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err) });
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/api/r2-usage/route.ts \
      services/dashboard/src/app/api/sites/reseed/route.ts \
      services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(dashboard): add /api/r2-usage and /api/sites/reseed routes"
```

---

## Phase 3: Dashboard Helpers

### Task 8: ops-helpers.ts — merge, tier, predicates, cost math

**Files:**
- Create: `services/dashboard/src/lib/ops-helpers.ts`
- Create: `services/dashboard/src/lib/__tests__/ops-helpers.test.ts`

- [ ] **Step 1: Write the test file**

Create `services/dashboard/src/lib/__tests__/ops-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  computeTier,
  cardPredicate,
  computeCostStrip,
  type OpsRow,
  type CardId,
} from "../ops-helpers";

// Minimal OpsRow factory for testing
function makeRow(overrides: Partial<OpsRow> = {}): OpsRow {
  return {
    domain: "test",
    status: "Live",
    customDomain: null,
    vertical: "",
    failedArticles7d: 0,
    failedArticles30d: 0,
    imageGenFailed7d: 0,
    imageGenFailed30d: 0,
    reviewCount: 0,
    generalImages: 0,
    todayCreated: 0,
    todayExpected: 0,
    thisWeekCreated: 0,
    schedule: null,
    recentArticles: [],
    lastAdded: null,
    lastFailedAt: null,
    uptime: { state: "ok", ok: true, statusCode: 200, responseTimeMs: 100 },
    sync: { state: "ok", ok: true, syncedAt: new Date().toISOString(), error: null },
    ssl: { state: "ok", status: "active", daysLeft: 90, expiresAt: null },
    tracking: { state: "ok", ga4: true, gtm: true, pixel: true },
    domainExpiry: { state: "ok", daysLeft: 300, expiresAt: null, autoRenew: true },
    alerts: [],
    tier: 4,
    ...overrides,
  };
}

describe("computeTier", () => {
  it("returns 0 for site down", () => {
    expect(computeTier(makeRow({ uptime: { state: "ok", ok: false, statusCode: 503, responseTimeMs: null } }))).toBe(0);
  });

  it("returns 1 for sync failed within 24h", () => {
    const recentSync = new Date(Date.now() - 3600_000).toISOString(); // 1h ago
    expect(computeTier(makeRow({ sync: { state: "ok", ok: false, syncedAt: recentSync, error: "fail" } }))).toBe(1);
  });

  it("returns 2 for high failed articles", () => {
    expect(computeTier(makeRow({ failedArticles7d: 5 }))).toBe(2);
  });

  it("returns 2 for high review count", () => {
    expect(computeTier(makeRow({ reviewCount: 20 }))).toBe(2);
  });

  it("returns 3 for any other alert", () => {
    expect(computeTier(makeRow({ alerts: [{ condition: "tracking_off", severity: "warn", since: "", value: null }] }))).toBe(3);
  });

  it("returns 4 for healthy site", () => {
    expect(computeTier(makeRow())).toBe(4);
  });
});

describe("cardPredicate", () => {
  it("ALL_LIVE filters to Live status only", () => {
    const fn = cardPredicate("ALL_LIVE");
    expect(fn(makeRow({ status: "Live" }))).toBe(true);
    expect(fn(makeRow({ status: "Staging" }))).toBe(false);
  });

  it("ATTENTION filters to rows with alerts", () => {
    const fn = cardPredicate("ATTENTION");
    expect(fn(makeRow({ alerts: [{ condition: "x", severity: "warn", since: "", value: null }] }))).toBe(true);
    expect(fn(makeRow())).toBe(false);
  });

  it("PUBLISHED_TODAY filters to rows scheduled today", () => {
    const fn = cardPredicate("PUBLISHED_TODAY");
    expect(fn(makeRow({ todayExpected: 3 }))).toBe(true);
    expect(fn(makeRow({ todayExpected: 0 }))).toBe(false);
  });

  it("IN_REVIEW filters to rows with any review count", () => {
    const fn = cardPredicate("IN_REVIEW");
    expect(fn(makeRow({ reviewCount: 1 }))).toBe(true);
    expect(fn(makeRow({ reviewCount: 0 }))).toBe(false);
  });
});

describe("computeCostStrip", () => {
  it("returns zeroes for empty input", () => {
    const result = computeCostStrip([], { totalBytes: 0, totalImages: 0, capacityPct: 0, lastUpdated: null });
    expect(result.aiSpendToday).toBe(0);
    expect(result.avgPerArticle7d).toBe(0);
    expect(result.expectedMonthly).toBe(0);
  });

  it("computes network-wide totals", () => {
    const costs = [
      { todayUsd: 1.0, thisWeekUsd: 5.0, created7d: 10, allTimeTokens: { input: 1000, output: 500 } },
      { todayUsd: 0.5, thisWeekUsd: 3.0, created7d: 5, allTimeTokens: { input: 2000, output: 1000 } },
    ];
    const r2 = { totalBytes: 5 * 1024 ** 3, totalImages: 100, capacityPct: 50, lastUpdated: null };
    const result = computeCostStrip(costs as never[], r2);
    expect(result.aiSpendToday).toBeCloseTo(1.5, 2);
    expect(result.avgPerArticle7d).toBeCloseTo(0.533, 2); // 8.0 / 15
    expect(result.totalTokensIn).toBe(3000);
    expect(result.totalTokensOut).toBe(1500);
    expect(result.r2.totalImages).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/ops-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `services/dashboard/src/lib/ops-helpers.ts`:

```typescript
import type { SiteStatus } from "@/types/dashboard";

/* ─── Types ─── */

export interface OpsRow {
  domain: string;
  status: SiteStatus;
  customDomain: string | null;
  vertical: string;
  failedArticles7d: number;
  failedArticles30d: number;
  imageGenFailed7d: number;
  imageGenFailed30d: number;
  reviewCount: number;
  generalImages: number;
  todayCreated: number;
  todayExpected: number;
  thisWeekCreated: number;
  schedule: {
    articlesPerDay: number;
    preferredDays: string[];
    weeklyTarget: number;
    nextRun: string | null;
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
  uptime: { state: string; ok: boolean; statusCode: number | null; responseTimeMs: number | null };
  sync: { state: string; ok: boolean; syncedAt: string | null; error: string | null };
  ssl: { state: string; status: string | null; daysLeft: number | null; expiresAt: string | null };
  tracking: { state: string; ga4: boolean; gtm: boolean; pixel: boolean };
  domainExpiry: { state: string; daysLeft: number | null; expiresAt: string | null; autoRenew: boolean | null };
  alerts: { condition: string; severity: string; since: string; value: number | null }[];
  tier: 0 | 1 | 2 | 3 | 4;
}

export type CardId =
  | "ALL_LIVE"
  | "ATTENTION"
  | "FAILED_ARTICLES"
  | "SITES_DOWN"
  | "SYNC_FAILED"
  | "PUBLISHED_TODAY"
  | "IN_REVIEW";

export interface CostStripData {
  aiSpendToday: number;
  avgPerArticle7d: number;
  expectedMonthly: number;
  totalTokensIn: number;
  totalTokensOut: number;
  r2: { totalBytes: number; totalImages: number; capacityPct: number };
}

/* ─── Tier ─── */

function within24h(syncedAt: string | null): boolean {
  if (!syncedAt) return false;
  return Date.now() - new Date(syncedAt).getTime() < 86_400_000;
}

export function computeTier(row: Omit<OpsRow, "tier">): 0 | 1 | 2 | 3 | 4 {
  if (!row.uptime.ok) return 0;
  if (!row.sync.ok && within24h(row.sync.syncedAt)) return 1;
  if (row.failedArticles7d > 3 || row.reviewCount > 15) return 2;
  if (row.alerts.length > 0) return 3;
  return 4;
}

/* ─── Card Predicates ─── */

export function cardPredicate(card: CardId): (row: OpsRow) => boolean {
  switch (card) {
    case "ALL_LIVE":
      return (r) => r.status === "Live";
    case "ATTENTION":
      return (r) => r.alerts.length > 0;
    case "FAILED_ARTICLES":
      return (r) => r.failedArticles7d > 3;
    case "SITES_DOWN":
      return (r) => !r.uptime.ok;
    case "SYNC_FAILED":
      return (r) => !r.sync.ok && within24h(r.sync.syncedAt);
    case "PUBLISHED_TODAY":
      return (r) => r.todayExpected > 0;
    case "IN_REVIEW":
      return (r) => r.reviewCount > 0;
  }
}

/* ─── Cost Strip ─── */

interface CostInput {
  todayUsd: number;
  thisWeekUsd: number;
  created7d: number;
  allTimeTokens: { input: number; output: number };
}

interface R2Input {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

export function computeCostStrip(costs: CostInput[], r2: R2Input): CostStripData {
  let aiSpendToday = 0;
  let totalCost7d = 0;
  let totalCreated7d = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const c of costs) {
    aiSpendToday += c.todayUsd;
    totalCost7d += c.thisWeekUsd;
    totalCreated7d += c.created7d;
    totalTokensIn += c.allTimeTokens.input;
    totalTokensOut += c.allTimeTokens.output;
  }

  const avgPerArticle7d = totalCreated7d > 0 ? totalCost7d / totalCreated7d : 0;

  // projectedMonthlyArticles: sum across all sites of articlesPerDay * preferredDays * 4.33
  // This is computed separately in OpsDashboard from OpsRows (needs schedule data)
  // CostStrip receives the final expectedMonthly from OpsDashboard
  const expectedMonthly = 0; // placeholder — computed by caller

  return {
    aiSpendToday,
    avgPerArticle7d,
    expectedMonthly,
    totalTokensIn,
    totalTokensOut,
    r2: { totalBytes: r2.totalBytes, totalImages: r2.totalImages, capacityPct: r2.capacityPct },
  };
}

/* ─── Merge ─── */

export interface StatsInput {
  siteDomain: string;
  failedArticles?: { last7d: number; last30d: number };
  imageGenFailed?: { last7d: number; last30d: number };
  reviewCount?: number;
  generalImages?: number;
  today?: { created: number; expected: number };
  thisWeek?: { created: number; expected: number };
  schedule?: {
    articlesPerDay: number;
    preferredDays: string[];
    weeklyTarget: number;
    nextRun: string | null;
  } | null;
  recentArticles?: OpsRow["recentArticles"];
  lastAdded?: OpsRow["lastAdded"];
  lastFailedAt?: string | null;
}

export interface ChecksInput {
  siteDomain: string;
  checks: {
    uptime: OpsRow["uptime"];
    ssl: OpsRow["ssl"];
    domain: OpsRow["domainExpiry"];
    sync: OpsRow["sync"];
    tracking: OpsRow["tracking"];
  };
}

export interface AttentionInput {
  siteDomain: string;
  alerting: OpsRow["alerts"];
}

export interface IndexInput {
  domain: string;
  status: SiteStatus;
  custom_domain: string | null;
  vertical: string;
}

export function mergeOpsRows(
  index: IndexInput[],
  stats: StatsInput[],
  checks: ChecksInput[],
  attention: AttentionInput[],
): OpsRow[] {
  const statsMap = new Map(stats.map((s) => [s.siteDomain, s]));
  const checksMap = new Map(checks.map((c) => [c.siteDomain, c]));
  const attentionMap = new Map(attention.map((a) => [a.siteDomain, a]));

  const defaultUptime: OpsRow["uptime"] = { state: "unknown", ok: true, statusCode: null, responseTimeMs: null };
  const defaultSync: OpsRow["sync"] = { state: "unknown", ok: true, syncedAt: null, error: null };
  const defaultSsl: OpsRow["ssl"] = { state: "unknown", status: null, daysLeft: null, expiresAt: null };
  const defaultTracking: OpsRow["tracking"] = { state: "unknown", ga4: false, gtm: false, pixel: false };
  const defaultDomainExpiry: OpsRow["domainExpiry"] = { state: "unknown", daysLeft: null, expiresAt: null, autoRenew: null };

  return index.map((site) => {
    const s = statsMap.get(site.domain);
    const c = checksMap.get(site.domain);
    const a = attentionMap.get(site.domain);

    const partial: Omit<OpsRow, "tier"> = {
      domain: site.domain,
      status: site.status as SiteStatus,
      customDomain: site.custom_domain,
      vertical: site.vertical ?? "",
      failedArticles7d: s?.failedArticles?.last7d ?? 0,
      failedArticles30d: s?.failedArticles?.last30d ?? 0,
      imageGenFailed7d: s?.imageGenFailed?.last7d ?? 0,
      imageGenFailed30d: s?.imageGenFailed?.last30d ?? 0,
      reviewCount: s?.reviewCount ?? 0,
      generalImages: s?.generalImages ?? 0,
      todayCreated: s?.today?.created ?? 0,
      todayExpected: s?.today?.expected ?? 0,
      thisWeekCreated: s?.thisWeek?.created ?? 0,
      schedule: s?.schedule ?? null,
      recentArticles: s?.recentArticles ?? [],
      lastAdded: s?.lastAdded ?? null,
      lastFailedAt: s?.lastFailedAt ?? null,
      uptime: c?.checks.uptime ?? defaultUptime,
      sync: c?.checks.sync ?? defaultSync,
      ssl: c?.checks.ssl ?? defaultSsl,
      tracking: c?.checks.tracking ?? defaultTracking,
      domainExpiry: c?.checks.domain ?? defaultDomainExpiry,
      alerts: a?.alerting ?? [],
    };

    return { ...partial, tier: computeTier(partial) };
  });
}

/* ─── Sort ─── */

export function sortByTier(rows: OpsRow[]): OpsRow[] {
  return [...rows].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.domain.localeCompare(b.domain);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/ops-helpers.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/ops-helpers.ts \
      services/dashboard/src/lib/__tests__/ops-helpers.test.ts
git commit -m "feat(dashboard): add ops-helpers — merge, tier, predicates, cost strip"
```

---

## Phase 4: Dashboard UI Components

### Task 9: FilterCards component

**Files:**
- Create: `services/dashboard/src/components/ops/FilterCards.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/components/ops/FilterCards.tsx`:

```tsx
"use client";

import type { CardId, OpsRow } from "@/lib/ops-helpers";
import { cardPredicate } from "@/lib/ops-helpers";

interface CardConfig {
  id: CardId;
  label: string;
  icon: string;
  colorClass: string;
  bgClass: string;
}

const CARDS: CardConfig[] = [
  { id: "ALL_LIVE", label: "All Sites (Live)", icon: "◉", colorClass: "text-primary", bgClass: "bg-primary-light" },
  { id: "ATTENTION", label: "Needs Attention", icon: "⚠", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "FAILED_ARTICLES", label: "Failed Articles (7d)", icon: "✕", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SITES_DOWN", label: "Sites Down", icon: "↓", colorClass: "text-error", bgClass: "bg-error-light" },
  { id: "SYNC_FAILED", label: "Sync Failed (24h)", icon: "⟲", colorClass: "text-warning", bgClass: "bg-warning-light" },
  { id: "PUBLISHED_TODAY", label: "Published Today", icon: "↑", colorClass: "text-success", bgClass: "bg-success-light" },
  { id: "IN_REVIEW", label: "In Review", icon: "◎", colorClass: "text-primary", bgClass: "bg-primary-light" },
];

interface FilterCardsProps {
  rows: OpsRow[];
  activeCard: CardId | null;
  onCardClick: (card: CardId) => void;
}

export function FilterCards({ rows, activeCard, onCardClick }: FilterCardsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-7 gap-2.5">
      {CARDS.map((card) => {
        const isActive = activeCard === card.id;
        const count = computeCount(card.id, rows);
        return (
          <button
            key={card.id}
            onClick={() => onCardClick(card.id)}
            className={`
              rounded-xl p-3 text-center transition-all cursor-pointer
              bg-card border shadow-card
              ${isActive ? "border-primary border-2" : "border-card-border"}
              hover:shadow-card-hover
            `}
          >
            <div className={`inline-flex w-7 h-7 rounded-lg ${card.bgClass} items-center justify-center mb-1.5`}>
              <span className={`${card.colorClass} text-sm`}>{card.icon}</span>
            </div>
            <div className="text-secondary text-[9px] uppercase tracking-wider mb-1">{card.label}</div>
            <div className="text-2xl font-bold text-primary-text">
              {typeof count === "string" ? count : count}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function computeCount(cardId: CardId, rows: OpsRow[]): string | number {
  if (cardId === "PUBLISHED_TODAY") {
    const created = rows.reduce((s, r) => s + r.todayCreated, 0);
    const expected = rows.reduce((s, r) => s + r.todayExpected, 0);
    return `${created} / ${expected}`;
  }
  if (cardId === "IN_REVIEW") {
    return rows.reduce((s, r) => s + r.reviewCount, 0);
  }
  return rows.filter(cardPredicate(cardId)).length;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/components/ops/FilterCards.tsx
git commit -m "feat(dashboard): add FilterCards component"
```

---

### Task 10: CostStrip component

**Files:**
- Create: `services/dashboard/src/components/ops/CostStrip.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/components/ops/CostStrip.tsx`:

```tsx
"use client";

import type { CostStripData } from "@/lib/ops-helpers";

interface CostStripProps {
  data: CostStripData;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

export function CostStrip({ data }: CostStripProps): React.ReactElement {
  const items = [
    { label: "AI spend today", value: fmt(data.aiSpendToday) },
    { label: "Avg/article (7d)", value: data.avgPerArticle7d > 0 ? fmt(data.avgPerArticle7d) : "—" },
    { label: "Expected monthly", value: data.expectedMonthly > 0 ? fmt(data.expectedMonthly) : "—" },
    { label: "Total tokens", value: `${fmtTokens(data.totalTokensIn)} in · ${fmtTokens(data.totalTokensOut)} out` },
    { label: "R2 storage", value: `${fmtBytes(data.r2.totalBytes)} · ${data.r2.capacityPct.toFixed(0)}% · ${data.r2.totalImages.toLocaleString()} imgs` },
  ];

  return (
    <div className="bg-card border border-card-border rounded-xl px-5 py-2.5 flex justify-between items-center shadow-card text-xs">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3">
          {i > 0 && <span className="text-divider">│</span>}
          <div>
            <span className="text-secondary">{item.label}</span>{" "}
            <span className="text-primary-text font-semibold">{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/components/ops/CostStrip.tsx
git commit -m "feat(dashboard): add CostStrip component"
```

---

### Task 11: FilterBar component

**Files:**
- Create: `services/dashboard/src/components/ops/FilterBar.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/components/ops/FilterBar.tsx`:

```tsx
"use client";

import { useState, useMemo, useCallback } from "react";
import type { SiteStatus } from "@/types/dashboard";

interface FilterBarProps {
  verticals: string[];
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: SiteStatus | "All";
  onStatusChange: (value: SiteStatus | "All") => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  onReset: () => void;
}

const STATUSES: (SiteStatus | "All")[] = ["All", "Live", "Staging", "Preview", "Ready", "New", "WordPress"];

export function FilterBar({
  verticals,
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
  onReset,
}: FilterBarProps): React.ReactElement {
  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        placeholder="Search sites..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-primary-text placeholder:text-secondary"
      />
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value as SiteStatus | "All")}
        className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-secondary"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s === "All" ? "All statuses" : s}</option>
        ))}
      </select>
      <select
        value={categoryFilter}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-secondary"
      >
        <option value="">All categories</option>
        {verticals.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <button
        onClick={onReset}
        className="text-sm text-primary font-medium px-3 py-1.5 cursor-pointer"
      >
        Reset filters
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/components/ops/FilterBar.tsx
git commit -m "feat(dashboard): add FilterBar component"
```

---

### Task 12: OpsTable + OpsTableRow + SiteDetailPanel

**Files:**
- Create: `services/dashboard/src/components/ops/OpsTable.tsx`
- Create: `services/dashboard/src/components/ops/OpsTableRow.tsx`
- Create: `services/dashboard/src/components/ops/SiteDetailPanel.tsx`

- [ ] **Step 1: Create SiteDetailPanel**

Create `services/dashboard/src/components/ops/SiteDetailPanel.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OpsRow } from "@/lib/ops-helpers";

interface SiteDetailPanelProps {
  row: OpsRow;
}

export function SiteDetailPanel({ row }: SiteDetailPanelProps): React.ReactElement {
  const router = useRouter();
  const [reseeding, setReseeding] = useState(false);
  const [reseedMsg, setReseedMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleReseed(): Promise<void> {
    setReseeding(true);
    setReseedMsg(null);
    try {
      const resp = await fetch("/api/sites/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: row.domain }),
      });
      const data = await resp.json();
      setReseedMsg({ ok: resp.ok, text: data.message ?? data.error ?? "Unknown result" });
    } catch (err) {
      setReseedMsg({ ok: false, text: String(err) });
    } finally {
      setReseeding(false);
    }
  }

  return (
    <div className="bg-page border-t-2 border-primary p-4">
      <div className="grid grid-cols-5 gap-3.5">
        {/* Schedule */}
        <div className="bg-card border border-card-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Schedule</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Days: <span className="text-primary-text font-medium">{row.schedule?.preferredDays.join(", ") ?? "—"}</span></div>
            <div>Per day: <span className="text-primary-text font-medium">{row.schedule?.articlesPerDay ?? "—"}</span></div>
            <div>Next run: <span className="text-primary-text font-medium">{row.schedule?.nextRun ? new Date(row.schedule.nextRun).toLocaleString() : "—"}</span></div>
          </div>
        </div>

        {/* Failed Articles */}
        <div className="bg-card border border-error-border rounded-xl p-3.5 shadow-card">
          <div className="text-error text-[10px] uppercase font-bold tracking-wider mb-2.5">Failed Articles</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Last 7d: <span className="text-error font-bold">{row.failedArticles7d}</span></div>
            <div>Last 30d: <span className="text-warning font-semibold">{row.failedArticles30d}</span></div>
          </div>
        </div>

        {/* Image Gen Failed */}
        <div className="bg-card border border-warning-border rounded-xl p-3.5 shadow-card">
          <div className="text-warning text-[10px] uppercase font-bold tracking-wider mb-2.5">Image Gen Failed</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Last 7d: <span className="text-warning font-bold">{row.imageGenFailed7d}</span></div>
            <div>Last 30d: <span className="text-secondary">{row.imageGenFailed30d}</span></div>
          </div>
        </div>

        {/* Checks */}
        <div className="bg-card border border-card-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Checks</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            <div>Uptime: <span className={row.uptime.ok ? "text-success" : "text-error"}>● {row.uptime.ok ? "Up" : "Down"}{row.uptime.responseTimeMs != null ? ` (${row.uptime.responseTimeMs}ms)` : ""}</span></div>
            <div>Sync: <span className={row.sync.ok ? "text-success" : "text-error"}>● {row.sync.ok ? "OK" : "Fail"}</span>{row.sync.syncedAt ? <span className="text-[9px] ml-1">{new Date(row.sync.syncedAt).toLocaleString()}</span> : null}</div>
            <div>SSL: <span className={row.ssl.status === "active" ? "text-success" : "text-secondary"}>{row.ssl.status === "active" ? "✓ active" : row.ssl.state}</span>{row.ssl.daysLeft != null ? <span className="text-[9px] ml-1">{row.ssl.daysLeft}d left</span> : null}</div>
            <div>GA4: <Dot ok={row.tracking.ga4} /> GTM: <Dot ok={row.tracking.gtm} /> Pixel: <Dot ok={row.tracking.pixel} /></div>
          </div>
        </div>

        {/* Recent Articles */}
        <div className="bg-card border border-primary-border rounded-xl p-3.5 shadow-card">
          <div className="text-primary text-[10px] uppercase font-bold tracking-wider mb-2.5">Recent Articles</div>
          <div className="text-secondary text-[11px] leading-relaxed space-y-1">
            {row.recentArticles.length === 0 && <div>—</div>}
            {row.recentArticles.map((a) => (
              <div key={a.slug} className="truncate">
                <span className="text-primary-text">{a.title}</span>
                {" · "}
                <span className={a.score != null && a.score >= 75 ? "text-success font-semibold" : "text-warning font-semibold"}>{a.score ?? "—"}</span>
                {" · "}{a.status}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-4 pt-3.5 border-t border-divider flex gap-2.5">
        <button onClick={() => router.push(`/sites/${row.domain}`)} className="px-3.5 py-1.5 bg-primary text-white rounded-lg text-[11px] font-medium cursor-pointer hover:bg-primary-hover">View Site →</button>
        <button onClick={() => router.push(`/sites/${row.domain}?tab=content&filter=review`)} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer">Review Queue →</button>
        <button onClick={handleReseed} disabled={reseeding} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-50">
          {reseeding ? "Seeding..." : "Re-seed KV"}
        </button>
        <button onClick={() => router.push(`/general-images?site=${row.domain}`)} className="px-3.5 py-1.5 bg-card border border-primary-border text-primary rounded-lg text-[11px] font-medium cursor-pointer">Generate Images →</button>
        {reseedMsg && (
          <span className={`text-[11px] self-center ml-2 ${reseedMsg.ok ? "text-success" : "text-error"}`}>{reseedMsg.text}</span>
        )}
      </div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }): React.ReactElement {
  return <span className={ok ? "text-success" : "text-muted"}>●</span>;
}
```

- [ ] **Step 2: Create OpsTableRow**

Create `services/dashboard/src/components/ops/OpsTableRow.tsx`:

```tsx
"use client";

import type { OpsRow } from "@/lib/ops-helpers";
import { SiteDetailPanel } from "./SiteDetailPanel";

interface OpsTableRowProps {
  row: OpsRow;
  expanded: boolean;
  onToggle: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  Live: "bg-success-light text-success border-success-border",
  Staging: "bg-warning-light text-warning border-warning-border",
  Preview: "bg-primary-light text-primary border-primary-border",
  Ready: "bg-primary-light text-primary border-primary-border",
  New: "bg-card text-secondary border-card-border",
  WordPress: "bg-warning-light text-warning border-warning-border",
};

export function OpsTableRow({ row, expanded, onToggle }: OpsTableRowProps): React.ReactElement {
  const tierBg = row.tier === 0 ? "bg-error-light" : "";

  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer hover:bg-primary-light/30 ${tierBg} border-b border-divider`}>
        <td className="px-3.5 py-2.5 text-heading font-semibold text-sm">{row.customDomain ?? row.domain}</td>
        <td className="px-3.5 py-2.5">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[row.status] ?? ""}`}>{row.status}</span>
        </td>
        <td className={`px-3.5 py-2.5 font-bold ${row.failedArticles7d > 3 ? "text-error" : row.failedArticles7d === 0 ? "text-muted" : "text-secondary"}`}>{row.failedArticles7d}</td>
        <td className={`px-3.5 py-2.5 ${row.imageGenFailed7d > 0 ? "text-warning font-semibold" : "text-muted"}`}>{row.imageGenFailed7d}</td>
        <td className="px-3.5 py-2.5">
          {row.uptime.state === "n/a" ? <span className="text-muted">n/a</span> : <span className={row.uptime.ok ? "text-success" : "text-error"}>● {row.uptime.ok ? "Up" : "Down"}</span>}
        </td>
        <td className="px-3.5 py-2.5">
          <span className={row.sync.ok ? "text-success" : "text-error"}>● {row.sync.ok ? "OK" : "Fail"}</span>
        </td>
        <td className={`px-3.5 py-2.5 ${row.reviewCount > 15 ? "text-primary font-bold" : row.reviewCount === 0 ? "text-muted" : "text-secondary"}`}>{row.reviewCount}</td>
        <td className="px-3.5 py-2.5">
          {row.ssl.state === "n/a" ? <span className="text-muted">n/a</span> : <span className={row.ssl.status === "active" ? "text-success" : "text-error"}>{row.ssl.status === "active" ? "✓" : "✗"}</span>}
        </td>
        <td className="px-3.5 py-2.5 text-[9px]">
          {row.tracking.state === "n/a" || row.tracking.state === "unknown"
            ? <span className="text-muted">—</span>
            : <>
                <span className={row.tracking.ga4 ? "text-success font-medium" : "text-muted"}>GA</span>
                {" · "}
                <span className={row.tracking.gtm ? "text-success font-medium" : "text-muted"}>GTM</span>
                {" · "}
                <span className={row.tracking.pixel ? "text-success font-medium" : "text-muted"}>Px</span>
              </>
          }
        </td>
        <td className={`px-3.5 py-2.5 ${row.domainExpiry.daysLeft != null && row.domainExpiry.daysLeft < 30 ? "text-error font-medium" : row.domainExpiry.daysLeft != null && row.domainExpiry.daysLeft < 60 ? "text-warning font-medium" : "text-primary-text"}`}>
          {row.domainExpiry.daysLeft != null ? `${row.domainExpiry.daysLeft}d` : "—"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="p-0">
            <SiteDetailPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 3: Create OpsTable**

Create `services/dashboard/src/components/ops/OpsTable.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import type { OpsRow } from "@/lib/ops-helpers";
import { OpsTableRow } from "./OpsTableRow";

interface OpsTableProps {
  rows: OpsRow[];
}

const COLUMNS = ["Site", "Status", "Failed 7d", "Img Fail", "Uptime", "Sync", "Review", "SSL", "Tracking", "Domain"];
const PAGE_SIZES = [10, 25, 50, 100];

export function OpsTable({ rows }: OpsTableProps): React.ReactElement {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const totalPages = Math.ceil(rows.length / pageSize);
  const pageRows = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize],
  );

  function toggleRow(domain: string): void {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  return (
    <div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-header border-b border-divider">
              {COLUMNS.map((col) => (
                <th key={col} className="px-3.5 py-2.5 text-left text-[9px] uppercase tracking-wider text-secondary font-semibold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <OpsTableRow
                key={row.domain}
                row={row}
                expanded={expandedRows.has(row.domain)}
                onToggle={() => toggleRow(row.domain)}
              />
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={10} className="px-3.5 py-8 text-center text-secondary">No sites match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center mt-3 text-secondary text-xs">
        <div>
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length} sites
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="ml-2 bg-card border border-card-border rounded px-1.5 py-0.5 text-xs"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2.5 py-1 border border-card-border rounded-md disabled:opacity-40">← Prev</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`px-2.5 py-1 rounded-md ${i === page ? "bg-primary text-white" : "border border-card-border"}`}
            >
              {i + 1}
            </button>
          ))}
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} className="px-2.5 py-1 border border-card-border rounded-md disabled:opacity-40">Next →</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/components/ops/SiteDetailPanel.tsx \
      services/dashboard/src/components/ops/OpsTableRow.tsx \
      services/dashboard/src/components/ops/OpsTable.tsx
git commit -m "feat(dashboard): add OpsTable, OpsTableRow, SiteDetailPanel components"
```

---

### Task 13: OpsDashboard — main client component

**Files:**
- Create: `services/dashboard/src/components/ops/OpsDashboard.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/components/ops/OpsDashboard.tsx`:

```tsx
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { DashboardSiteEntry, SiteStatus } from "@/types/dashboard";
import {
  mergeOpsRows,
  sortByTier,
  cardPredicate,
  computeCostStrip,
  type OpsRow,
  type CardId,
  type StatsInput,
  type ChecksInput,
  type AttentionInput,
  type CostStripData,
} from "@/lib/ops-helpers";
import { FilterCards } from "./FilterCards";
import { CostStrip } from "./CostStrip";
import { FilterBar } from "./FilterBar";
import { OpsTable } from "./OpsTable";

interface R2Data {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

interface CostSite {
  siteDomain: string;
  windows: {
    todayUsd: number;
    thisWeekUsd: number;
    last30dUsd: number;
    allTimeTokens: { input: number; output: number };
    avgPerArticle7dUsd: number;
    created7d: number;
  };
}

interface OpsDashboardProps {
  initialIndex: DashboardSiteEntry[];
  initialStats: { sites: StatsInput[] };
  initialChecks: { sites: ChecksInput[] };
  initialCosts: { sites: CostSite[] };
  initialAttention: { sites: AttentionInput[] };
  initialR2: R2Data;
}

const POLL_INTERVAL = 60_000;

export default function OpsDashboard({
  initialIndex,
  initialStats,
  initialChecks,
  initialCosts,
  initialAttention,
  initialR2,
}: OpsDashboardProps): React.ReactElement {
  const [stats, setStats] = useState(initialStats);
  const [checks, setChecks] = useState(initialChecks);
  const [costs, setCosts] = useState(initialCosts);
  const [attention, setAttention] = useState(initialAttention);
  const [r2, setR2] = useState(initialR2);
  const [lastRefreshed, setLastRefreshed] = useState(Date.now());
  const [failCount, setFailCount] = useState(0);

  const [activeCard, setActiveCard] = useState<CardId | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatus | "All">("All");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Polling
  const poll = useCallback(async () => {
    try {
      const [sResp, chResp, coResp, aResp, rResp] = await Promise.all([
        fetch("/api/site-stats").then((r) => r.ok ? r.json() : null),
        fetch("/api/site-checks").then((r) => r.ok ? r.json() : null),
        fetch("/api/site-costs").then((r) => r.ok ? r.json() : null),
        fetch("/api/attention").then((r) => r.ok ? r.json() : null),
        fetch("/api/r2-usage").then((r) => r.ok ? r.json() : null),
      ]);
      if (sResp) setStats(sResp);
      if (chResp) setChecks(chResp);
      if (coResp) setCosts(coResp);
      if (aResp) setAttention(aResp);
      if (rResp) setR2(rResp);
      setLastRefreshed(Date.now());
      setFailCount(0);
    } catch {
      setFailCount((c) => c + 1);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  // Index → filter to real sites
  const indexSites = useMemo(
    () => initialIndex.filter((s) => s.staging_branch !== null || s.pages_project !== null),
    [initialIndex],
  );

  // Merge
  const allRows = useMemo(
    () => sortByTier(mergeOpsRows(
      indexSites.map((s) => ({
        domain: s.domain,
        status: s.status as SiteStatus,
        custom_domain: s.custom_domain,
        vertical: (s as Record<string, unknown>).vertical as string ?? "",
      })),
      stats.sites ?? [],
      checks.sites ?? [],
      attention.sites ?? [],
    )),
    [indexSites, stats, checks, attention],
  );

  // Cost strip
  const costStripData = useMemo(() => {
    const costInputs = (costs.sites ?? []).map((c) => c.windows);
    const base = computeCostStrip(costInputs, r2);
    // Compute expectedMonthly from schedule data
    let projectedMonthly = 0;
    for (const row of allRows) {
      if (row.schedule) {
        projectedMonthly += row.schedule.articlesPerDay * row.schedule.preferredDays.length * 4.33;
      }
    }
    return { ...base, expectedMonthly: base.avgPerArticle7d * projectedMonthly };
  }, [costs, r2, allRows]);

  // Verticals for filter dropdown
  const verticals = useMemo(
    () => [...new Set(indexSites.map((s) => (s as Record<string, unknown>).vertical as string).filter(Boolean))].sort(),
    [indexSites],
  );

  // Filter
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (activeCard) rows = rows.filter(cardPredicate(activeCard));
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter((r) => r.domain.toLowerCase().includes(q) || (r.customDomain?.toLowerCase().includes(q) ?? false));
    }
    if (statusFilter !== "All") rows = rows.filter((r) => r.status === statusFilter);
    if (categoryFilter) rows = rows.filter((r) => r.vertical === categoryFilter);
    return rows;
  }, [allRows, activeCard, debouncedSearch, statusFilter, categoryFilter]);

  const secondsAgo = Math.round((Date.now() - lastRefreshed) / 1000);

  function handleCardClick(card: CardId): void {
    setActiveCard((prev) => (prev === card ? null : card));
  }

  function handleReset(): void {
    setSearch("");
    setStatusFilter("All");
    setCategoryFilter("");
    setActiveCard(null);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-heading">Content Network</h1>
          <p className="text-secondary text-xs">
            Last refreshed: {secondsAgo}s ago · Auto-refresh: 60s
            {failCount >= 3 && <span className="text-warning ml-2">· Connection issues</span>}
          </p>
        </div>
        <button onClick={poll} className="px-3.5 py-1.5 bg-card border border-primary-border rounded-lg text-primary text-xs font-medium cursor-pointer">
          ↻ Refresh now
        </button>
      </div>

      <FilterCards rows={allRows} activeCard={activeCard} onCardClick={handleCardClick} />
      <CostStrip data={costStripData} />
      <FilterBar
        verticals={verticals}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        onReset={handleReset}
      />
      <OpsTable rows={filteredRows} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/components/ops/OpsDashboard.tsx
git commit -m "feat(dashboard): add OpsDashboard — main client component with polling"
```

---

### Task 14: Wire page.tsx

**Files:**
- Modify: `services/dashboard/src/app/page.tsx`

- [ ] **Step 1: Replace page.tsx**

Replace the entire content of `services/dashboard/src/app/page.tsx`:

```tsx
import { readDashboardIndex } from "@/lib/github";
import dynamic from "next/dynamic";

export const dynamic_config = "force-dynamic";
export { dynamic_config as dynamic };

const OpsDashboard = dynamic(() => import("@/components/ops/OpsDashboard"), {
  ssr: false,
  loading: () => <div className="p-8 text-secondary text-center">Loading ops dashboard...</div>,
});

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  try {
    const resp = await fetch(`${base}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return {};
    return await resp.json();
  } catch {
    return {};
  }
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [index, stats, checks, costs, attention, r2] = await Promise.all([
    readDashboardIndex(),
    fetchJson("/api/site-stats"),
    fetchJson("/api/site-checks"),
    fetchJson("/api/site-costs"),
    fetchJson("/api/attention"),
    fetchJson("/api/r2-usage"),
  ]);

  return (
    <OpsDashboard
      initialIndex={index.sites}
      initialStats={stats as never}
      initialChecks={checks as never}
      initialCosts={costs as never}
      initialAttention={attention as never}
      initialR2={r2 as never}
    />
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors (or only pre-existing ones unrelated to ops components)

- [ ] **Step 3: Run all dashboard tests**

Run: `cd services/dashboard && pnpm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/page.tsx
git commit -m "feat(dashboard): wire ops dashboard into page.tsx"
```

---

## Phase 5: Tailwind Theme Tokens

### Task 15: Add theme CSS variables

**Files:**
- Modify: Tailwind CSS config or global CSS (exact file depends on the project's Tailwind v4 setup — check `services/dashboard/src/app/globals.css` or `tailwind.config.ts`)

- [ ] **Step 1: Identify the CSS entry point**

Check `services/dashboard/src/app/globals.css` or `services/dashboard/src/app/layout.tsx` for the Tailwind setup. Tailwind v4 uses CSS-first config with `@theme` directives.

- [ ] **Step 2: Add ops dashboard theme tokens**

Add to the CSS theme layer (inside `@theme` or `:root`):

```css
:root {
  --color-primary: #6D4AFF;
  --color-primary-hover: #5B3EF0;
  --color-primary-light: #F3F0FF;
  --color-primary-border: #D9CCFF;
  --color-page: #F8F9FC;
  --color-card: #FFFFFF;
  --color-card-border: #E7E8F0;
  --color-divider: #EEF0F5;
  --color-secondary: #6B7280;
  --color-primary-text: #111827;
  --color-heading: #0F172A;
  --color-success: #10B981;
  --color-success-light: #ECFDF5;
  --color-success-border: #A7F3D0;
  --color-warning: #F59E0B;
  --color-warning-light: #FFFBEB;
  --color-warning-border: #FCD34D;
  --color-error: #EF4444;
  --color-error-light: #FEF2F2;
  --color-error-border: #FECACA;
  --color-muted: #D1D5DB;
  --color-table-header: #FAFAFC;
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.05), 0 8px 24px rgba(15, 23, 42, 0.04);
  --shadow-card-hover: 0 2px 6px rgba(15, 23, 42, 0.08), 0 12px 32px rgba(15, 23, 42, 0.06);
}

.dark {
  --color-primary: #d2a8ff;
  --color-primary-hover: #b88aff;
  --color-primary-light: #1c1433;
  --color-primary-border: #4c3a80;
  --color-page: #0d1117;
  --color-card: #161b22;
  --color-card-border: #30363d;
  --color-divider: #21262d;
  --color-secondary: #7d8590;
  --color-primary-text: #e6edf3;
  --color-heading: #e6edf3;
  --color-success: #3fb950;
  --color-success-light: #0d1f0d;
  --color-success-border: #1a5a1a;
  --color-warning: #f0883e;
  --color-warning-light: #1f1507;
  --color-warning-border: #7a4510;
  --color-error: #f85149;
  --color-error-light: #1f0d0d;
  --color-error-border: #7a1a1a;
  --color-muted: #484f58;
  --color-table-header: #161b22;
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-card-hover: 0 2px 6px rgba(0, 0, 0, 0.3);
}
```

Then extend Tailwind config (or `@theme` in v4) to map these variables to utility classes:

```css
@theme {
  --color-primary: var(--color-primary);
  --color-primary-hover: var(--color-primary-hover);
  --color-primary-light: var(--color-primary-light);
  --color-primary-border: var(--color-primary-border);
  /* ... etc for all tokens */
}
```

The exact syntax depends on the existing setup. The implementer should check the current globals.css to match the convention.

- [ ] **Step 3: Verify both themes render correctly**

Run: `cd services/dashboard && pnpm dev`
Open `http://localhost:3001` — toggle dark/light mode and verify both themes.

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/globals.css
git commit -m "feat(dashboard): add ops dashboard theme tokens (light + dark)"
```

---

## Phase 6: Integration Testing

### Task 16: Manual end-to-end verification

- [ ] **Step 1: Start local dev**

Run: `cloudgrid dev` (or `cd services/dashboard && pnpm dev` + `cd services/content-pipeline && pnpm dev`)

- [ ] **Step 2: Verify API endpoints return data**

```bash
curl -s http://localhost:3001/api/site-stats | jq '.sites | length'
curl -s http://localhost:3001/api/site-checks | jq '.sites | length'
curl -s http://localhost:3001/api/site-costs | jq '.sites[0].windows'
curl -s http://localhost:3001/api/attention | jq '.sites | length'
curl -s http://localhost:3001/api/r2-usage | jq
```

- [ ] **Step 3: Verify dashboard renders**

Open `http://localhost:3001`. Verify:
- 7 cards render with counts
- Cost strip shows metrics
- Table shows sites sorted worst-first
- Clicking a card filters the table
- Clicking a row expands the detail panel
- Multiple rows can be expanded simultaneously
- Action buttons navigate correctly (View Site, Review Queue, Generate Images)
- Dark/light toggle works
- "Last refreshed" counter increments, auto-refreshes at 60s

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS across dashboard, content-pipeline, and site-worker.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors.

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -u
git commit -m "fix(dashboard): ops dashboard integration fixups"
```

---

## Task Dependency Graph

```
Task 1 (daily stats) ─────┐
Task 2 (cost windows) ─────┤
Task 3 (R2 tally) ─────────┼── Task 7 (API routes) ── Task 8 (ops-helpers) ──┐
Task 4 (R2 increments) ────┤                                                  │
Task 5 (R2 backfill) ──────┘                                                  │
Task 6 (today.expected) ───────────────────────────────────────────────────────┤
                                                                               │
Task 9 (FilterCards) ──────┐                                                   │
Task 10 (CostStrip) ───────┤                                                   │
Task 11 (FilterBar) ───────┼── Task 13 (OpsDashboard) ── Task 14 (page.tsx) ──┤
Task 12 (Table+Detail) ────┘                                                   │
                                                                               │
Task 15 (Theme tokens) ─── Task 16 (Integration) ─────────────────────────────┘
```

Tasks 1-6 can run in parallel. Tasks 9-12 can run in parallel. Task 13 depends on 8-12. Task 14 depends on 13+15. Task 16 is last.
