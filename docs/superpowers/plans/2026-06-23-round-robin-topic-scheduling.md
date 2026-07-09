# Round-Robin Topic Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken two-layer scheduling system (site-level gate + per-topic day eligibility) with a single site-level schedule and round-robin topic rotation tracked in MongoDB.

**Architecture:** The site-level `brief.schedule` (already exists in `ContentAgentTab`) becomes the sole schedule. Per-topic `schedule.preferred_days` is removed from the generation path. A new `topicRotation` field in MongoDB's `site_stats` collection tracks which topics were last served. The content generation agent picks the next N topics in rotation order instead of filtering by day eligibility. Manual per-topic generation (`topicName`) is unchanged.

**Tech Stack:** TypeScript, MongoDB, Next.js App Router, Node HTTP server

---

## Current vs. New Behavior

| Scenario | Current | New |
|---|---|---|
| Scheduler fires? | `brief.schedule.preferred_days` (site-level) | Same — unchanged |
| How many articles? | `brief.schedule.articles_per_day` (site-level) | Same — unchanged |
| Which topics? | `isTopicEligibleToday(topic.schedule)` — filter by day | Round-robin from `site_stats.topicRotation.nextIndex` |
| Topic fairness | First N in array always win, rest starved | Every topic served in turn across runs |
| Per-topic schedule UI | `articles_per_week` + day buttons per topic | Removed — schedule is site-level only |
| Manual "Generate" button per topic | Works (passes `topicName`) | Same — unchanged |
| Manual "Generate N Articles" (no topic) | All topics, distribute evenly | Same — unchanged |

## File Structure

### New files
| File | Responsibility |
|---|---|
| `services/content-pipeline/src/stats/topic-rotation.ts` | MongoDB read/write for `topicRotation` state |
| `services/content-pipeline/src/stats/__tests__/topic-rotation.test.ts` | Unit tests for round-robin selection logic |

### Modified files
| File | Change |
|---|---|
| `services/content-pipeline/src/stats/types.ts` | Add `TopicRotation` interface to `SiteStats` |
| `services/content-pipeline/src/agents/content-generation/agent.ts` | `runPerTopicGeneration`: use round-robin for scheduler-triggered runs; add null guards for optional `topic.schedule` |
| `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts` | Add internal null guards to `computePerRunTarget` and `isTopicEligibleToday` for optional `schedule` |
| `services/content-pipeline/src/stats/schedule.ts` | `buildScheduleFromBrief`: for topics_v2 sites, use site-level `brief.schedule` instead of aggregating per-topic schedules |
| `services/content-pipeline/src/stats/weekly-summary.ts` | `getWeeklySummary`: accept optional `scheduleOverrides` map |
| `services/content-pipeline/src/agents/content-generation/index.ts` | `/scheduler-summary` endpoint: load briefs, pass schedule overrides |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | Update stale "check per-topic preferred_days" log message |
| `services/dashboard/src/lib/site-stats.ts` | `buildScheduleFromBrief`: same change as pipeline — use site-level schedule for topics_v2 |
| `services/dashboard/src/components/site-detail/TopicEditModal.tsx` | Remove schedule section (lines 175-194) |
| `services/dashboard/src/components/site-detail/TopicsListPanel.tsx` | Remove per-topic schedule display (line 340-341) |
| `packages/shared-types/src/config.ts` | Make `TopicV2.schedule` optional |

### Unchanged files (explicitly analyzed)
| File | Why no changes needed |
|---|---|
| `services/content-pipeline/src/queue/content-generation.ts` | Queue worker calls `runContentGeneration` (which internally uses round-robin) and `buildScheduleSnapshot(brief.schedule)` — already uses site-level schedule directly, no per-topic aggregation |

---

## Task 1: Add TopicRotation Type

**Files:**
- Modify: `services/content-pipeline/src/stats/types.ts`

- [ ] **Step 1: Add TopicRotation interface and update SiteStats**

In `services/content-pipeline/src/stats/types.ts`, add after the `ScheduleSnapshot` interface:

```typescript
/** Round-robin topic rotation state, persisted per site in site_stats. */
export interface TopicRotation {
  /** Index into the site's topics_v2 array for the next run. Wraps via modulo. */
  nextIndex: number;
  /** Topic names served in the most recent run (for dashboard display). */
  lastServed: string[];
  /** When the rotation was last advanced. */
  updatedAt: Date;
}
```

