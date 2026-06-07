# Ops Console 1 — Generation Stats API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every article-generation run (scheduler, dashboard, wp-import) and every n8n image-generation outcome to MongoDB, and expose a per-site stats API (last-added, counts, schedule+next-run, this-week vs expected, failed 7/30d, image-gen-fail 7/30d, recent articles) served by content-pipeline and proxied by the dashboard.

**Architecture:** content-pipeline owns the first MongoDB store in the platform (CloudGrid `requires: mongodb`). A failure-isolated recorder runs at the post-`runContentGeneration` boundary on all three call sites and inside the n8n image callback. content-pipeline serves `GET /site-stats[/:domain]`; the dashboard `/api/site-stats` proxies it (standard `CONTENT_AGENT_URL` fallback) and enriches with recent-articles (from Git frontmatter) and `nextRun`.

**Tech Stack:** TypeScript (strict), Node 20+, `mongodb` driver, Vitest + `mongodb-memory-server`, BullMQ (existing), Octokit (existing), Cloudflare KV REST (existing in dashboard).

**Spec:** `docs/superpowers/specs/2026-06-07-per-site-generation-stats-api-design.md`

---

## Pre-flight notes (read once)

- **Branch:** work on `michal-dev` (never `main`). Run `git branch --show-current` before the first commit.
- **Commit co-author line:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (per session); repo convention historically used 4.6 — either is fine, be consistent.
- **CloudGrid AI Gateway / no `Date.now()` in pure logic:** schedule/window math takes an injected `now: Date` so it's testable.
- **Failure isolation is mandatory:** every Mongo write is wrapped in try/catch and logged; a DB error must never break or fail generation or the image callback (mirrors `history.ts`).
- **`mongodb` + `mongodb-memory-server` are NOT yet dependencies** — Task 1 adds them.
- **`source` derivation:** `triggeredBy` (`manual`→`dashboard`, `scheduled`/`scheduled-forced`→`scheduler`, `wp-import`→`wp-import`). The HTTP `/content-generate` direct path = `dashboard`; the scheduler direct path = `scheduler`.

## File structure (created/modified by this plan)

```
services/content-pipeline/
  package.json                         (modify: add mongodb, mongodb-memory-server)
  src/lib/mongo.ts                     (create: connection singleton)
  src/stats/types.ts                   (create: GenerationEvent, SiteStats, ImageGenEvent)
  src/stats/recorder.ts                (create: buildGenerationEvent, recordGeneration, recordImageGenEvent)
  src/stats/repo.ts                    (create: read aggregations + getSiteStats)
  src/stats/schedule.ts                (create: weeklyTarget + nextRun)
  src/stats/backfill.ts                (create: one-time history.json import)
  src/stats/__tests__/*.test.ts        (create: unit + integration tests)
  src/agents/content-generation/index.ts            (modify: add GET /site-stats routes; call recorder in /content-generate; call recorder in /image-callback)
  src/queue/content-generation.ts                   (modify: call recorder after runContentGeneration)
  src/agents/scheduled-publisher/index.ts           (modify: call recorder after runContentGeneration)
cloudgrid.yaml                         (modify: requires mongodb; MONGODB_URL note)
services/dashboard/src/app/api/site-stats/route.ts          (create: all-sites proxy + enrich)
services/dashboard/src/app/api/site-stats/[domain]/route.ts (create: single-site proxy + enrich)
services/dashboard/src/lib/site-stats.ts                    (create: recentArticles + nextRun enrichment helpers)
```

---

## Task 1: Add MongoDB dependencies + connection singleton

**Files:**
- Modify: `services/content-pipeline/package.json`
- Create: `services/content-pipeline/src/lib/mongo.ts`
- Test: `services/content-pipeline/src/stats/__tests__/mongo.test.ts`

- [ ] **Step 1: Add dependencies**

Run from repo root:
```bash
cd services/content-pipeline && pnpm add mongodb && pnpm add -D mongodb-memory-server
```
Expected: `mongodb` in `dependencies`, `mongodb-memory-server` in `devDependencies`.

- [ ] **Step 2: Write the failing test**

`services/content-pipeline/src/stats/__tests__/mongo.test.ts`:
```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";

let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

describe("mongo connection", () => {
  it("returns a usable Db and memoizes the client", async () => {
    const db1 = await getMongoDb();
    const db2 = await getMongoDb();
    expect(db1).toBe(db2); // memoized
    const ping = await db1.command({ ping: 1 });
    expect(ping.ok).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/mongo.test.ts`
Expected: FAIL — cannot find module `../../lib/mongo.js`.

- [ ] **Step 4: Implement `mongo.ts`** (mirrors the memoization style of `queue/connection.ts`)

