# Content Generation Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs in the content generation pipeline: timezone-unaware topic eligibility, dedup index overwrite, missing dedup index after migration, and unclear scheduler error messages.

**Architecture:** All fixes are in `services/content-pipeline/src/`. The timezone fix threads the scheduler timezone through ContentGenerationParams to `isTopicEligibleToday`. The dedup fix merges existing articles with new ones before writing the index. The migration fix adds dedup index creation after article import. The error message fix surfaces the actual reason (no eligible topics vs no aggregator items).

**Tech Stack:** TypeScript, Vitest, BullMQ

---

### Task 1: Fix timezone-unaware + case-sensitive `isTopicEligibleToday`

**Root cause:** `isTopicEligibleToday()` uses `new Date().getDay()` which returns the day in the server's timezone (UTC on CloudGrid). The site-level scheduler uses `currentDayNameInTimezone(timezone)` which respects the configured timezone. When the UTC day differs from the configured timezone's day (e.g., 11 PM EST Monday = 4 AM Tuesday UTC), all topics fail eligibility even though the site passed the site-level day check. Additionally, the comparison is case-sensitive (`includes`) while the site-level check uses case-insensitive comparison.

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts:34-42`
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:86-111` (add timezone to ContentGenerationParams)
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:1166-1186` (thread timezone to runPerTopicGeneration)
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:1241` (pass timezone to isTopicEligibleToday)
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts:258-272` (pass timezone)
- Modify: `services/content-pipeline/src/queue/types.ts:3-14` (add timezone to GenerateJobData)
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts:79-91` (include timezone in child jobs)
- Modify: `services/content-pipeline/src/queue/content-generation.ts:51,109-121` (thread timezone)
- Test: `services/content-pipeline/src/__tests__/per-topic-fetch.test.ts`

- [ ] **Step 1: Write failing tests for timezone and case sensitivity**

Add to `services/content-pipeline/src/__tests__/per-topic-fetch.test.ts`:

```typescript
it("returns true when preferred_days uses different casing", () => {
  expect(
    isTopicEligibleToday(
      { articles_per_week: 1, preferred_days: ["tuesday"] },
      TUESDAY,
    ),
  ).toBe(true);
  expect(
    isTopicEligibleToday(
      { articles_per_week: 1, preferred_days: ["TUESDAY"] },
      TUESDAY,
    ),
  ).toBe(true);
});

it("accepts timezone parameter and uses it for day calculation", () => {
  // 2026-06-01 23:00 EST = 2026-06-02 04:00 UTC (Monday night EST = Tuesday morning UTC)
  // In UTC this is Tuesday, but in America/New_York it's Monday
  const mondayNightEST = new Date("2026-06-02T03:00:00Z"); // 11 PM EST Monday
  expect(
    isTopicEligibleToday(
      { articles_per_week: 1, preferred_days: ["Monday"] },
      mondayNightEST,
      "America/New_York",
    ),
  ).toBe(true);
  // Without timezone, server (UTC) says Tuesday — should fail for Monday-only
  expect(
    isTopicEligibleToday(
      { articles_per_week: 1, preferred_days: ["Monday"] },
      mondayNightEST,
    ),
  ).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/per-topic-fetch.test.ts`
Expected: 2 new tests FAIL

- [ ] **Step 3: Update `isTopicEligibleToday` signature and implementation**

In `services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts`, change `isTopicEligibleToday` to accept an optional timezone parameter and do case-insensitive comparison:

```typescript
/** Check whether the given date falls on one of this topic's preferred days.
 *  When `timezone` is provided, the day name is resolved in that timezone
 *  (matching the site-level check in the scheduler). Without it, falls back
 *  to the local server timezone via `Date.getDay()`. */
export function isTopicEligibleToday(
  schedule: TopicV2["schedule"],
  now: Date = new Date(),
  timezone?: string,
): boolean {
  if (computePerRunTarget(schedule) === 0) return false;

  let dayName: string;
  if (timezone) {
    try {
      dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: timezone,
      }).format(now);
    } catch {
      dayName = DAY_NAMES[now.getDay()] as string;
    }
  } else {
    dayName = DAY_NAMES[now.getDay()] as string;
  }

  if (dayName === undefined) return false;
  const dayLower = dayName.toLowerCase();
  return schedule.preferred_days.some((d) => d.toLowerCase() === dayLower);
}
```