Add to the `SiteStats` interface:

```typescript
export interface SiteStats {
  // ... existing fields ...
  topicRotation: TopicRotation | null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: May have errors in recorder.ts or other files that construct SiteStats — fix with `topicRotation: null` defaults.

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/stats/types.ts
git commit -m "feat(pipeline): add TopicRotation type to SiteStats"
```

---

## Task 2: Round-Robin Selection Logic + MongoDB Helpers

**Files:**
- Create: `services/content-pipeline/src/stats/topic-rotation.ts`
- Create: `services/content-pipeline/src/stats/__tests__/topic-rotation.test.ts`

- [ ] **Step 1: Write failing tests for selectTopicsRoundRobin**

Create `services/content-pipeline/src/stats/__tests__/topic-rotation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectTopicsRoundRobin } from "../topic-rotation.js";

describe("selectTopicsRoundRobin", () => {
  const topics = ["Tech", "Travel", "Food", "Sports", "Music"];

  it("picks first N topics when nextIndex is 0", () => {
    const result = selectTopicsRoundRobin(topics, 2, 0);
    expect(result.selected).toEqual(["Tech", "Travel"]);
    expect(result.newNextIndex).toBe(2);
  });

  it("wraps around when nextIndex + count exceeds length", () => {
    const result = selectTopicsRoundRobin(topics, 2, 4);
    expect(result.selected).toEqual(["Music", "Tech"]);
    expect(result.newNextIndex).toBe(1);
  });

  it("handles count >= topics length (full cycle)", () => {
    const result = selectTopicsRoundRobin(topics, 5, 0);
    expect(result.selected).toEqual(["Tech", "Travel", "Food", "Sports", "Music"]);
    expect(result.newNextIndex).toBe(0);
  });

  it("handles count > topics length (wraps multiple times)", () => {
    const result = selectTopicsRoundRobin(topics, 7, 0);
    expect(result.selected).toEqual(["Tech", "Travel", "Food", "Sports", "Music", "Tech", "Travel"]);
    expect(result.newNextIndex).toBe(2);
  });

  it("clamps nextIndex when it exceeds array length (topic removed)", () => {
    const result = selectTopicsRoundRobin(topics, 2, 99);
    // 99 % 5 = 4 → starts at index 4
    expect(result.selected).toEqual(["Music", "Tech"]);
    expect(result.newNextIndex).toBe(1);
  });

  it("returns empty when topics array is empty", () => {
    const result = selectTopicsRoundRobin([], 3, 0);
    expect(result.selected).toEqual([]);
    expect(result.newNextIndex).toBe(0);
  });

  it("returns empty when count is 0", () => {
    const result = selectTopicsRoundRobin(topics, 0, 2);
    expect(result.selected).toEqual([]);
    expect(result.newNextIndex).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- src/stats/__tests__/topic-rotation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement selectTopicsRoundRobin and MongoDB helpers**

Create `services/content-pipeline/src/stats/topic-rotation.ts`:

```typescript
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { TopicRotation } from "./types.js";

/**
 * Pure function: pick the next `count` topic names from `topicNames` starting
 * at `nextIndex`, wrapping around. Returns the selected names and the new index.
 */
export function selectTopicsRoundRobin(
  topicNames: string[],
  count: number,
  nextIndex: number,
): { selected: string[]; newNextIndex: number } {
  if (topicNames.length === 0 || count <= 0) {
    return { selected: [], newNextIndex: nextIndex };
  }
  const start = nextIndex % topicNames.length;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(topicNames[(start + i) % topicNames.length]!);
  }
  const newNextIndex = (start + count) % topicNames.length;
  return { selected, newNextIndex };
}

/**
 * Read the current topic rotation state for a site from MongoDB.
 * Returns null if no rotation has been recorded yet.
 */
export async function readTopicRotation(
  siteDomain: string,
): Promise<TopicRotation | null> {
  const db = await getMongoDb();
  const doc = await db.collection(COLLECTIONS.siteStats).findOne(
    { _id: siteDomain as any },
    { projection: { topicRotation: 1 } },
  );
  return (doc as any)?.topicRotation ?? null;
}

/**
 * Persist updated topic rotation state after a scheduler run.
 */