`services/content-pipeline/src/lib/mongo.ts`:
```typescript
import { MongoClient, type Db } from "mongodb";

/** DB name within the cluster. Override via MONGODB_DB if needed. */
const DB_NAME = process.env.MONGODB_DB ?? "atl_ops";

let clientPromise: Promise<MongoClient> | null = null;

/** Lazy, memoized Mongo client. Throws if MONGODB_URL is unset. */
export async function getMongoDb(): Promise<Db> {
  if (!clientPromise) {
    const url = process.env.MONGODB_URL;
    if (!url) throw new Error("MONGODB_URL is not set");
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
    clientPromise = client.connect().catch((err) => {
      clientPromise = null; // allow retry on next call
      throw err;
    });
  }
  return (await clientPromise).db(DB_NAME);
}

/** Close for test teardown / graceful shutdown. */
export async function closeMongo(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/mongo.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/package.json services/content-pipeline/pnpm-lock.yaml services/content-pipeline/src/lib/mongo.ts services/content-pipeline/src/stats/__tests__/mongo.test.ts ../../pnpm-lock.yaml
git commit -m "feat(content-pipeline): add mongodb driver + connection singleton"
```
(If the root lockfile didn't change, omit it.)

---

## Task 2: Stats types + index initialization

**Files:**
- Create: `services/content-pipeline/src/stats/types.ts`
- Modify: `services/content-pipeline/src/lib/mongo.ts` (add `ensureStatsIndexes`)
- Test: `services/content-pipeline/src/stats/__tests__/indexes.test.ts`

- [ ] **Step 1: Define types** in `services/content-pipeline/src/stats/types.ts`:
```typescript
export type GenerationSource = "scheduler" | "dashboard" | "wp-import";
export type RunStatus = "success" | "partial" | "error" | "no_content";

export interface GenerationEvent {
  _id?: string;               // deterministic for backfill; auto otherwise
  siteDomain: string;
  source: GenerationSource;
  forced: boolean;
  topicName: string | null;
  requested: number;
  created: number;
  failed: number;             // results[] with status "error"
  status: RunStatus;
  message: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export interface ScheduleSnapshot {
  articlesPerDay: number;
  preferredDays: string[];
  weeklyTarget: number;
}

export interface SiteStats {
  _id: string;                // siteDomain
  lastRunAt: Date;
  lastAddedAt: Date | null;
  lastAddedSource: GenerationSource | null;
  lastAddedCount: number | null;
  lastFailedAt: Date | null;  // status==="error" && created===0
  totalCreated: number;
  schedule: ScheduleSnapshot | null;
  updatedAt: Date;
}

export interface ImageGenEvent {
  _id?: string;
  siteDomain: string;
  slug: string;
  ok: boolean;
  provider: string | null;
  error: string | null;
  at: Date;
}

export const COLLECTIONS = {
  generationEvents: "generation_events",
  siteStats: "site_stats",
  imageGenEvents: "image_gen_events",
} as const;
```

- [ ] **Step 2: Write failing test** `services/content-pipeline/src/stats/__tests__/indexes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo, ensureStatsIndexes } from "../../lib/mongo.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer;
beforeAll(async () => { mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); });

describe("ensureStatsIndexes", () => {
  it("creates the expected indexes", async () => {
    await ensureStatsIndexes();
    const db = await getMongoDb();
    const ge = await db.collection(COLLECTIONS.generationEvents).indexes();
    const names = ge.map((i) => i.name);
    expect(names.some((n) => n!.includes("siteDomain"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run → FAIL** (`ensureStatsIndexes` not exported).
Run: `cd services/content-pipeline && pnpm vitest run src/stats/__tests__/indexes.test.ts`

- [ ] **Step 4: Add `ensureStatsIndexes` to `mongo.ts`:**
```typescript
import { COLLECTIONS } from "../stats/types.js";

export async function ensureStatsIndexes(): Promise<void> {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.generationEvents).createIndexes([
    { key: { siteDomain: 1, finishedAt: -1 }, name: "siteDomain_finishedAt" },
    { key: { finishedAt: -1 }, name: "finishedAt" },
  ]);
  await db.collection(COLLECTIONS.imageGenEvents).createIndex(
    { siteDomain: 1, at: -1 }, { name: "siteDomain_at" },
  );
}
```

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit**
```bash
git add services/content-pipeline/src/stats/types.ts services/content-pipeline/src/lib/mongo.ts services/content-pipeline/src/stats/__tests__/indexes.test.ts
git commit -m "feat(content-pipeline): stats collection types + index init"
```

---

## Task 3: `buildGenerationEvent` — the shared mapper

This centralizes the four-state status derivation that today lives only in the scheduler. It is pure (no I/O), so it's heavily unit-tested.

**Files:**
- Create: `services/content-pipeline/src/stats/recorder.ts` (mapper portion)
- Test: `services/content-pipeline/src/stats/__tests__/build-event.test.ts`

- [ ] **Step 1: Write failing tests** `build-event.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildGenerationEvent } from "../recorder.js";
import type { BatchContentGenerationResult } from "../../agents/content-generation/agent.js";