- [ ] **Step 4: Run per-topic-fetch tests to verify they pass**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/per-topic-fetch.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Add `timezone` to `ContentGenerationParams`**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, add to `ContentGenerationParams` (around line 100, after `bypassSchedule`):

```typescript
  /** Scheduler timezone — threaded to isTopicEligibleToday so the per-topic
   *  day check matches the site-level check. Without this, the server's local
   *  timezone (UTC on CloudGrid) is used, which can disagree with the
   *  configured timezone late at night. */
  timezone?: string;
```

- [ ] **Step 6: Thread timezone through `runPerTopicGeneration`**

In `agent.ts`, add `timezone` to the `runPerTopicGeneration` args interface (around line 1183):

```typescript
  /** Scheduler timezone for day-of-week calculation. */
  timezone?: string;
```

Pass it in the call at line 1027-1041:

```typescript
return await runPerTopicGeneration({
  // ...existing fields...
  timezone: params.timezone,
});
```

And pass it to `isTopicEligibleToday` at line 1241:

```typescript
eligibleTopics = topics.filter((t) => isTopicEligibleToday(t.schedule, new Date(), args.timezone));
```

- [ ] **Step 7: Pass timezone from scheduler (direct path)**

In `services/content-pipeline/src/agents/scheduled-publisher/index.ts`, at line 258-272, add `timezone: schedCfg.timezone` to the `runContentGeneration` call:

```typescript
const genResult = await runContentGeneration(
  {
    siteDomain: domain,
    count: articlesPerDay,
    branch: writeBranch,
    preloadedBrief: { ... },
    source: "scheduler",
    timezone: schedCfg.timezone,
  },
  config,
);
```

- [ ] **Step 8: Add timezone to GenerateJobData and scheduler flow**

In `services/content-pipeline/src/queue/types.ts`, add to `GenerateJobData`:

```typescript
  /** Scheduler timezone — passed to per-topic eligibility check. */
  timezone?: string;
```

In `services/content-pipeline/src/queue/scheduler-flow.ts`, at line 82-89, add timezone to child job data:

```typescript
data: {
  siteDomain: site.domain,
  count: site.count,
  branch: site.branch,
  runId,
  triggeredBy: (forced ? "scheduled-forced" : "scheduled") as GenerateJobData["triggeredBy"],
  briefJson: site.briefJson,
  timezone,
},
```

- [ ] **Step 9: Thread timezone in queue handler**

In `services/content-pipeline/src/queue/content-generation.ts`, at line 51, destructure timezone:

```typescript
const { siteDomain, branch, count, briefJson, topicName, bypassSchedule, triggeredBy, timezone } = job.data;
```

At lines 109-121, pass timezone to `runContentGeneration`:

```typescript
result = await runContentGeneration(
  {
    siteDomain,
    branch,
    count,
    jobId: job.id,
    preloadedBrief,
    topicName,
    bypassSchedule: effectiveBypass,
    source: sourceFromTriggeredBy(triggeredBy),
    timezone,
  },
  config,
);
```

- [ ] **Step 10: Run all content-pipeline tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL tests PASS

- [ ] **Step 11: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/per-topic-fetch.ts \
      services/content-pipeline/src/agents/content-generation/agent.ts \
      services/content-pipeline/src/agents/scheduled-publisher/index.ts \
      services/content-pipeline/src/queue/types.ts \
      services/content-pipeline/src/queue/scheduler-flow.ts \
      services/content-pipeline/src/queue/content-generation.ts \
      services/content-pipeline/src/__tests__/per-topic-fetch.test.ts
git commit -m "fix(scheduler): make per-topic eligibility timezone-aware and case-insensitive

isTopicEligibleToday() was using new Date().getDay() (UTC on CloudGrid)
while the site-level check used the configured timezone. This caused all
topics to fail eligibility when the UTC day differed from the configured
timezone (e.g., 11 PM EST Monday = 4 AM Tuesday UTC). Also made the
preferred_days comparison case-insensitive to match the site-level check.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Fix dedup index overwrite (merge instead of replace)

**Root cause:** In `queue/content-generation.ts:164`, the dedup index is rebuilt from ONLY the newly created articles in the current batch. It doesn't include articles already known from the dedup index or from previous runs. So every content generation run overwrites the dedup index with just the latest batch, and the next run can't detect older articles as duplicates.

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:288` (export `getAllExistingArticles`)
- Modify: `services/content-pipeline/src/queue/content-generation.ts:164-175` (merge existing + new)
- Test: `services/content-pipeline/src/__tests__/process-generate-job.test.ts`

- [ ] **Step 1: Write failing test**

Add to `services/content-pipeline/src/__tests__/process-generate-job.test.ts`. First, add `getAllExistingArticles` to the mock:

```typescript
// In the vi.mock for agent.js, add:
const mockGetAllExistingArticles = vi.fn().mockResolvedValue({
  urls: new Set(["example.com/existing-1", "example.com/existing-2"]),
  titles: new Set(["existing article one", "existing article two"]),
});