export async function saveTopicRotation(
  siteDomain: string,
  rotation: TopicRotation,
): Promise<void> {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.siteStats).updateOne(
    { _id: siteDomain as any },
    { $set: { topicRotation: rotation } },
    { upsert: true },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- src/stats/__tests__/topic-rotation.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/stats/topic-rotation.ts services/content-pipeline/src/stats/__tests__/topic-rotation.test.ts
git commit -m "feat(pipeline): add round-robin topic selection logic and MongoDB helpers"
```

---

## Task 3: Wire Round-Robin into Content Generation Agent

This is the core behavior change. When `source === "scheduler"` (no `topicName`, no `bypassSchedule`), the agent uses round-robin instead of day-based eligibility.

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts` (~lines 1197-1270)

- [ ] **Step 1: Import rotation helpers**

At the top of `agent.ts`, add:

```typescript
import { selectTopicsRoundRobin, readTopicRotation, saveTopicRotation } from "../../stats/topic-rotation.js";
```

- [ ] **Step 2: Replace topic eligibility logic in runPerTopicGeneration**

Find the block at approximately lines 1207-1268 that handles topic selection. The current logic is:

```typescript
// Current: three paths — manual single topic, manual all, scheduler day-filter
let eligibleTopics: TopicV2[];
if (args.topicName) {
  // ... find specific topic ...
  eligibleTopics = [target];
} else if (args.bypassSchedule) {
  eligibleTopics = topics;
} else {
  eligibleTopics = topics.filter((t) => isTopicEligibleToday(t.schedule, new Date(), args.timezone));
}

// ... dedup sets ...

let remainingTotal = args.count != null ? args.count : Infinity;

for (const topic of eligibleTopics) {
  if (remainingTotal <= 0) break;
  const scheduledPerRun = args.topicName
    ? Math.max(1, args.count ?? 1)
    : computePerRunTarget(topic.schedule);
  // ...
```

Replace the scheduler path (the `else` branch and the loop logic) with round-robin.

**IMPORTANT:** Read the rotation state ONCE before generation. Compute both `selected` and `newNextIndex` from the same read to avoid race conditions (generation can take 30+ seconds; a concurrent run could advance the index between two separate reads).

```typescript
let eligibleTopics: TopicV2[];
let isRoundRobin = false;
let roundRobinNewNextIndex = 0;  // Computed once, saved after generation

if (args.topicName) {
  // Manual single-topic trigger — unchanged
  // ... existing code ...
  eligibleTopics = [target];
} else if (args.bypassSchedule) {
  // Manual dashboard "Generate N Articles" — all topics, unchanged
  eligibleTopics = topics;
} else {
  // Scheduler path — round-robin topic selection
  isRoundRobin = true;
  const count = args.count ?? topics.length;
  const rotation = await readTopicRotation(siteDomain);
  const startIndex = rotation?.nextIndex ?? 0;
  const topicNames = topics.map((t) => t.name);
  const { selected, newNextIndex } = selectTopicsRoundRobin(topicNames, count, startIndex);
  roundRobinNewNextIndex = newNextIndex;

  // Map selected names back to TopicV2 objects (preserves rotation order)
  const topicByName = new Map(topics.map((t) => [t.name, t]));
  eligibleTopics = selected.map((name) => topicByName.get(name)!).filter(Boolean);

  console.log(
    `[agent] [per-topic] round-robin on ${siteDomain}: ` +
    `picked ${eligibleTopics.map((t) => t.name).join(", ")} ` +
    `(nextIndex was ${startIndex}, advancing to ${newNextIndex})`,
  );
}
```

Then in the topic iteration loop, change per-topic target for the round-robin path:

```typescript
for (const topic of eligibleTopics) {
  if (remainingTotal <= 0) break;

  const scheduledPerRun = args.topicName
    ? Math.max(1, args.count ?? 1)
    : isRoundRobin
      ? 1  // Round-robin: 1 article per topic per turn
      : computePerRunTarget(topic.schedule ?? { articles_per_week: 0, preferred_days: [] });

  // ... rest of loop unchanged ...
```

Also fix the `requestedCount` calculation (around line 1418) to handle optional `schedule`:

```typescript
const requestedCount =
  args.count ??
  eligibleTopics.reduce(
    (s, t) => s + computePerRunTarget(t.schedule ?? { articles_per_week: 0, preferred_days: [] }),
    0,
  );
```

- [ ] **Step 3: Save rotation state after generation**

After the topic loop completes (before the return statement in `runPerTopicGeneration`), add. Uses the `roundRobinNewNextIndex` computed in Step 2 (same read, no second MongoDB query):

```typescript
// Persist round-robin rotation state (uses newNextIndex from the single read in Step 2)
if (isRoundRobin && topics.length > 0) {
  await saveTopicRotation(siteDomain, {
    nextIndex: roundRobinNewNextIndex,
    lastServed: eligibleTopics.map((t) => t.name),
    updatedAt: new Date(),
  }).catch((err) => {
    console.error(`[agent] Failed to save topic rotation for ${siteDomain}:`, err);
  });
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`

- [ ] **Step 5: Run existing tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: All tests pass (the agent tests mock the content generation; this change only affects the topic selection path)

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts
git commit -m "feat(pipeline): use round-robin topic selection for scheduler runs"
```

---

## Task 4: Fix Schedule Builders (Pipeline + Dashboard)

`buildScheduleFromBrief` currently aggregates per-topic schedules into a synthetic `ScheduleSnapshot`. This produced wrong `articlesPerDay` and `preferredDays`. For topics_v2 sites, it should use the site-level `brief.schedule` instead.

**Files:**
- Modify: `services/content-pipeline/src/stats/schedule.ts`
- Modify: `services/dashboard/src/lib/site-stats.ts`

- [ ] **Step 1: Fix pipeline buildScheduleFromBrief**

In `services/content-pipeline/src/stats/schedule.ts`, change `buildScheduleFromBrief`:

```typescript
export function buildScheduleFromBrief(
  brief: SiteBrief | undefined | null,
): ScheduleSnapshot | null {
  if (!brief) return null;
  // Both topics_v2 and legacy sites use brief.schedule as the single
  // source of truth for when/how-many. Per-topic schedules are deprecated
  // in favor of round-robin rotation.
  return buildScheduleSnapshot(brief.schedule);
}
```

This removes the `scheduleFromTopics` call. The `scheduleFromTopics` function and `capitalizeDay` helper can stay (dead code cleanup is optional — don't remove in this PR to keep the diff focused).

- [ ] **Step 2: Fix dashboard buildScheduleFromBrief**

In `services/dashboard/src/lib/site-stats.ts`, apply the same change to the dashboard's copy of `buildScheduleFromBrief`:

```typescript
export function buildScheduleFromBrief(
  brief: Record<string, unknown> | undefined | null,
): ScheduleSnapshot | null {
  if (!brief) return null;
  // Both topics_v2 and legacy sites use brief.schedule as the single
  // source of truth. Per-topic schedules are deprecated (round-robin).
  const schedule = brief.schedule as Record<string, unknown> | undefined;
  return schedule ? scheduleFromSiteLevel(schedule) : null;
}
```

- [ ] **Step 3: Run typecheck on both services**

Run: `cd services/content-pipeline && pnpm typecheck && cd ../dashboard && pnpm typecheck`

- [ ] **Step 4: Run tests on both services**

Run: `cd services/content-pipeline && pnpm test && cd ../dashboard && pnpm test`

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/stats/schedule.ts services/dashboard/src/lib/site-stats.ts
git commit -m "fix: buildScheduleFromBrief uses site-level schedule for all sites"
```

---

## Task 5: Remove Per-Topic Schedule from Dashboard UI

**Files:**
- Modify: `services/dashboard/src/components/site-detail/TopicEditModal.tsx`
- Modify: `services/dashboard/src/components/site-detail/TopicsListPanel.tsx`
- Modify: `packages/shared-types/src/config.ts`

- [ ] **Step 1: Make TopicV2.schedule optional in shared-types**

In `packages/shared-types/src/config.ts`, change:

```typescript
export interface TopicV2 {
  name: string;
  description?: string;
  source: TopicV2Source;
  /** @deprecated Per-topic schedule is deprecated. Use site-level brief.schedule
   *  with round-robin rotation instead. Kept optional for backward compatibility. */
  schedule?: TopicV2Schedule;
}
```

- [ ] **Step 2: Add internal null guards to per-topic-fetch.ts functions**

In `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts`, add null guards **inside** the functions themselves (not just at call sites), since `TopicV2["schedule"]` now resolves to `TopicV2Schedule | undefined`:

```typescript
export function computePerRunTarget(schedule: TopicV2["schedule"]): number {
  if (!schedule || !schedule.articles_per_week || schedule.articles_per_week <= 0) return 0;
  const daysCount = schedule.preferred_days.length;
  if (daysCount === 0) return 0;
  return Math.ceil(schedule.articles_per_week / daysCount);
}

export function isTopicEligibleToday(
  schedule: TopicV2["schedule"],
  now: Date = new Date(),
  timezone?: string,
): boolean {
  if (!schedule) return false;
  if (computePerRunTarget(schedule) === 0) return false;
  // ... rest unchanged ...
}
```

- [ ] **Step 2b: Fix remaining TypeScript errors from optional schedule**

Run `pnpm typecheck` from the repo root. Key additional locations:

- `content-pipeline/src/stats/schedule.ts`: `scheduleFromTopics` accesses `topic.schedule` → add `if (!topic.schedule) continue;`
- `content-pipeline/src/agents/content-generation/agent.ts` line ~1418: `requestedCount` reduce → already fixed in Task 3 with fallback

Fix each remaining error with optional chain or null guard.

- [ ] **Step 3: Remove schedule section from TopicEditModal**

In `services/dashboard/src/components/site-detail/TopicEditModal.tsx`:

1. Remove the `schedule` state on line 29
2. Remove the schedule section (lines 175-194: the `{/* Schedule */}` block)
3. Remove `schedule` from the `onSave` call on line 73 — pass `undefined` or omit it
4. Remove `DAYS` constant (line 9) and `TopicV2Schedule` import (line 4)

The `handleSave` becomes:

```typescript
function handleSave(): void {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  const lowerName = trimmedName.toLowerCase();
  const conflict = existingNames.some((n) => n.toLowerCase() === lowerName && n !== initial?.name);
  if (conflict) {
    alert(`A topic named "${trimmedName}" already exists on this site.`);
    return;
  }
  onSave({ name: trimmedName, description: description.trim() || undefined, source });
}
```

- [ ] **Step 4: Remove per-topic schedule display from TopicsListPanel**

In `services/dashboard/src/components/site-detail/TopicsListPanel.tsx`, remove lines 339-342:

```typescript
// Remove this block:
<span className="ml-2">
  {topic.schedule.articles_per_week}/week &middot;{" "}
  {topic.schedule.preferred_days.map((d) => d.slice(0, 3)).join(", ")}
</span>
```

- [ ] **Step 5: Run typecheck and tests**

Run: `pnpm typecheck && cd services/dashboard && pnpm test`

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/config.ts \
  services/dashboard/src/components/site-detail/TopicEditModal.tsx \
  services/dashboard/src/components/site-detail/TopicsListPanel.tsx \
  services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts \
  services/content-pipeline/src/agents/content-generation/agent.ts \
  services/content-pipeline/src/stats/schedule.ts
git commit -m "feat(dashboard): remove per-topic schedule UI, make TopicV2.schedule optional"
```

---

## Task 6: Fix Scheduler Summary Expected Counts

The Scheduler Summary page pre-fills expected counts from `site_stats.schedule` in MongoDB. After Task 4, `buildScheduleFromBrief` uses the site-level schedule, so new schedule snapshots will be correct. But the `weekly-summary.ts` pre-fill logic also needs to read from briefs (same pattern as the `/api/site-stats` fix).

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (the `/scheduler-summary` endpoint)

- [ ] **Step 1: Enrich schedule from briefs in the /scheduler-summary endpoint**

In the `/scheduler-summary` handler (around line 846), add brief-based schedule enrichment before calling `getWeeklySummary`. The approach: after `getWeeklySummary` returns, override the expected counts using brief-computed schedules. Alternatively, pass a schedule override map to `getWeeklySummary`.

The simplest approach: modify the `/scheduler-summary` endpoint to load briefs for all sites and pass the correct schedule map to `getWeeklySummary`. Since `getWeeklySummary` already reads `site_stats.schedule` from MongoDB, and after Task 4 the schedule snapshots written there will be correct for new runs, this task is mainly about fixing the existing stale data.

The `/scheduler-summary` endpoint should load briefs and build correct schedules, then pass them as overrides:

```typescript
if (req.method === "GET" && pathname === "/scheduler-summary") {
  try {
    const timezone = await getSchedulerTimezone(config);
    // Load briefs to compute correct schedules (overrides stale MongoDB data)
    const octokit = createOctokit(config.github);
    const activeSites = await listActiveSites(octokit, config.networkRepo);
    const scheduleOverrides = new Map<string, ScheduleSnapshot>();
    await Promise.all(
      activeSites.map(async (site) => {
        try {
          const { data } = await readSiteBriefWithFallback(
            octokit, config.networkRepo, site.domain, site.branch,
          );
          const schedule = buildScheduleFromBrief(data.brief);
          if (schedule) scheduleOverrides.set(site.domain, schedule);
        } catch { /* skip */ }
      }),
    );
    const summary = await getWeeklySummary(timezone, new Date(), scheduleOverrides);
    sendJson(res, 200, summary as unknown as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  }
  return;
}
```

- [ ] **Step 2: Update getWeeklySummary to accept schedule overrides**

In `services/content-pipeline/src/stats/weekly-summary.ts`, add an optional `scheduleOverrides` parameter to `getWeeklySummary`:

```typescript
export async function getWeeklySummary(
  timezone: string,
  now: Date = new Date(),
  scheduleOverrides?: Map<string, ScheduleSnapshot>,
): Promise<SchedulerSummaryResponse> {
```

Then in the pre-fill logic (around line 195), prefer the override when available:

```typescript
const schedule = scheduleOverrides?.get(domain) ?? scheduleMap.get(domain);
```

- [ ] **Step 3: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts \
  services/content-pipeline/src/stats/weekly-summary.ts
git commit -m "fix(pipeline): scheduler summary uses brief-computed schedules"
```

---

## Task 7: Verify End-to-End + Cleanup

- [ ] **Step 1: Run full typecheck on all packages**

```bash
pnpm typecheck
```

- [ ] **Step 2: Run all tests**

```bash
cd services/dashboard && pnpm test
cd ../content-pipeline && pnpm test
```

- [ ] **Step 3: Verify the scheduled-publisher still uses brief.schedule correctly**

Read `services/content-pipeline/src/agents/scheduled-publisher/index.ts` lines 234-251. Confirm:
- It reads `brief.schedule` (site-level) for `isTodayPreferredDay` — correct, no change needed
- It reads `resolveArticlesPerDay(schedule)` for count — correct, no change needed
- It passes `count: articlesPerDay` to `runContentGeneration` — correct, the agent uses this as the round-robin batch size

- [ ] **Step 3b: Update stale log message in scheduled-publisher**

In `services/content-pipeline/src/agents/scheduled-publisher/index.ts` around line 298-299, change:

```typescript
// Old:
siteMessage = "No topics eligible to run today (check per-topic preferred_days)";
// New:
siteMessage = "No topics configured on this site";
```

- [ ] **Step 4: Final commit if any remaining changes**

```bash
git add -p  # Stage specific changes
git commit -m "chore: round-robin scheduling cleanup"
```

---

## Migration Notes (Post-Deploy)

After deploying both services:

1. **MongoDB `site_stats.schedule` will self-correct** — the next scheduler run for each site will call `recordGeneration` with `buildScheduleFromBrief(brief)`, which now uses the site-level schedule. No manual migration needed.

2. **Existing `topics_v2[*].schedule` in site.yaml files** — these fields stay in the YAML but are ignored. No need to edit existing configs. New topics created via the dashboard won't have a `schedule` field.

3. **`topicRotation` state starts fresh** — first scheduler run after deploy will start all sites at `nextIndex: 0`. This is correct behavior (topic 1 goes first, then rotates).

4. **Sites with misconfigured `brief.schedule`** — if a topics_v2 site has wrong `articles_per_day` or `preferred_days` in its site-level schedule, the user must fix it via the Content Agent tab in the dashboard. The per-topic schedule fields are no longer used.

5. **Verify all topics_v2 sites have `brief.schedule`** — sites set up before site-level scheduling was standard may lack `brief.schedule` entirely. These sites will show no schedule in the dashboard and be skipped by the scheduler (already the case, but the `scheduleFromTopics` fallback previously masked this). Check the dashboard and add `brief.schedule` to any sites missing it.

## Rollback

If round-robin causes issues, revert the agent.ts change (Task 3). The `isTopicEligibleToday` path is still intact as the `bypassSchedule` manual path. The type changes (optional `schedule`) and schedule builder changes are safe to keep regardless.