const now = new Date("2026-06-07T14:02:00Z");
const started = new Date("2026-06-07T14:00:00Z");

function batch(results: Array<{ status: "created" | "skipped" | "error" }>): BatchContentGenerationResult {
  return {
    siteDomain: "travelswire", requested: results.length, totalSourced: 0,
    duplicateCount: 0, availableNew: 0, n8nImagesTriggered: 0,
    results: results as BatchContentGenerationResult["results"],
  };
}

describe("buildGenerationEvent", () => {
  it("success: all created", () => {
    const e = buildGenerationEvent(batch([{ status: "created" }, { status: "created" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: now });
    expect(e.created).toBe(2); expect(e.failed).toBe(0); expect(e.status).toBe("success");
  });
  it("partial: some created, some error", () => {
    const e = buildGenerationEvent(batch([{ status: "created" }, { status: "error" }]),
      { source: "dashboard", forced: false, topicName: null, startedAt: started, finishedAt: now });
    expect(e.created).toBe(1); expect(e.failed).toBe(1); expect(e.status).toBe("partial");
  });
  it("error: requested>0, zero created, has errors", () => {
    const e = buildGenerationEvent(batch([{ status: "error" }]),
      { source: "scheduler", forced: true, topicName: null, startedAt: started, finishedAt: now });
    expect(e.status).toBe("error"); expect(e.created).toBe(0);
  });
  it("no_content: nothing created, no errors (all skipped / none sourced)", () => {
    const e = buildGenerationEvent(batch([{ status: "skipped" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: now });
    expect(e.status).toBe("no_content"); expect(e.created).toBe(0); expect(e.failed).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement the mapper** in `recorder.ts`:
```typescript
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import type { GenerationEvent, GenerationSource, RunStatus } from "./types.js";

export interface EventContext {
  source: GenerationSource;
  forced: boolean;
  topicName: string | null;
  startedAt: Date;
  finishedAt: Date;
}

export function buildGenerationEvent(
  result: BatchContentGenerationResult,
  ctx: EventContext,
): GenerationEvent {
  const created = result.results.filter((r) => r.status === "created").length;
  const failed = result.results.filter((r) => r.status === "error").length;
  let status: RunStatus;
  if (created > 0 && created >= result.requested) status = "success";
  else if (created > 0) status = "partial";
  else if (failed > 0) status = "error";
  else status = "no_content";
  const firstErr = result.results.find((r) => r.status === "error");
  return {
    siteDomain: result.siteDomain,
    source: ctx.source,
    forced: ctx.forced,
    topicName: ctx.topicName,
    requested: result.requested,
    created,
    failed,
    status,
    message: firstErr?.message ?? null,
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
  };
}
```
> Note: `success` requires `created >= requested`; a smaller-but-nonzero count with no further demand is still `partial`. If the scheduler currently treats "created>0" as success, align by reading `scheduled-publisher/index.ts` lines 269–286 and matching its intent; adjust the test + mapper together if the existing semantics differ.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/recorder.ts services/content-pipeline/src/stats/__tests__/build-event.test.ts
git commit -m "feat(content-pipeline): shared buildGenerationEvent mapper"
```

---

## Task 4: `recordGeneration` — insert event + upsert rollup (failure-isolated)

**Files:**
- Modify: `services/content-pipeline/src/stats/recorder.ts`
- Test: `services/content-pipeline/src/stats/__tests__/record-generation.test.ts`

- [ ] **Step 1: Write failing integration test** (real in-memory Mongo):
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { recordGeneration } from "../recorder.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer;
beforeAll(async () => { mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { const db = await getMongoDb(); await db.dropDatabase(); });

const started = new Date("2026-06-07T14:00:00Z");
const finished = new Date("2026-06-07T14:02:00Z");
const schedule = { articlesPerDay: 3, preferredDays: ["Monday", "Wednesday"], weeklyTarget: 6 };

function batch(results: Array<{ status: string; message?: string }>, requested = results.length) {
  return { siteDomain: "travelswire", requested, totalSourced: 0, duplicateCount: 0,
    availableNew: 0, n8nImagesTriggered: 0, results } as any;
}

describe("recordGeneration", () => {
  it("inserts an event and upserts rollup with lastAdded set when created>0", async () => {
    await recordGeneration(batch([{ status: "created" }, { status: "created" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: finished }, schedule);
    const db = await getMongoDb();
    const events = await db.collection(COLLECTIONS.generationEvents).find().toArray();
    expect(events).toHaveLength(1);
    const stats = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(stats!.lastAddedCount).toBe(2);
    expect(stats!.lastAddedSource).toBe("scheduler");
    expect(stats!.totalCreated).toBe(2);
    expect(stats!.lastFailedAt).toBeNull();
    expect(stats!.schedule).toEqual(schedule);
  });

  it("sets lastFailedAt only on full failure (created===0 && status error)", async () => {
    await recordGeneration(batch([{ status: "error", message: "boom" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: finished }, null);
    const db = await getMongoDb();
    const stats = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(stats!.lastFailedAt).toEqual(finished);
    expect(stats!.lastAddedAt).toBeNull();
  });

  it("never throws when Mongo is unreachable (failure isolation)", async () => {
    await closeMongo();
    process.env.MONGODB_URL = "mongodb://127.0.0.1:1/none"; // unreachable
    await expect(recordGeneration(batch([{ status: "created" }]),
      { source: "dashboard", forced: false, topicName: null, startedAt: started, finishedAt: finished }, null),
    ).resolves.toBeUndefined();
    // restore for other tests
    await closeMongo(); process.env.MONGODB_URL = mem.getUri();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`recordGeneration` not exported).

- [ ] **Step 3: Implement** in `recorder.ts`:
```typescript
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS, type ScheduleSnapshot } from "./types.js";

export async function recordGeneration(
  result: BatchContentGenerationResult,
  ctx: EventContext,
  schedule: ScheduleSnapshot | null,
): Promise<void> {
  try {
    const event = buildGenerationEvent(result, ctx);
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.generationEvents).insertOne(event as any);

    const set: Record<string, unknown> = {
      lastRunAt: event.finishedAt,
      updatedAt: event.finishedAt,
    };
    if (schedule) set.schedule = schedule;
    if (event.created > 0) {
      set.lastAddedAt = event.finishedAt;
      set.lastAddedSource = event.source;
      set.lastAddedCount = event.created;
    }
    if (event.status === "error" && event.created === 0) {
      set.lastFailedAt = event.finishedAt;
    }
    await db.collection(COLLECTIONS.siteStats).updateOne(
      { _id: event.siteDomain as any },
      {
        $set: set,
        $inc: { totalCreated: event.created },
        $setOnInsert: { lastAddedAt: null, lastAddedSource: null, lastAddedCount: null, lastFailedAt: null, schedule: null },
      },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] recordGeneration failed (non-fatal): ${msg}`);
  }
}
```
> `$setOnInsert` must not list keys also in `$set` (Mongo rejects conflicts). Keep `schedule`/`lastAdded*`/`lastFailedAt` out of `$setOnInsert` when they're conditionally in `$set` — the simplest correct approach is to compute the full insert/update doc; if a conflict error appears in the test, move the conditional fields entirely into `$set` with explicit null defaults and drop `$setOnInsert` for those keys. Adjust until the test passes.

- [ ] **Step 4: Run → PASS** (resolve any `$set`/`$setOnInsert` conflict per the note).

- [ ] **Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/recorder.ts services/content-pipeline/src/stats/__tests__/record-generation.test.ts
git commit -m "feat(content-pipeline): recordGeneration writes event + rollup, failure-isolated"
```

---

## Task 5: `recordImageGenEvent` — image callback outcomes

**Files:**
- Modify: `services/content-pipeline/src/stats/recorder.ts`
- Test: `services/content-pipeline/src/stats/__tests__/record-image.test.ts`

- [ ] **Step 1: Write failing test** asserting a failed image event is stored and the call never throws on Mongo error.
```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { recordImageGenEvent } from "../recorder.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer;
beforeAll(async () => { mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { (await getMongoDb()).dropDatabase(); });

it("records a failed image event", async () => {
  await recordImageGenEvent({ siteDomain: "travelswire", slug: "x", ok: false, provider: "gemini", error: "n8n status: failed", at: new Date() });
  const db = await getMongoDb();
  const docs = await db.collection(COLLECTIONS.imageGenEvents).find().toArray();
  expect(docs).toHaveLength(1);
  expect(docs[0].ok).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**
```typescript
import type { ImageGenEvent } from "./types.js";

export async function recordImageGenEvent(event: ImageGenEvent): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.imageGenEvents).insertOne(event as any);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] recordImageGenEvent failed (non-fatal): ${msg}`);
  }
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/recorder.ts services/content-pipeline/src/stats/__tests__/record-image.test.ts
git commit -m "feat(content-pipeline): recordImageGenEvent"
```

---

## Task 6: Schedule snapshot + nextRun + weeklyTarget

**Files:**
- Create: `services/content-pipeline/src/stats/schedule.ts`
- Test: `services/content-pipeline/src/stats/__tests__/schedule.test.ts`

Reuse the scheduler's article-count resolution (landmine #6): `articlesPerDay = articles_per_day ?? ceil(articles_per_week / preferred_days.length)`.

- [ ] **Step 1: Write failing tests** for:
  - `buildScheduleSnapshot(brief.schedule)` → `{ articlesPerDay, preferredDays, weeklyTarget }` incl. the `articles_per_week` fallback.
  - `computeNextRun({ runAtHours, timezone, enabled }, preferredDays, now)` → next ISO datetime where the day-of-week ∈ preferredDays and hour ∈ runAtHours; `null` when `enabled === false`.
```typescript
import { describe, it, expect } from "vitest";
import { buildScheduleSnapshot, computeNextRun } from "../schedule.js";

describe("buildScheduleSnapshot", () => {
  it("uses articles_per_day when present", () => {
    expect(buildScheduleSnapshot({ articles_per_day: 3, preferred_days: ["Monday","Wednesday"] } as any))
      .toEqual({ articlesPerDay: 3, preferredDays: ["Monday","Wednesday"], weeklyTarget: 6 });
  });
  it("falls back to ceil(articles_per_week / days)", () => {
    expect(buildScheduleSnapshot({ articles_per_week: 5, preferred_days: ["Mon","Wed","Fri"] } as any).articlesPerDay).toBe(2);
  });
});

describe("computeNextRun", () => {
  it("returns null when scheduler disabled", () => {
    expect(computeNextRun({ enabled: false, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-07T00:00:00Z"))).toBeNull();
  });
  it("finds the next preferred-day at run hour", () => {
    // 2026-06-07 is a Sunday; next Monday 14:00 ET
    const next = computeNextRun({ enabled: true, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-07T00:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.getUTCDay()).toBe(1); // Monday in UTC after ET 14:00 → 18:00Z, still Monday
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `schedule.ts`.** Use the `Intl.DateTimeFormat` timezone trick (no extra deps) to get the wall-clock day/hour in the configured timezone; iterate forward day-by-day (max 14 days) to find the first slot strictly after `now`. Map day names flexibly (accept `Monday`/`Mon`). `SchedulerConfig` shape = `{ enabled, run_at_hours: number[], timezone }` (matches `dashboard/src/lib/scheduler.ts`).
```typescript
import type { PublishSchedule } from "../types.js"; // brief.schedule type
import type { ScheduleSnapshot } from "./types.js";

export function buildScheduleSnapshot(s: PublishSchedule | undefined): ScheduleSnapshot | null {
  if (!s) return null;
  const days = s.preferred_days ?? [];
  const apd = s.articles_per_day ?? (s.articles_per_week && days.length ? Math.ceil(s.articles_per_week / days.length) : 0);
  return { articlesPerDay: apd, preferredDays: days, weeklyTarget: apd * days.length };
}

export interface SchedulerGate { enabled: boolean; run_at_hours: number[]; timezone: string; }

const DAY_INDEX: Record<string, number> = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
function normDay(d: string): number { return DAY_INDEX[d.trim().toLowerCase().slice(0,3) === "mon" ? "monday" : d.trim().toLowerCase()] ?? DAY_INDEX[d.trim().toLowerCase().slice(0,9)] ?? -1; }

export function computeNextRun(gate: SchedulerGate, preferredDays: string[], now: Date): Date | null {
  if (!gate.enabled || !preferredDays.length || !gate.run_at_hours.length) return null;
  const wanted = new Set(preferredDays.map(normDay).filter((n) => n >= 0));
  const hours = [...gate.run_at_hours].sort((a, b) => a - b);
  for (let addDays = 0; addDays <= 14; addDays++) {
    for (const hour of hours) {
      const cand = atZonedHour(now, gate.timezone, addDays, hour);
      if (cand <= now) continue;
      if (wanted.has(zonedDay(cand, gate.timezone))) return cand;
    }
  }
  return null;
}
// atZonedHour / zonedDay: implement with Intl.DateTimeFormat({timeZone}) to compute the UTC instant
// corresponding to (today+addDays) at `hour`:00 wall-clock in tz, and the weekday of an instant in tz.
```
> If the timezone math via `Intl` proves fiddly under test, it is acceptable to add `date-fns-tz` as a dependency — but prefer `Intl` (zero deps). Keep `now` injected.

- [ ] **Step 4: Run → PASS** (iterate on the `Intl` helpers until the two cases pass; add DST-boundary test if time permits).

- [ ] **Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/schedule.ts services/content-pipeline/src/stats/__tests__/schedule.test.ts
git commit -m "feat(content-pipeline): schedule snapshot + nextRun computation"
```

---

## Task 7: Read repository — aggregations

**Files:**
- Create: `services/content-pipeline/src/stats/repo.ts`
- Test: `services/content-pipeline/src/stats/__tests__/repo.test.ts`

- [ ] **Step 1: Write failing tests** seeding `generation_events` + `image_gen_events` + a `site_stats` doc, then asserting `getSiteStats(domain, now)` returns:
  - `thisWeek.created` (sum of `created` for events with `finishedAt` in the current week, week start = Monday 00:00 in a fixed tz — document the choice; reuse `computeNextRun`'s tz or default UTC),
  - `failedArticles.last7d` / `last30d` (sum of `failed`),
  - `imageGenFailed.last7d` / `last30d` (count of `ok:false`),
  - the rollup fields (`lastAdded`, `lastFailedAt`, `schedule`).
  Also test `getAllSiteStats(now)` returns one entry per `site_stats` doc.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `repo.ts`** with Mongo aggregation pipelines (`$match` on date ranges, `$group`/`$sum`). Build the per-site response object:
```typescript
export interface SiteStatsResponse {
  siteDomain: string;
  schedule: ScheduleSnapshot | null;
  lastAdded: { at: Date | null; source: GenerationSource | null; count: number | null };
  lastFailedAt: Date | null;
  thisWeek: { created: number; expected: number }; // expected = schedule?.weeklyTarget ?? 0
  failedArticles: { last7d: number; last30d: number };
  imageGenFailed: { last7d: number; last30d: number };
  // recentArticles is added by the dashboard layer (Task 11), not here
}
export async function getSiteStats(domain: string, now: Date): Promise<SiteStatsResponse> { /* ... */ }
export async function getAllSiteStats(now: Date): Promise<SiteStatsResponse[]> { /* ... */ }
```
Use a single helper `windowCount(coll, domain, field, sinceDays, now)` to keep it DRY. Week start: define `startOfWeek(now)` = most recent Monday 00:00 UTC.

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/repo.ts services/content-pipeline/src/stats/__tests__/repo.test.ts
git commit -m "feat(content-pipeline): stats read aggregations (getSiteStats/getAllSiteStats)"
```

---

## Task 8: Wire the recorder into all three generation call sites

`source`/`forced`/timing are call-site context. Capture `startedAt` before the call and `finishedAt` after. Build the schedule snapshot from the brief that's already loaded in scope.

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (the `/content-generate` handler, ~lines 748–757) — `source: "dashboard"`, `forced: bypassSchedule`.
- Modify: `services/content-pipeline/src/queue/content-generation.ts` (~lines 104–122) — derive `source` from `job.data.triggeredBy` (`manual`→dashboard, `scheduled`/`scheduled-forced`→scheduler, `wp-import`→wp-import); `forced = triggeredBy==="scheduled-forced" || bypassSchedule`.
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts` (~lines 252–265) — `source: "scheduler"`, `forced` = the run's forced flag.

- [ ] **Step 1 (per call site): capture timing + call recorder after `runContentGeneration` returns.** Pattern:
```typescript
const startedAt = new Date();
const genResult = await runContentGeneration(params, config);
const finishedAt = new Date();
await recordGeneration(
  genResult,
  { source, forced, topicName: params.topicName ?? null, startedAt, finishedAt },
  buildScheduleSnapshot(brief?.schedule), // brief in scope (preloadedBrief in worker/scheduler; read via params in HTTP path — pass null if not loaded)
);
```
> The HTTP `/content-generate` path doesn't preload the brief; pass `schedule: null` there (snapshot will be filled by the scheduler/worker paths, which carry the brief). This matches the spec's "snapshot stamped at generation time" with the documented limitation.

- [ ] **Step 2: Add a small mapper** `sourceFromTriggeredBy(triggeredBy)` in `recorder.ts` (with a unit test) so the worker derivation is DRY and tested:
```typescript
export function sourceFromTriggeredBy(t: string): GenerationSource {
  if (t === "manual") return "dashboard";
  if (t === "wp-import") return "wp-import";
  return "scheduler"; // scheduled / scheduled-forced
}
```
Add `wp-import` to `GenerateJobData.triggeredBy` in `src/queue/types.ts` if the import path enqueues it (verify; the explore noted wp-import jobs exist).

- [ ] **Step 3: Typecheck + run the full content-pipeline test suite.**
Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: PASS (recorder calls compile; no regressions).

- [ ] **Step 4: Commit**
```bash
git add services/content-pipeline/src/agents/content-generation/index.ts services/content-pipeline/src/queue/content-generation.ts services/content-pipeline/src/agents/scheduled-publisher/index.ts services/content-pipeline/src/queue/types.ts services/content-pipeline/src/stats/recorder.ts services/content-pipeline/src/stats/__tests__/build-event.test.ts
git commit -m "feat(content-pipeline): record every generation run (3 call sites)"
```

---

## Task 9: Wire `recordImageGenEvent` into the image callback

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/n8n-image.ts` — inside `handleImageCallback`, **after** the missing-fields guard (lines 494–499) so `site_domain`/`slug` exist. Record `ok:false` on the failure branches (lines 502–515) and `ok:true` on success.

- [ ] **Step 1:** After the guard, capture outcome and record (failure-isolated; do not change return values):
```typescript
const recordOutcome = (ok: boolean, error: string | null) =>
  recordImageGenEvent({
    siteDomain: site_domain, slug, ok,
    provider: payload.meta?.provider ?? null, error, at: new Date(),
  });
```
Call `void recordOutcome(false, reason)` on each failure branch and `void recordOutcome(true, null)` on the success path (after `processN8nImageResult`). `void` so a slow Mongo write never delays the callback (the function is already try/caught internally).

- [ ] **Step 2: Typecheck + test.** `cd services/content-pipeline && pnpm typecheck && pnpm test` → PASS.

- [ ] **Step 3: Commit**
```bash
git add services/content-pipeline/src/agents/content-generation/n8n-image.ts
git commit -m "feat(content-pipeline): record image-gen outcomes from n8n callback"
```

---

## Task 10: content-pipeline `GET /site-stats[/:domain]` routes + index bootstrap

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (add routes in `handleRequest`; call `ensureStatsIndexes()` once at server boot, failure-isolated).

- [ ] **Step 1: Write a failing test** at the route-handler level if a handler is extracted, or a thin integration test that imports `getAllSiteStats`/`getSiteStats` (already covered in Task 7). Minimum: add a unit test for a small `parseSiteStatsPath(url)` helper that maps `/site-stats` → all, `/site-stats/travelswire` → that domain.

- [ ] **Step 2: Add routes** near the other GET routes (before the `/content-generate` 404 fallthrough):
```typescript
if (req.method === "GET" && req.url === "/site-stats") {
  const data = await getAllSiteStats(new Date());
  sendJson(res, 200, { status: "ok", sites: data });
  return;
}
if (req.method === "GET" && req.url?.startsWith("/site-stats/")) {
  const domain = decodeURIComponent(req.url.slice("/site-stats/".length));
  const data = await getSiteStats(domain, new Date());
  sendJson(res, 200, { status: "ok", site: data });
  return;
}
```
Wrap the body in try/catch → on Mongo failure `sendJson(res, 503, { status: "error", message })`.

- [ ] **Step 3: Bootstrap indexes** in the `server.listen` callback:
```typescript
ensureStatsIndexes().catch((e) => console.error(`[stats] ensureStatsIndexes failed (non-fatal): ${e?.message}`));
```

- [ ] **Step 4: Typecheck + test → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): GET /site-stats[/:domain] routes + index bootstrap"
```

---

## Task 11: Dashboard proxy + enrichment (recentArticles, nextRun)

**Files:**
- Create: `services/dashboard/src/lib/site-stats.ts` (enrichment helpers)
- Create: `services/dashboard/src/app/api/site-stats/route.ts` (all sites)
- Create: `services/dashboard/src/app/api/site-stats/[domain]/route.ts` (single)
- Test: `services/dashboard/src/lib/__tests__/site-stats.test.ts`

- [ ] **Step 1: Write failing test** for `recentArticles(domain, articles, n=5)` — sorts by `publishDate` desc, takes N, maps `{ title, score: quality_score ?? null, status, slug, publishDate }`, and for `status` passes through `published`/`review`/`draft`. Use fixture article objects (don't hit the network in the unit test).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `site-stats.ts`:**
  - `recentArticles(domain, branch)`: enumerate via the existing `readArticlesWithKVFallback(domain, branch, readArticles)`; for the top-N slugs, ensure `quality_score` is present — if the KV path returns `score: undefined`, fall back to the Git frontmatter read (`readArticles`/article-detail read path) for those N slugs. Cache with the existing pattern; invalidate via `invalidateSiteCaches` (landmine #45).
  - `nextRunFor(domain, scheduleSnapshot)`: read `readSchedulerConfig()` once per request (memoize across the all-sites call) and call the content-pipeline `computeNextRun` logic — **port** `computeNextRun` into a shared util OR duplicate minimally in the dashboard (it's pure). Prefer adding it to `packages/shared-types` (or a shared util) and importing in both services to avoid drift.

- [ ] **Step 4: Implement the routes** using the proxy pattern from `api/agent/generate/route.ts` (`getAgentUrl()` with the `content-pipeline-app` → `localhost:5000` fallback, landmine #4):
```typescript
// GET /api/site-stats
export async function GET(): Promise<NextResponse> {
  const agentUrl = getAgentUrl();
  const res = await fetch(`${agentUrl}/site-stats`);
  const body = await res.json() as { sites: SiteStatsResponse[] };
  const gate = await readSchedulerConfig();
  const enriched = await Promise.all(body.sites.map(async (s) => ({
    ...s,
    schedule: s.schedule ? { ...s.schedule, nextRun: computeNextRun(gate, s.schedule.preferredDays, new Date()) } : null,
    recentArticles: await recentArticles(s.siteDomain, `staging/${s.siteDomain}`),
  })));
  return NextResponse.json({ sites: enriched });
}
```
The `[domain]/route.ts` mirrors this for a single site. List all sites from `dashboard-index.yaml` for the all-sites variant if a site has no Mongo doc yet (merge: stats default to nulls). Verify whether `/api/*` is auth-gated (landmine #35 says middleware excludes `/api/`); if these must be authenticated for external consumers, follow the same auth treatment as other read routes (e.g. `/api/review`).

- [ ] **Step 5: Typecheck + test.**
Run: `cd services/dashboard && pnpm typecheck && pnpm vitest run src/lib/__tests__/site-stats.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add services/dashboard/src/lib/site-stats.ts services/dashboard/src/app/api/site-stats services/dashboard/src/lib/__tests__/site-stats.test.ts
git commit -m "feat(dashboard): /api/site-stats proxy + recentArticles/nextRun enrichment"
```

---

## Task 12: Backfill from `scheduler/history.json` (one-time, idempotent)

**Files:**
- Create: `services/content-pipeline/src/stats/backfill.ts`
- Test: `services/content-pipeline/src/stats/__tests__/backfill.test.ts`

- [ ] **Step 1: Write failing test** that feeds a `SchedulerRunEntry[]` fixture (shape from `scheduled-publisher/history.ts`: `{ timestamp, timezone, forced, sites:[{domain,status,articlesCreated,articlesRequested,message}], skipped }`) into `backfillFromHistory(entries)` and asserts:
  - one `generation_events` doc per `sites[]` entry with a deterministic `_id` = `${timestamp}:${domain}`, `source:"scheduler"`, `created=articlesCreated`, `requested=articlesRequested`;
  - running it twice does not duplicate (idempotent upsert by `_id`);
  - `site_stats` rebuilt (lastAdded/lastFailed/totalCreated) consistent with the events.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `backfill.ts`:** map entries → events (`failed = max(requested-created,0)` as a proxy; `finishedAt=startedAt=new Date(timestamp)`), `upsert` by deterministic `_id`, then recompute `site_stats` for each affected domain (reuse the same rollup rules — extract a `applyRollup(event)` from Task 4 so backfill and live path share it). Add a runnable entry (a `main()` that reads `scheduler/history.json` via Octokit `readFile` and calls `backfillFromHistory`), invokable via `pnpm tsx src/stats/backfill.ts` or a one-off CloudGrid job.

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/stats/backfill.ts services/content-pipeline/src/stats/__tests__/backfill.test.ts
git commit -m "feat(content-pipeline): idempotent stats backfill from history.json"
```

---

## Task 13: CloudGrid Mongo binding + deploy wiring

**Files:**
- Modify: `cloudgrid.yaml`

- [ ] **Step 1: Add the Mongo backing store** to `requires:` (confirmed supported) and document the injected env var. Mirror the existing `- redis: private` shape:
```yaml
requires:
  - redis: private
  - mongodb: private
```
Add a comment under the `content-pipeline` service noting `MONGODB_URL` is auto-injected by `requires: mongodb: private` (verify the exact injected var name against CloudGrid docs; if it differs, set `MONGODB_URL` from it via `env:` mapping). The dashboard does **not** need Mongo (it only proxies).

- [ ] **Step 2: Verify build.**
Run: `cd services/content-pipeline && pnpm typecheck && pnpm test` and `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add cloudgrid.yaml
git commit -m "chore: declare mongodb backing store for content-pipeline"
```

---

## Final verification

- [ ] `cd services/content-pipeline && pnpm typecheck && pnpm test` → all green.
- [ ] `cd services/dashboard && pnpm typecheck && pnpm test` → all green.
- [ ] Manual smoke (optional, local): with `MONGODB_URL` pointing at a local Mongo, `cloudgrid dev`, trigger a generate via the dashboard, then `curl http://localhost:5000/site-stats` and confirm the site appears with `lastAdded`. `curl http://localhost:3001/api/site-stats` returns the enriched payload.
- [ ] Confirm no secret files staged; commits are scoped (never `git add -A`).

## Notes for the implementer
- Do not break generation on Mongo errors — the failure-isolation tests (Task 4 step 1, Task 5) guard this; keep them green.
- `computeNextRun` is shared between services — put it in `packages/shared-types` (or a shared util) and import in both to avoid drift.
- This plan is the **foundation**: the Checks, Costs, and Alerts plans depend on `lib/mongo.ts`, the `/site-stats` route conventions, and the dashboard proxy pattern established here.