// Update the mock block:
vi.mock("../agents/content-generation/agent.js", () => ({
  runContentGeneration: (...args: unknown[]): unknown =>
    mockRunContentGeneration(...args),
  normalizeUrl: (url: string) => url,
  normalizeTitleKey: (title: string) => title.toLowerCase(),
  dedupIndexPath: (domain: string) => `sites/${domain}/dedup-index.json`,
  serializeDedupIndex: (existing: { urls: Set<string>; titles: Set<string> }) =>
    JSON.stringify({
      version: 1,
      urls: Array.from(existing.urls),
      titles: Array.from(existing.titles),
    }),
  getAllExistingArticles: (...args: unknown[]): unknown =>
    mockGetAllExistingArticles(...args),
}));
```

Then add the test:

```typescript
it("dedup index includes existing articles merged with new ones", async () => {
  const mockResult = {
    siteDomain: "test.com",
    requested: 1,
    totalSourced: 5,
    duplicateCount: 0,
    availableNew: 5,
    n8nImagesTriggered: 0,
    results: [
      {
        status: "created",
        slug: "new-article",
        _pendingArticle: {
          siteDomain: "test.com",
          slug: "new-article",
          content: "---\ntitle: New Article\nsource_url: https://example.com/new\n---\nBody",
        },
      },
    ],
  };
  mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());
  mockRunContentGeneration.mockResolvedValue(mockResult);

  await processGenerateJob(makeJob(), config, mockRedis);

  // writeArticleBatch should be called with extraFiles containing the dedup index
  expect(mockWriteArticleBatch).toHaveBeenCalled();
  const extraFiles = mockWriteArticleBatch.mock.calls[0]![4] as Array<{ path: string; content: string }>;
  expect(extraFiles).toHaveLength(1);
  const dedupIndex = JSON.parse(extraFiles[0]!.content);
  // Must include BOTH existing articles AND the new one
  expect(dedupIndex.urls).toContain("example.com/existing-1");
  expect(dedupIndex.urls).toContain("example.com/existing-2");
  expect(dedupIndex.urls).toContain("https://example.com/new");  // normalizeUrl is identity mock
  expect(dedupIndex.titles).toContain("existing article one");
  expect(dedupIndex.titles).toContain("existing article two");
  expect(dedupIndex.titles).toContain("new article");  // normalizeTitleKey is .toLowerCase() mock
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/process-generate-job.test.ts`
Expected: New test FAILS (dedup index only contains new article, not existing ones)

- [ ] **Step 3: Export `getAllExistingArticles` from agent.ts**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, change line 288 from:

```typescript
async function getAllExistingArticles(
```

to:

```typescript
export async function getAllExistingArticles(
```

- [ ] **Step 4: Merge existing articles in queue handler**

In `services/content-pipeline/src/queue/content-generation.ts`:

Add import (line 7):
```typescript
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex, getAllExistingArticles } from "../agents/content-generation/agent.js";
```

Replace lines 164-175 with:

```typescript
    // Load full existing articles set (from dedup index or file scan) and merge
    // in the newly created articles. Previously this only wrote the new batch,
    // causing the next run to lose track of all older articles.
    const existingArticles = await getAllExistingArticles(config, siteDomain, branch);
    for (const r of created) {
      if (r._pendingArticle) {
        const { data } = matter(r._pendingArticle.content);
        if (data.source_url) existingArticles.urls.add(normalizeUrl(data.source_url as string));
        if (data.title) existingArticles.titles.add(normalizeTitleKey(data.title as string));
      }
    }
    const dedupIndexFile: BatchFileEntry = {
      path: dedupIndexPath(siteDomain),
      content: serializeDedupIndex(existingArticles),
    };
```

- [ ] **Step 5: Run process-generate-job tests**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/process-generate-job.test.ts`
Expected: ALL tests PASS (including new merge test)

- [ ] **Step 6: Run full test suite**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL tests PASS

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts \
      services/content-pipeline/src/queue/content-generation.ts \
      services/content-pipeline/src/__tests__/process-generate-job.test.ts
git commit -m "fix(dedup): merge existing articles into dedup index instead of overwriting

The dedup index was rebuilt from ONLY the newly created articles each run,
discarding all previously known articles. This caused the next run to not
detect older articles as duplicates. Now loads the full existing set and
merges in new articles before writing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Write dedup index after migration import

**Root cause:** The migration orchestrator commits articles to git but never creates/updates `dedup-index.json`. When subsequent content generation runs, the first run does a full file scan (correct), creates a dedup index with only its new articles (bug from Task 2, now fixed), and migrated articles become invisible. Even with Task 2 fix, the first content gen run after migration needs to do an expensive full scan. Building the dedup index at migration time is both correct and efficient.

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/orchestrator.ts:267-280`
- Test: `services/content-pipeline/src/__tests__/migration/batch-import.test.ts` (or integration test)

- [ ] **Step 1: Write failing test**

Add to `services/content-pipeline/src/__tests__/migration/batch-import.test.ts` (or a new test file if more appropriate — check what exists). The test verifies that the commit includes a `dedup-index.json` file.

First, locate the existing mock setup for `commitBatch` in the migration test files. The test should verify that `commitBatch` is called with an extra file for the dedup index.

```typescript
it("includes dedup-index.json in the batch commit", async () => {
  // ... setup migration with articles that have source_url and title ...
  // After orchestrator runs:
  // Verify commitBatch was called and the files array includes dedup-index.json
  const commitCall = mockCommitBatch.mock.calls[0];
  const files = commitCall[2] as Array<{ path: string; content: string }>;
  const dedupFile = files.find((f) => f.path.includes("dedup-index.json"));
  expect(dedupFile).toBeDefined();
  const index = JSON.parse(dedupFile!.content);
  expect(index.version).toBe(1);
  expect(index.urls.length).toBeGreaterThan(0);
  expect(index.titles.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/batch-import.test.ts`
Expected: FAIL — dedup-index.json not found in commit files

- [ ] **Step 3: Add dedup index creation to migration orchestrator**

In `services/content-pipeline/src/agents/migration/orchestrator.ts`:

Add imports at top:
```typescript
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex } from "../content-generation/agent.js";
```

After the `files` array is built (around line 267, before the commit), add:

```typescript
  // Build dedup index from the imported articles so subsequent content
  // generation runs can detect duplicates without a full file scan.
  const dedupUrls = new Set<string>();
  const dedupTitles = new Set<string>();
  for (const f of files) {
    const { data: fm } = matter(f.content);
    if (fm.source_url) {
      try { dedupUrls.add(normalizeUrl(fm.source_url as string)); } catch { /* skip invalid URLs */ }
    }
    if (fm.title) dedupTitles.add(normalizeTitleKey(fm.title as string));
  }
  if (dedupUrls.size > 0 || dedupTitles.size > 0) {
    files.push({
      path: dedupIndexPath(siteId),
      content: serializeDedupIndex({ urls: dedupUrls, titles: dedupTitles }),
    });
  }
```

- [ ] **Step 4: Run migration tests**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/`
Expected: ALL tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL tests PASS

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/migration/orchestrator.ts \
      services/content-pipeline/src/__tests__/migration/batch-import.test.ts
git commit -m "fix(migration): write dedup-index.json after article import

Migration imported articles without creating a dedup index, so subsequent
content generation couldn't efficiently detect duplicates. Now builds and
commits dedup-index.json alongside the imported articles.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Improve scheduler error message for per-topic sites

**Root cause:** The scheduler reports "Aggregator returned 0 items for this site's topics" whenever `totalSourced === 0`, but this can also happen when no topics are eligible today (no aggregator call was ever made). The message is misleading.

**Files:**
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts:295-297`
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:141-157` (add `eligibleTopicCount` to BatchContentGenerationResult)
- Test: `services/content-pipeline/src/__tests__/scheduled-publisher.test.ts`

- [ ] **Step 1: Add `eligibleTopicCount` to `BatchContentGenerationResult`**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, add to `BatchContentGenerationResult` (around line 155):

```typescript
  /** Number of topics that passed the eligibility filter (per-topic sites only).
   *  Zero means no topics were eligible today — distinct from "aggregator returned 0". */
  eligibleTopicCount?: number;
```

- [ ] **Step 2: Set `eligibleTopicCount` in `runPerTopicGeneration`**

In the return statement of `runPerTopicGeneration` (around line 1424-1432), add:

```typescript
  return {
    siteDomain,
    requested: requestedCount,
    totalSourced,
    duplicateCount,
    availableNew: allResults.length,
    n8nImagesTriggered: 0,
    results: allResults,
    eligibleTopicCount: eligibleTopics.length,
  };
```

- [ ] **Step 3: Update scheduler error message**

In `services/content-pipeline/src/agents/scheduled-publisher/index.ts`, replace lines 295-297:

```typescript
    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      siteMessage = "Aggregator returned 0 items for this site's topics";
    }
```

with:

```typescript
    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      if (genResult.eligibleTopicCount === 0) {
        siteMessage = "No topics eligible to run today (check per-topic preferred_days)";
      } else {
        siteMessage = `Aggregator returned 0 items for ${genResult.eligibleTopicCount} eligible topic(s)`;
      }
    }
```

Also update the same check in `services/content-pipeline/src/queue/scheduler-flow.ts` if it exists there (search for "Aggregator returned 0").

- [ ] **Step 4: Run scheduler tests**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/scheduled-publisher.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL tests PASS

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts \
      services/content-pipeline/src/agents/scheduled-publisher/index.ts \
      services/content-pipeline/src/queue/scheduler-flow.ts
git commit -m "fix(scheduler): distinguish 'no eligible topics' from 'aggregator returned 0'

The scheduler reported 'Aggregator returned 0 items' even when no topics
were eligible today (no aggregator call was ever made). Now surfaces the
actual reason: no eligible topics vs aggregator returned nothing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Rebuild dedup index for existing migrated sites (one-time script)

**Context:** Sites that were already migrated before the Task 3 fix need their dedup indexes rebuilt. This is a one-time operational task.

**Files:**
- Create: `services/content-pipeline/src/scripts/rebuild-dedup-index.ts`

- [ ] **Step 1: Write the rebuild script**

```typescript
/**
 * One-time script to rebuild dedup-index.json for a site by scanning all
 * existing article files. Run after migration to fix sites that were imported
 * without a dedup index.
 *
 * Usage: npx tsx src/scripts/rebuild-dedup-index.ts <siteDomain> [branch]
 */
import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex } from "../agents/content-generation/agent.js";

const siteDomain = process.argv[2];
const branch = process.argv[3];

if (!siteDomain) {
  console.error("Usage: npx tsx src/scripts/rebuild-dedup-index.ts <siteDomain> [branch]");
  process.exit(1);
}

const networkPath = process.env.NETWORK_DATA_PATH
  ?? path.resolve(process.cwd(), "../../atomic-labs-network");

const articlesDir = path.join(networkPath, "sites", siteDomain, "articles");
const urls = new Set<string>();
const titles = new Set<string>();

let files: string[];
try {
  files = await fs.readdir(articlesDir);
} catch {
  console.error(`No articles directory found at ${articlesDir}`);
  process.exit(1);
}

for (const file of files) {
  if (!file.endsWith(".md")) continue;
  try {
    const content = await fs.readFile(path.join(articlesDir, file), "utf-8");
    const { data } = matter(content);
    if (data.source_url) {
      try { urls.add(normalizeUrl(data.source_url as string)); } catch { /* skip */ }
    }
    if (data.title) titles.add(normalizeTitleKey(data.title as string));
  } catch {
    console.warn(`Skipping unparseable file: ${file}`);
  }
}

const indexPath = path.join(networkPath, dedupIndexPath(siteDomain));
const content = serializeDedupIndex({ urls, titles });
await fs.writeFile(indexPath, content, "utf-8");

console.log(`Rebuilt dedup index for ${siteDomain}: ${urls.size} URLs, ${titles.size} titles`);
console.log(`Written to: ${indexPath}`);
```

- [ ] **Step 2: Test the script locally against a migrated site**

Run: `cd services/content-pipeline && NETWORK_DATA_PATH=../../atomic-labs-network npx tsx src/scripts/rebuild-dedup-index.ts <domain>`
Expected: Script outputs URL and title counts, creates `dedup-index.json`

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/scripts/rebuild-dedup-index.ts
git commit -m "feat(scripts): add rebuild-dedup-index script for migrated sites

One-time script to rebuild dedup-index.json by scanning all existing
article files. Fixes duplicate detection for sites imported before the
migration was updated to write the dedup index.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Run full verification

- [ ] **Step 1: Run full content-pipeline test suite**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: ALL tests PASS

- [ ] **Step 2: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run project-wide typecheck**

Run: `pnpm typecheck`
Expected: No errors
