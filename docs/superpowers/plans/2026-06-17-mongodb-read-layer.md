# MongoDB Read Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all dashboard Git-reads with MongoDB queries, eliminating GitHub API rate-limit bottleneck and review_counts counter drift.

**Architecture:** Git remains the write/persistence layer. Every mutation dual-writes: Git first (hard fail), MongoDB second (soft fail). Dashboard reads only from MongoDB. seed-kv is unchanged.

**Tech Stack:** MongoDB (existing via `getMongoDb()`), TypeScript, Vitest, gray-matter (frontmatter parsing)

**Spec:** `docs/superpowers/specs/2026-06-17-mongodb-read-layer-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `services/dashboard/src/lib/mongo.ts` | Dashboard MongoDB connection (lazy memoized `getMongoDb()`) |
| `services/dashboard/src/lib/db/articles.ts` | Article read/write helpers for MongoDB |
| `services/dashboard/src/lib/db/site-configs.ts` | Site config read/write helpers |
| `services/dashboard/src/lib/db/dashboard-index.ts` | Dashboard index read/write helpers |
| `services/dashboard/src/lib/db/configs.ts` | Org, group, override, scheduler config helpers |
| `services/dashboard/src/lib/db/index.ts` | Barrel export for all db modules |
| `services/dashboard/src/lib/db/collections.ts` | Collection names constant + index setup |
| `services/content-pipeline/src/lib/db/articles.ts` | Pipeline-side article write helpers (reuses pipeline's existing mongo.ts) |
| `services/content-pipeline/src/scripts/backfill-mongo.ts` | One-time backfill script |
| `services/content-pipeline/src/__tests__/db-articles.test.ts` | Tests for pipeline article DB helpers |
| `services/dashboard/src/lib/db/__tests__/articles.test.ts` | Tests for dashboard article DB helpers |
| `services/dashboard/src/lib/db/__tests__/site-configs.test.ts` | Tests for site config DB helpers |
| `services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts` | Tests for dashboard index DB helpers |
| `services/dashboard/src/lib/db/__tests__/configs.test.ts` | Tests for org/group/override/scheduler helpers |

### Modified files (by phase)

**Phase 1 — Articles:**
- `services/content-pipeline/src/queue/content-generation.ts` — dual-write after `writeArticleBatch()`
- `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts` — dual-write after `writeArticleBatch()`
- `services/content-pipeline/src/agents/article-regeneration/index.ts` — dual-write after `commitFile()`
- `services/content-pipeline/src/agents/content-generation/n8n-image.ts` — dual-write after image commit
- `services/content-pipeline/src/agents/migration/orchestrator.ts` — dual-write after WordPress import `commitBatch()`
- `services/content-pipeline/src/queue/scheduler-flow.ts` — dual-write in `autoPublishSite()`
- `services/content-pipeline/src/stats/recorder.ts` — remove `review_counts` increment
- `services/content-pipeline/src/stats/weekly-summary.ts` — replace `reviewCounts.find()` with articles aggregation, remove `decrementReviewCount()`
- `services/content-pipeline/src/stats/types.ts` — remove `ReviewCount`, `reviewCounts` from `COLLECTIONS`
- `services/content-pipeline/src/agents/content-generation/index.ts` — remove `/review-counts/decrement` endpoint
- `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts` — dual-write after editor save
- `services/dashboard/src/app/api/articles/upload/route.ts` — dual-write after upload commit
- `services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts` — dual-write after image replacement
- `services/dashboard/src/app/api/agent/commit-article/route.ts` — dual-write after commit
- `services/dashboard/src/app/api/articles/[domain]/[slug]/videos/route.ts` — dual-write after video save
- `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts` — dual-write after script save
- `services/dashboard/src/app/api/articles/copy/route.ts` — dual-write after article copy
- `services/dashboard/src/actions/review.ts` — dual-write on approve/reject, remove review_counts decrement
- `services/dashboard/src/actions/sites.ts` — dual-write on article delete, site delete
- `services/dashboard/src/lib/github.ts` — remove `articlesCache`, `articleCountCache`

**Phase 2 — Site configs:**
- `services/dashboard/src/app/api/sites/save/route.ts` — dual-write after config save
- `services/dashboard/src/app/api/groups/[groupId]/sites/route.ts` — dual-write on group membership change
- `services/dashboard/src/actions/wizard.ts` — dual-write on site creation
- `services/dashboard/src/actions/agent.ts` — dual-write in `updateSiteBrief()`
- `services/dashboard/src/actions/sites.ts` — dual-write on site deletion
- `services/dashboard/src/lib/github.ts` — remove `siteConfigCache`

**Phase 3 — Dashboard index:**
- `services/dashboard/src/actions/wizard.ts` — dual-write on create, status change, domain attach/detach, goLive, ensureStagingBranch, savePreview
- `services/dashboard/src/actions/sites.ts` — dual-write on updateSiteEntry, delete/restore
- `services/dashboard/src/app/api/sites/save/route.ts` — dual-write for vertical propagation to index
- `services/dashboard/src/lib/github.ts` — remove `dashboardIndexCache`

**Phase 4 — Configs:**
- `services/dashboard/src/app/api/settings/org/route.ts` — dual-write
- `services/dashboard/src/app/api/groups/[groupId]/route.ts` — dual-write on PUT/DELETE
- `services/dashboard/src/app/api/overrides/[id]/route.ts` — dual-write on PUT/DELETE
- `services/dashboard/src/app/api/scheduler/route.ts` — dual-write
- `services/dashboard/src/lib/github.ts` — remove remaining caches

---

## Task 1: Dashboard MongoDB Connection

**Files:**
- Create: `services/dashboard/src/lib/mongo.ts`
- Reference: `services/content-pipeline/src/lib/mongo.ts`

- [ ] **Step 1: Write the test**

Create `services/dashboard/src/lib/__tests__/mongo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock mongodb module
const mockDb = { collection: vi.fn() };
const mockClient = {
  db: vi.fn(() => mockDb),
  close: vi.fn(),
};
vi.mock("mongodb", () => ({
  MongoClient: {
    connect: vi.fn(() => Promise.resolve(mockClient)),
  },
}));

describe("getMongoDb", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MONGODB_URL = "mongodb://localhost:27017/test_db";
  });

  afterEach(() => {
    delete process.env.MONGODB_URL;
    delete process.env.MONGODB_URI;
  });

  it("returns a Db instance from MONGODB_URL", async () => {
    const { getMongoDb } = await import("../mongo.js");
    const db = await getMongoDb();
    expect(db).toBe(mockDb);
  });

  it("throws if no MONGODB_URL or MONGODB_URI is set", async () => {
    delete process.env.MONGODB_URL;
    const { getMongoDb } = await import("../mongo.js");
    await expect(getMongoDb()).rejects.toThrow("MONGODB_URL");
  });

  it("memoizes — returns same promise on second call", async () => {
    const { getMongoDb } = await import("../mongo.js");
    const db1 = await getMongoDb();
    const db2 = await getMongoDb();
    expect(db1).toBe(db2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/mongo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement mongo.ts**

Create `services/dashboard/src/lib/mongo.ts`:

```typescript
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

/**
 * Lazy, memoized MongoDB connection for the dashboard.
 * Same pattern as content-pipeline's getMongoDb().
 * Reads MONGODB_URL (or MONGODB_URI) from env.
 */
export async function getMongoDb(): Promise<Db> {
  if (dbPromise) return dbPromise;

  const url = process.env.MONGODB_URL ?? process.env.MONGODB_URI;
  if (!url) {
    throw new Error(
      "MONGODB_URL (or MONGODB_URI) is required. " +
      "Set it in .env.local for local dev or via cloudgrid secrets.",
    );
  }

  // Parse DB name from URL path, fallback to "atl_ops"
  const dbName = new URL(url).pathname.slice(1) || "atl_ops";

  clientPromise = MongoClient.connect(url, {
    serverSelectionTimeoutMS: 5_000,
  });

  dbPromise = clientPromise.then((client) => client.db(dbName));
  return dbPromise;
}

/** Graceful shutdown — for tests. */
export async function closeMongo(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = null;
  dbPromise = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/dashboard && pnpm vitest run src/lib/__tests__/mongo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/mongo.ts services/dashboard/src/lib/__tests__/mongo.test.ts
git commit -m "feat(dashboard): add MongoDB connection module"
```

---

## Task 2: Collections Constants and Index Setup

**Files:**
- Create: `services/dashboard/src/lib/db/collections.ts`

- [ ] **Step 1: Create collections module**

```typescript
/** MongoDB collection names for the dashboard read layer. */
export const COLLECTIONS = {
  articles: "articles",
  siteConfigs: "site_configs",
  dashboardIndex: "dashboard_index",
  orgConfig: "org_config",
  groupConfigs: "group_configs",
  overrideConfigs: "override_configs",
  schedulerConfig: "scheduler_config",
} as const;
```

- [ ] **Step 2: Create index setup function**

Add to `services/dashboard/src/lib/db/collections.ts`:

```typescript
import type { Db } from "mongodb";

/** Ensure indexes exist. Call once at startup or from backfill script. */
export async function ensureReadLayerIndexes(db: Db): Promise<void> {
  const articles = db.collection(COLLECTIONS.articles);
  await articles.createIndex({ domain: 1, branch: 1 });
  await articles.createIndex({ domain: 1, branch: 1, status: 1 });
  await articles.createIndex(
    { domain: 1, slug: 1, branch: 1 },
    { unique: true },
  );

  const dashIdx = db.collection(COLLECTIONS.dashboardIndex);
  await dashIdx.createIndex({ domain: 1 }, { unique: true });
  await dashIdx.createIndex({ status: 1 });

  const siteConfigs = db.collection(COLLECTIONS.siteConfigs);
  await siteConfigs.createIndex({ domain: 1 }, { unique: true });

  const groupConfigs = db.collection(COLLECTIONS.groupConfigs);
  await groupConfigs.createIndex({ groupId: 1 }, { unique: true });

  const overrideConfigs = db.collection(COLLECTIONS.overrideConfigs);
  await overrideConfigs.createIndex({ overrideId: 1 }, { unique: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/db/collections.ts
git commit -m "feat(dashboard): add MongoDB collection constants and index setup"
```

---

## Task 3: Article MongoDB Helpers (Dashboard)

**Files:**
- Create: `services/dashboard/src/lib/db/articles.ts`
- Create: `services/dashboard/src/lib/db/__tests__/articles.test.ts`

- [ ] **Step 1: Write test for read helpers**

Create `services/dashboard/src/lib/db/__tests__/articles.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockToArray = vi.fn();
const mockFindOne = vi.fn();
const mockCountDocuments = vi.fn();
const mockUpdateOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockDeleteMany = vi.fn();
const mockBulkWrite = vi.fn();
const mockAggregate = vi.fn(() => ({ toArray: mockToArray }));
const mockFind = vi.fn(() => ({
  sort: vi.fn().mockReturnThis(),
  toArray: mockToArray,
}));
const mockCollection = vi.fn(() => ({
  find: mockFind,
  findOne: mockFindOne,
  countDocuments: mockCountDocuments,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
  deleteMany: mockDeleteMany,
  bulkWrite: mockBulkWrite,
  aggregate: mockAggregate,
}));
const mockDb = { collection: mockCollection };

vi.mock("../../mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("article DB helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getArticlesMeta returns articles for a domain+branch", async () => {
    const { getArticlesMeta } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([
      { domain: "example.com", slug: "hello", branch: "staging/example.com", title: "Hello", status: "review" },
    ]);
    const result = await getArticlesMeta("example.com", "staging/example.com");
    expect(mockCollection).toHaveBeenCalledWith("articles");
    expect(mockFind).toHaveBeenCalledWith({ domain: "example.com", branch: "staging/example.com" });
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("hello");
  });

  it("getArticleMeta returns a single article or null", async () => {
    const { getArticleMeta } = await import("../articles.js");
    mockFindOne.mockResolvedValueOnce({ slug: "test", title: "Test" });
    const result = await getArticleMeta("example.com", "test", "staging/example.com");
    expect(mockFindOne).toHaveBeenCalledWith({
      domain: "example.com",
      slug: "test",
      branch: "staging/example.com",
    });
    expect(result?.title).toBe("Test");
  });

  it("countArticlesByStatus counts articles with matching status", async () => {
    const { countArticlesByStatus } = await import("../articles.js");
    mockCountDocuments.mockResolvedValueOnce(5);
    const count = await countArticlesByStatus("example.com", "staging/example.com", "review");
    expect(mockCountDocuments).toHaveBeenCalledWith({
      domain: "example.com",
      branch: "staging/example.com",
      status: "review",
    });
    expect(count).toBe(5);
  });

  it("upsertArticleMeta upserts with domain+slug+branch key", async () => {
    const { upsertArticleMeta } = await import("../articles.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertArticleMeta("example.com", "test-slug", "staging/example.com", {
      title: "Test",
      status: "review",
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com", slug: "test-slug", branch: "staging/example.com" },
      { $set: expect.objectContaining({ title: "Test", status: "review", updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("deleteArticleMeta deletes by domain+slug+branch", async () => {
    const { deleteArticleMeta } = await import("../articles.js");
    mockDeleteOne.mockResolvedValueOnce({ acknowledged: true });
    await deleteArticleMeta("example.com", "test-slug", "staging/example.com");
    expect(mockDeleteOne).toHaveBeenCalledWith({
      domain: "example.com",
      slug: "test-slug",
      branch: "staging/example.com",
    });
  });

  it("deleteArticlesForSite deletes all articles for a domain", async () => {
    const { deleteArticlesForSite } = await import("../articles.js");
    mockDeleteMany.mockResolvedValueOnce({ acknowledged: true, deletedCount: 10 });
    await deleteArticlesForSite("example.com");
    expect(mockDeleteMany).toHaveBeenCalledWith({ domain: "example.com" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && pnpm vitest run src/lib/db/__tests__/articles.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement articles.ts**

Create `services/dashboard/src/lib/db/articles.ts`:

```typescript
import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

/** Frontmatter-only article metadata stored in MongoDB. */
export interface ArticleMeta {
  domain: string;
  slug: string;
  branch: string;
  title?: string;
  status?: string;
  quality_score?: number;
  featured_image?: string;
  image_alt?: string;
  publish_date?: string;
  tags?: string[];
  source_url?: string;
  videos?: unknown[];
  scripts?: unknown[];
  author?: string;
  type?: string;
  description?: string;
  score_breakdown?: Record<string, number>;
  reading_time?: number;
  updatedAt?: Date;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getArticlesMeta(
  domain: string,
  branch: string,
): Promise<ArticleMeta[]> {
  const db = await getMongoDb();
  return db
    .collection<ArticleMeta>(COLLECTIONS.articles)
    .find({ domain, branch })
    .sort({ slug: 1 })
    .toArray();
}

export async function getArticleMeta(
  domain: string,
  slug: string,
  branch: string,
): Promise<ArticleMeta | null> {
  const db = await getMongoDb();
  return db
    .collection<ArticleMeta>(COLLECTIONS.articles)
    .findOne({ domain, slug, branch });
}

export async function countArticlesByStatus(
  domain: string,
  branch: string,
  status: string,
): Promise<number> {
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch, status });
}

export async function countArticles(
  domain: string,
  branch: string,
): Promise<number> {
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch });
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// ---------------------------------------------------------------------------

export async function upsertArticleMeta(
  domain: string,
  slug: string,
  branch: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).updateOne(
      { domain, slug, branch },
      { $set: { ...frontmatter, domain, slug, branch, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function upsertArticlesMeta(
  docs: Array<{ domain: string; slug: string; branch: string; frontmatter: Record<string, unknown> }>,
): Promise<void> {
  if (docs.length === 0) return;
  try {
    const db = await getMongoDb();
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { domain: d.domain, slug: d.slug, branch: d.branch },
        update: {
          $set: { ...d.frontmatter, domain: d.domain, slug: d.slug, branch: d.branch, updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    await db.collection(COLLECTIONS.articles).bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticlesMeta failed (${docs.length} docs): ${msg}`);
  }
}

export async function deleteArticleMeta(
  domain: string,
  slug: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteOne({ domain, slug, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function deleteArticlesMeta(
  domain: string,
  slugs: string[],
  branch: string,
): Promise<void> {
  if (slugs.length === 0) return;
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({
      domain,
      branch,
      slug: { $in: slugs },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesMeta failed (${domain}, ${slugs.length} slugs): ${msg}`);
  }
}

export async function deleteArticlesForSite(domain: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({ domain });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSite failed (${domain}): ${msg}`);
  }
}

export async function deleteArticlesForSiteBranch(
  domain: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({ domain, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSiteBranch failed (${domain}@${branch}): ${msg}`);
  }
}

/**
 * Copy all articles from one branch to another (used by auto-publish).
 * Reads all articles for domain+sourceBranch, inserts copies with targetBranch.
 */
export async function copyArticlesToBranch(
  domain: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.articles);
    const docs = await coll.find({ domain, branch: sourceBranch }).toArray();
    if (docs.length === 0) return;

    const ops = docs.map((doc) => {
      const { _id, ...rest } = doc;
      return {
        updateOne: {
          filter: { domain, slug: doc.slug, branch: targetBranch },
          update: {
            $set: {
              ...rest,
              branch: targetBranch,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });
    await coll.bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] copyArticlesToBranch failed (${domain}): ${msg}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/dashboard && pnpm vitest run src/lib/db/__tests__/articles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/db/articles.ts services/dashboard/src/lib/db/__tests__/articles.test.ts
git commit -m "feat(dashboard): add article MongoDB read/write helpers"
```

---

## Task 4: Article MongoDB Helpers (Content Pipeline)

The content-pipeline already has `getMongoDb()` in `src/lib/mongo.ts`. Create a thin module that imports the same `COLLECTIONS` constant and provides article write helpers for the pipeline side.

**Files:**
- Create: `services/content-pipeline/src/lib/db/articles.ts`
- Create: `services/content-pipeline/src/__tests__/db-articles.test.ts`

- [ ] **Step 1: Write the test**

Create `services/content-pipeline/src/__tests__/db-articles.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdateOne = vi.fn();
const mockBulkWrite = vi.fn();
const mockDeleteMany = vi.fn();
const mockCollection = vi.fn(() => ({
  updateOne: mockUpdateOne,
  bulkWrite: mockBulkWrite,
  deleteMany: mockDeleteMany,
}));
vi.mock("../lib/mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve({ collection: mockCollection })),
}));

describe("pipeline article DB helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upsertArticleMeta writes frontmatter to articles collection", async () => {
    const { upsertArticleMeta } = await import("../lib/db/articles.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertArticleMeta("example.com", "test", "staging/example.com", {
      title: "Test",
      status: "review",
    });
    expect(mockCollection).toHaveBeenCalledWith("articles");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com", slug: "test", branch: "staging/example.com" },
      { $set: expect.objectContaining({ title: "Test", status: "review" }) },
      { upsert: true },
    );
  });

  it("upsertArticlesBatch bulk-writes multiple articles", async () => {
    const { upsertArticlesBatch } = await import("../lib/db/articles.js");
    mockBulkWrite.mockResolvedValueOnce({ ok: 1 });
    await upsertArticlesBatch([
      { domain: "a.com", slug: "s1", branch: "staging/a.com", frontmatter: { title: "A" } },
      { domain: "a.com", slug: "s2", branch: "staging/a.com", frontmatter: { title: "B" } },
    ]);
    expect(mockBulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { domain: "a.com", slug: "s1", branch: "staging/a.com" },
          }),
        }),
      ]),
    );
  });

  it("swallows errors without throwing", async () => {
    const { upsertArticleMeta } = await import("../lib/db/articles.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("connection lost"));
    // Should not throw
    await upsertArticleMeta("x.com", "y", "main", { title: "Z" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/db-articles.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pipeline article helpers**

Create `services/content-pipeline/src/lib/db/articles.ts`:

```typescript
import { getMongoDb } from "../mongo.js";

const ARTICLES_COLLECTION = "articles";

export async function upsertArticleMeta(
  domain: string,
  slug: string,
  branch: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(ARTICLES_COLLECTION).updateOne(
      { domain, slug, branch },
      { $set: { ...frontmatter, domain, slug, branch, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function upsertArticlesBatch(
  docs: Array<{ domain: string; slug: string; branch: string; frontmatter: Record<string, unknown> }>,
): Promise<void> {
  if (docs.length === 0) return;
  try {
    const db = await getMongoDb();
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { domain: d.domain, slug: d.slug, branch: d.branch },
        update: {
          $set: { ...d.frontmatter, domain: d.domain, slug: d.slug, branch: d.branch, updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    await db.collection(ARTICLES_COLLECTION).bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticlesBatch failed (${docs.length} docs): ${msg}`);
  }
}

export async function deleteArticlesForSiteBranch(
  domain: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(ARTICLES_COLLECTION).deleteMany({ domain, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSiteBranch failed (${domain}@${branch}): ${msg}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/db-articles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/lib/db/articles.ts services/content-pipeline/src/__tests__/db-articles.test.ts
git commit -m "feat(content-pipeline): add article MongoDB write helpers"
```

---

## Task 5: Dual-Write — Content Pipeline Article Generation

Wire MongoDB dual-writes into the content-pipeline's article generation paths.

**Files:**
- Modify: `services/content-pipeline/src/queue/content-generation.ts` — after `writeArticleBatch()` call
- Modify: `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts` — after `writeArticleBatch()` call
- Modify: `services/content-pipeline/src/agents/article-regeneration/index.ts` — after `commitFile()`

- [ ] **Step 1: Add dual-write to queue content-generation**

In `services/content-pipeline/src/queue/content-generation.ts`, add import at top:

```typescript
import { upsertArticlesBatch } from "../lib/db/articles.js";
```

After the `writeArticleBatch()` call (around line 185, after articles are committed to Git), add:

```typescript
// Dual-write: sync article metadata to MongoDB
const mongoArticles = successfulArticles.map((a) => ({
  domain: data.siteDomain,
  slug: a.slug,
  branch: data.branch,
  frontmatter: {
    title: a.frontmatter.title,
    description: a.frontmatter.description,
    status: a.frontmatter.status,
    type: a.frontmatter.type,
    publish_date: a.frontmatter.publishDate,
    author: a.frontmatter.author,
    tags: a.frontmatter.tags,
    featured_image: a.frontmatter.featuredImage,
    quality_score: a.frontmatter.quality_score,
    score_breakdown: a.frontmatter.score_breakdown,
    source_url: a.frontmatter.source_url,
    reading_time: a.frontmatter.reading_time,
  },
}));
await upsertArticlesBatch(mongoArticles);
```

Locate the exact insertion point by reading the file — it's after the Git commit succeeds and before the n8n image trigger loop. The `successfulArticles` variable (or equivalent) will already hold the written articles with their frontmatter.

- [ ] **Step 2: Add dual-write to dedicated-agent**

In `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts`, add the same import and dual-write pattern after `writeArticleBatch()` (around line 297).

- [ ] **Step 3: Add dual-write to article-regeneration**

In `services/content-pipeline/src/agents/article-regeneration/index.ts`, add import:

```typescript
import { upsertArticleMeta } from "../../lib/db/articles.js";
```

After the `commitFile()` call (around line 112), add:

```typescript
// Dual-write: update article metadata in MongoDB
await upsertArticleMeta(siteDomain, slug, branch, {
  title: updatedFrontmatter.title,
  description: updatedFrontmatter.description,
  status: updatedFrontmatter.status,
  quality_score: updatedFrontmatter.quality_score,
  tags: updatedFrontmatter.tags,
  reviewer_notes: updatedFrontmatter.reviewer_notes,
});
```

Extract `siteDomain` and `slug` from the article path (`sites/<domain>/articles/<slug>.md`).

- [ ] **Step 4: Add dual-write to WordPress migration orchestrator**

In `services/content-pipeline/src/agents/migration/orchestrator.ts`, add import:

```typescript
import { upsertArticlesBatch } from "../../lib/db/articles.js";
```

After the `commitBatch()` calls (around lines 273 and 277) that write migrated articles to Git, add a bulk upsert of the migrated articles' frontmatter to MongoDB. The article data is already parsed — extract the same fields as in the scheduler generation path.

- [ ] **Step 5: Add dual-write to n8n image callback**

In `services/content-pipeline/src/agents/content-generation/n8n-image.ts`, add import at the top of the file:

```typescript
import { upsertArticleMeta, upsertArticlesBatch } from "../../lib/db/articles.js";
```

In `processN8nImageResult()`, after the Git commit succeeds (after `console.log(\`${tag} Git commit OK\`)`), add:

```typescript
// Dual-write: update featured_image in MongoDB
await upsertArticleMeta(siteDomain, slug, branch, {
  featured_image: imageUrl,
  image_alt: altText,
});
```

Also add the same dual-write in the bulk mode path, inside `flushBulkBuffer()` after `commitBatch()` succeeds — bulk-upsert all buffered articles' `featured_image` fields using `upsertArticlesBatch`.

- [ ] **Step 6: Run existing tests to ensure no regressions**

Run: `cd services/content-pipeline && pnpm vitest run`
Expected: All existing tests pass (the new imports are soft-fail, so mocked MongoDB won't break anything)

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/queue/content-generation.ts \
      services/content-pipeline/src/agents/content-generation/dedicated-agent.ts \
      services/content-pipeline/src/agents/article-regeneration/index.ts \
      services/content-pipeline/src/agents/content-generation/n8n-image.ts \
      services/content-pipeline/src/agents/migration/orchestrator.ts
git commit -m "feat(content-pipeline): add MongoDB dual-writes to article generation paths"
```

---

## Task 6: Dual-Write — Dashboard Article Mutations

Wire MongoDB dual-writes into all dashboard article mutation endpoints.

**Files:**
- Modify: `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts`
- Modify: `services/dashboard/src/app/api/articles/upload/route.ts`
- Modify: `services/dashboard/src/app/api/agent/commit-article/route.ts`
- Modify: `services/dashboard/src/app/api/articles/[domain]/[slug]/videos/route.ts`
- Modify: `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts`
- Modify: `services/dashboard/src/app/api/articles/copy/route.ts`
- Modify: `services/dashboard/src/actions/review.ts`
- Modify: `services/dashboard/src/actions/sites.ts`

Each mutation point follows the same pattern:
1. Git write happens (existing code, unchanged)
2. MongoDB write happens immediately after (new code, soft-fail)

- [ ] **Step 1: Article editor save — dual-write**

In `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts`, add import:

```typescript
import { upsertArticleMeta } from "@/lib/db/articles";
```

Add imports at the top of the file:

```typescript
import matter from "gray-matter";
import { upsertArticleMeta } from "@/lib/db/articles";
```

After the `commitNetworkFiles()` call in the PATCH handler (around line 86), parse frontmatter and upsert:

```typescript
// Dual-write: sync frontmatter to MongoDB
const parsed = matter(content);
const fm = parsed.data;
await upsertArticleMeta(domain, slug, branch, {
  title: fm.title,
  description: fm.description,
  status: fm.status,
  type: fm.type,
  publish_date: fm.publishDate ?? fm.publish_date,
  author: fm.author,
  tags: fm.tags,
  featured_image: fm.featuredImage ?? fm.featured_image,
  quality_score: fm.quality_score,
  videos: fm.videos,
  scripts: fm.scripts,
  source_url: fm.source_url,
});
```

- [ ] **Step 2: Article upload — dual-write**

In `services/dashboard/src/app/api/articles/upload/route.ts`, after the `commitNetworkFiles()` call (around line 186), add the same pattern. The frontmatter is already parsed and validated in this route — reference the existing `frontmatter` variable.

- [ ] **Step 3: Article image replacement — dual-write**

In `services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts`, after the `commitNetworkFiles()` call that updates the article's frontmatter with the new `featuredImage` path, add:

```typescript
import { upsertArticleMeta } from "@/lib/db/articles";
await upsertArticleMeta(domain, slug, branch, { featured_image: imageUrl });
```

- [ ] **Step 4: Commit article — dual-write**

In `services/dashboard/src/app/api/agent/commit-article/route.ts`, after `commitSiteFiles()` (around line 58), parse frontmatter from the committed content and upsert. Extract domain and slug from the article path.

- [ ] **Step 5: Videos panel — dual-write**

In `services/dashboard/src/app/api/articles/[domain]/[slug]/videos/route.ts`, after `commitNetworkFiles()` (around line 129), add:

```typescript
import { upsertArticleMeta } from "@/lib/db/articles";
// After Git commit:
await upsertArticleMeta(domain, slug, stagingBranch, { videos });
```

- [ ] **Step 6: Scripts panel — dual-write**

Same pattern as videos in `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts`.

- [ ] **Step 7: Article copy — dual-write**

In `services/dashboard/src/app/api/articles/copy/route.ts`, after the `commitNetworkFiles()` calls (around line 314), bulk-upsert the copied articles into MongoDB for the target site.

- [ ] **Step 8: Review approve/reject — dual-write**

In `services/dashboard/src/actions/review.ts` `applyReviewDecisions()`:

After the approve `commitSiteFiles()` call (around line 150), bulk-upsert approved articles with `status: "published"`:

```typescript
import { upsertArticlesMeta, deleteArticlesMeta } from "@/lib/db/articles";

// After approve commit:
await upsertArticlesMeta(
  approved.map((a) => ({
    domain,
    slug: a.slug,
    branch,
    frontmatter: { status: "published" },
  })),
);
```

After the reject `deleteFilesFromBranch()` call (around line 156), delete rejected articles:

```typescript
await deleteArticlesMeta(domain, rejected.map((a) => a.slug), branch);
```

- [ ] **Step 9: Article delete from Content tab — dual-write**

In `services/dashboard/src/actions/sites.ts`:

In `deleteArticleFromStaging()` (around line 242), after `deleteFileFromBranch()`:

```typescript
import { deleteArticleMeta, deleteArticlesMeta, deleteArticlesForSite } from "@/lib/db/articles";
await deleteArticleMeta(domain, slug, stagingBranch);
```

In `deleteArticlesFromStaging()` (around line 265), after `deleteFilesFromBranch()`:

```typescript
await deleteArticlesMeta(domain, slugs, stagingBranch);
```

In `permanentlyDeleteSite()` (around line 390), add:

```typescript
await deleteArticlesForSite(domain);
```

- [ ] **Step 10: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors

- [ ] **Step 11: Commit**

```bash
git add services/dashboard/src/app/api/articles/ \
      services/dashboard/src/app/api/agent/commit-article/route.ts \
      services/dashboard/src/actions/review.ts \
      services/dashboard/src/actions/sites.ts
git commit -m "feat(dashboard): add MongoDB dual-writes to all article mutation paths"
```

---

## Task 7: Dual-Write — Auto-Publish

Wire MongoDB dual-writes into the auto-publish flow in scheduler-flow.ts.

**Files:**
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts`

- [ ] **Step 1: Add dual-write to autoPublishSite**

In `services/content-pipeline/src/queue/scheduler-flow.ts`, add import:

```typescript
import {
  upsertArticlesBatch,
  deleteArticlesForSiteBranch,
} from "../lib/db/articles.js";
```

In `autoPublishSite()`, add import at the top of the file:

```typescript
import matter from "gray-matter";
```

After `commitBatch()` succeeds (around line 210) and before the staging branch reset:

```typescript
// Dual-write: copy article metadata from staging to main in MongoDB
const articleFiles = files.filter((f) => f.path.includes("/articles/"));
if (articleFiles.length > 0) {
  const articleDocs = articleFiles.map((f) => {
    const slug = f.path.split("/articles/")[1]?.replace(/\.md$/, "") ?? "";
    const parsed = matter(f.content);
    return {
      domain,
      slug,
      branch: "main",
      frontmatter: {
        title: parsed.data.title,
        description: parsed.data.description,
        status: parsed.data.status,
        type: parsed.data.type,
        publish_date: parsed.data.publishDate ?? parsed.data.publish_date,
        author: parsed.data.author,
        tags: parsed.data.tags,
        featured_image: parsed.data.featuredImage ?? parsed.data.featured_image,
        quality_score: parsed.data.quality_score,
        videos: parsed.data.videos,
        scripts: parsed.data.scripts,
      },
    };
  });
  await upsertArticlesBatch(articleDocs);
}
```

After staging branch reset (around line 227), delete stale staging articles:

```typescript
// Dual-write: staging branch was reset — remove stale staging article docs
await deleteArticlesForSiteBranch(domain, stagingBranch);
```

- [ ] **Step 2: Run existing auto-publish tests**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/auto-publish.test.ts src/__tests__/scheduler-flow.test.ts`
Expected: PASS (new imports are soft-fail, mocked in existing test setup)

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/queue/scheduler-flow.ts
git commit -m "feat(content-pipeline): add MongoDB dual-writes to auto-publish flow"
```

---

## Task 8: review_counts Elimination

Remove the `review_counts` collection and all code that reads/writes it. Replace with `articles` collection queries.

**Files:**
- Modify: `services/content-pipeline/src/stats/recorder.ts` — remove `$inc` on review_counts
- Modify: `services/content-pipeline/src/stats/weekly-summary.ts` — replace reviewCounts query, remove `decrementReviewCount()`
- Modify: `services/content-pipeline/src/stats/types.ts` — remove `ReviewCount`, `reviewCounts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` — remove `/review-counts/decrement` endpoint
- Modify: `services/dashboard/src/actions/review.ts` — remove fire-and-forget POST

- [ ] **Step 1: Remove review_counts from types.ts**

In `services/content-pipeline/src/stats/types.ts`:
- Remove the `ReviewCount` interface (lines 58-62)
- Remove `reviewCounts: "review_counts"` from `COLLECTIONS` (line ~69)

- [ ] **Step 2: Remove review_counts increment from recorder.ts**

In `services/content-pipeline/src/stats/recorder.ts`:
- Remove lines 151-161 (the `$inc` on `review_counts` after generation)
- Keep the rest of `recordGeneration()` intact

- [ ] **Step 3: Update getWeeklySummary() in weekly-summary.ts**

In `services/content-pipeline/src/stats/weekly-summary.ts`:

Replace the `reviewCounts` query in `getWeeklySummary()` (lines 151-153):

```typescript
// OLD:
db.collection(COLLECTIONS.reviewCounts).find({}).toArray(),

// NEW:
db.collection("articles").aggregate([
  { $match: { status: "review", branch: { $regex: /^staging\// } } },
  { $group: { _id: "$domain", count: { $sum: 1 } } },
]).toArray(),
```

- [ ] **Step 4: Remove decrementReviewCount() from weekly-summary.ts**

Delete the entire `decrementReviewCount()` function (lines 232-244). Also remove its export from any barrel files.

- [ ] **Step 5: Remove /review-counts/decrement endpoint**

In `services/content-pipeline/src/agents/content-generation/index.ts`:
- Remove the import of `decrementReviewCount` from `weekly-summary.js`
- Remove the `POST /review-counts/decrement` handler block (lines 879-909)

- [ ] **Step 6: Remove fire-and-forget POST in review.ts**

In `services/dashboard/src/actions/review.ts` `applyReviewDecisions()`:
- Remove the loop that calls `fetch(\`${getAgentUrl()}/review-counts/decrement\`, ...)` (lines 185-198)
- The MongoDB dual-write from Task 6 Step 7 already handles the state update

- [ ] **Step 7: Run all tests**

Run: `cd services/content-pipeline && pnpm vitest run`
Run: `cd services/dashboard && pnpm vitest run` (if dashboard has relevant tests)
Expected: PASS — may need to update test mocks that reference `review_counts`

- [ ] **Step 8: Run typecheck for both services**

Run: `cd services/content-pipeline && pnpm typecheck`
Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add services/content-pipeline/src/stats/recorder.ts \
      services/content-pipeline/src/stats/weekly-summary.ts \
      services/content-pipeline/src/stats/types.ts \
      services/content-pipeline/src/agents/content-generation/index.ts \
      services/dashboard/src/actions/review.ts
git commit -m "feat: eliminate review_counts collection, use articles aggregation instead"
```

---

## Task 9: Site Config DB Helpers

**Files:**
- Create: `services/dashboard/src/lib/db/site-configs.ts`
- Create: `services/dashboard/src/lib/db/__tests__/site-configs.test.ts`

- [ ] **Step 1: Write test**

Test should cover: `getSiteConfig()`, `listSiteConfigs()`, `upsertSiteConfig()`, `deleteSiteConfig()`. Follow the same mock pattern as Task 3 (mock `getMongoDb`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/dashboard && pnpm vitest run src/lib/db/__tests__/site-configs.test.ts`

- [ ] **Step 3: Implement site-configs.ts**

```typescript
import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

export async function getSiteConfig(domain: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.siteConfigs).findOne({ domain }) as Promise<Record<string, unknown> | null>;
}

export async function listSiteConfigs(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.siteConfigs).find({}).sort({ domain: 1 }).toArray();
}

export async function upsertSiteConfig(domain: string, config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.siteConfigs).updateOne(
      { domain },
      { $set: { ...config, domain, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertSiteConfig failed (${domain}): ${msg}`);
  }
}

export async function deleteSiteConfig(domain: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.siteConfigs).deleteOne({ domain });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteSiteConfig failed (${domain}): ${msg}`);
  }
}
```

- [ ] **Step 4: Run test, commit**

```bash
git add services/dashboard/src/lib/db/site-configs.ts services/dashboard/src/lib/db/__tests__/site-configs.test.ts
git commit -m "feat(dashboard): add site config MongoDB helpers"
```

---

## Task 10: Dashboard Index DB Helpers

**Files:**
- Create: `services/dashboard/src/lib/db/dashboard-index.ts`
- Create: `services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts`

- [ ] **Step 1: Write test**

Cover: `getDashboardIndex()`, `getDashboardEntry()`, `upsertDashboardIndexEntry()`, `updateDashboardIndexEntry()`.

- [ ] **Step 2: Implement dashboard-index.ts**

```typescript
import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

export async function getDashboardIndex(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.dashboardIndex).find({ status: { $ne: "deleted" } }).sort({ domain: 1 }).toArray();
}

export async function getDashboardEntry(domain: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.dashboardIndex).findOne({ domain });
}

export async function upsertDashboardIndexEntry(domain: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      { $set: { ...entry, domain, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertDashboardIndexEntry failed (${domain}): ${msg}`);
  }
}

export async function updateDashboardIndexEntry(domain: string, update: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      { $set: { ...update, updatedAt: new Date() } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] updateDashboardIndexEntry failed (${domain}): ${msg}`);
  }
}

export async function addToDeleteHistory(domain: string, historyEntry: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      {
        $set: { status: "permanently_deleted", updatedAt: new Date() },
        $push: { history: historyEntry } as any,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] addToDeleteHistory failed (${domain}): ${msg}`);
  }
}
```

- [ ] **Step 3: Run test, commit**

```bash
git add services/dashboard/src/lib/db/dashboard-index.ts services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts
git commit -m "feat(dashboard): add dashboard index MongoDB helpers"
```

---

## Task 11: Org, Group, Override, Scheduler Config DB Helpers

**Files:**
- Create: `services/dashboard/src/lib/db/configs.ts`
- Create: `services/dashboard/src/lib/db/__tests__/configs.test.ts`

- [ ] **Step 1: Write test**

Cover: `getOrgConfig()`, `upsertOrgConfig()`, `getGroupConfig()`, `listGroupConfigs()`, `upsertGroupConfig()`, `deleteGroupConfig()`, `getOverrideConfig()`, `listOverrideConfigs()`, `upsertOverrideConfig()`, `deleteOverrideConfig()`, `getSchedulerConfig()`, `upsertSchedulerConfig()`.

- [ ] **Step 2: Implement configs.ts**

All follow the same soft-fail pattern. Org and scheduler use singleton docs (`_id: "org"` and `_id: "scheduler"`). Groups key on `groupId`, overrides on `overrideId`.

- [ ] **Step 3: Run test, commit**

```bash
git add services/dashboard/src/lib/db/configs.ts services/dashboard/src/lib/db/__tests__/configs.test.ts
git commit -m "feat(dashboard): add org/group/override/scheduler config MongoDB helpers"
```

---

## Task 12: Barrel Export

**Files:**
- Create: `services/dashboard/src/lib/db/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
export * from "./articles.js";
export * from "./site-configs.js";
export * from "./dashboard-index.js";
export * from "./configs.js";
export * from "./collections.js";
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/lib/db/index.ts
git commit -m "feat(dashboard): add db barrel export"
```

---

## Task 13: Backfill Script

**Files:**
- Create: `services/content-pipeline/src/scripts/backfill-mongo.ts`

- [ ] **Step 1: Implement backfill script**

The script reads all data from Git and upserts into MongoDB. It's idempotent.

```typescript
/**
 * Backfill MongoDB from Git. Idempotent — safe to re-run.
 *
 * Usage: GITHUB_TOKEN=... NETWORK_REPO=... npx tsx src/scripts/backfill-mongo.ts
 *
 * Phases (run individually with --phase flag, or all by default):
 *   --phase articles     Backfill articles collection
 *   --phase site-configs Backfill site_configs collection
 *   --phase index        Backfill dashboard_index collection
 *   --phase configs      Backfill org/group/override/scheduler configs
 */
```

Key implementation details:
- Import `createOctokit`, `readFile`, `listFilesRecursive` from `../lib/github.js`
- Import `getMongoDb` from `../lib/mongo.js`
- Read `dashboard-index.yaml` first to get the site list
- For each active site: read `site.yaml` from staging branch, list `articles/*.md`, parse frontmatter with `gray-matter`
- Bulk upsert with `bulkWrite` (batches of 100 for articles)
- Use `--phase` flag for incremental runs
- Print progress: `[backfill] articles: 150/300 for travelswire`
- Do NOT drop `review_counts` here — that's handled in Task 8 after the code changes are deployed

- [ ] **Step 2: Test locally**

Run: `cd services/content-pipeline && GITHUB_TOKEN=... NETWORK_REPO=atomicfuse/atomic-labs-network npx tsx src/scripts/backfill-mongo.ts --phase articles`
Expected: Articles backfilled, prints counts per site

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/scripts/backfill-mongo.ts
git commit -m "feat(content-pipeline): add MongoDB backfill script"
```

---

## Task 14: Dual-Write — Site Config Mutations

**Files:**
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`
- Modify: `services/dashboard/src/app/api/groups/[groupId]/sites/route.ts`
- Modify: `services/dashboard/src/actions/wizard.ts`
- Modify: `services/dashboard/src/actions/sites.ts`

- [ ] **Step 1: Site config save — dual-write**

In `services/dashboard/src/app/api/sites/save/route.ts`, after `commitSiteFiles()` (around line 363):

```typescript
import { upsertSiteConfig } from "@/lib/db/site-configs";
await upsertSiteConfig(domain, configUpdates);
```

- [ ] **Step 2: Group membership — dual-write**

In `services/dashboard/src/app/api/groups/[groupId]/sites/route.ts`, after `commitSiteFiles()` per site (around line 136):

```typescript
import { upsertSiteConfig } from "@/lib/db/site-configs";
await upsertSiteConfig(domain, { groups: config.groups });
```

(This is a partial update — only the `groups` field changes.)

- [ ] **Step 3: Wizard site creation — dual-write**

In `services/dashboard/src/actions/wizard.ts` `createSiteAndBuildStaging()`, after `commitSiteFiles()` (around line 290):

```typescript
import { upsertSiteConfig } from "@/lib/db/site-configs";
await upsertSiteConfig(siteFolder, parsedConfig);
```

Where `parsedConfig` is the full site config object being committed.

- [ ] **Step 4: Brief update via agent action — dual-write**

In `services/dashboard/src/actions/agent.ts` `updateSiteBrief()`, after `commitSiteFiles()` (around line 52):

```typescript
import { upsertSiteConfig } from "@/lib/db/site-configs";
await upsertSiteConfig(domain, updatedConfig);
```

Where `updatedConfig` is the full site config object being committed (or at minimum the brief fields that changed).

- [ ] **Step 5: Site deletion — dual-write**

In `services/dashboard/src/actions/sites.ts` `permanentlyDeleteSite()`, add:

```typescript
import { deleteSiteConfig } from "@/lib/db/site-configs";
await deleteSiteConfig(domain);
```

- [ ] **Step 6: Run typecheck, commit**

```bash
git add services/dashboard/src/app/api/sites/save/route.ts \
      services/dashboard/src/app/api/groups/[groupId]/sites/route.ts \
      services/dashboard/src/actions/wizard.ts \
      services/dashboard/src/actions/agent.ts \
      services/dashboard/src/actions/sites.ts
git commit -m "feat(dashboard): add MongoDB dual-writes to site config mutations"
```

---

## Task 15: Dual-Write — Dashboard Index Mutations

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`
- Modify: `services/dashboard/src/actions/sites.ts`
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`

- [ ] **Step 1: Wizard — site creation index entry**

In `createSiteAndBuildStaging()`, after `addSitesToIndex()` (around line 370):

```typescript
import { upsertDashboardIndexEntry, updateDashboardIndexEntry } from "@/lib/db/dashboard-index";
await upsertDashboardIndexEntry(siteFolder, siteEntry);
```

- [ ] **Step 2: Wizard — attachCustomDomain**

In `attachCustomDomain()`, after `writeDashboardIndex()` (around line 683):

```typescript
await updateDashboardIndexEntry(domain, {
  custom_domain: customDomain,
  zone_id: zoneId,
  status: "Live",
});
```

- [ ] **Step 3: Wizard — detachCustomDomain**

In `detachCustomDomain()`, after `writeDashboardIndex()` (around line 830):

```typescript
await updateDashboardIndexEntry(domain, {
  custom_domain: null,
  status: "Ready",
  worker_pending_dns: true,
});
```

- [ ] **Step 4: Wizard — goLive**

In `goLive()`, after `updateSiteInIndex(domain, { status: "Ready" })` (around line 436):

```typescript
await updateDashboardIndexEntry(domain, { status: "Ready" });
```

- [ ] **Step 5: Wizard — ensureStagingBranch**

In `ensureStagingBranch()`, after `updateSiteInIndex(domain, { staging_branch, preview_url })` (around line 503):

```typescript
await updateDashboardIndexEntry(domain, { staging_branch, preview_url });
```

- [ ] **Step 6: Sites — updateSiteEntry**

In `services/dashboard/src/actions/sites.ts` `updateSiteEntry()` (around line 37), after `updateSiteInIndex()`:

```typescript
import { updateDashboardIndexEntry } from "@/lib/db/dashboard-index";
await updateDashboardIndexEntry(domain, updates);
```

Where `updates` is the same partial object passed to `updateSiteInIndex()`.

- [ ] **Step 7: Sites — soft delete**

In `deleteSiteEntry()`, after `removeSiteFromIndex()` (around line 183):

```typescript
await updateDashboardIndexEntry(domain, { status: "deleted" });
```

- [ ] **Step 8: Sites — permanent delete**

In `permanentlyDeleteSite()`, after `permanentlyRemoveFromTrash()` (around line 390):

```typescript
import { addToDeleteHistory } from "@/lib/db/dashboard-index";
await addToDeleteHistory(domain, {
  deletedAt: new Date().toISOString(),
  deletedBy: "dashboard",
});
```

- [ ] **Step 9: Sites — restore from trash**

In the restore function, after the Git status update:

```typescript
await updateDashboardIndexEntry(domain, { status: "Staging" });
```

- [ ] **Step 10: Site save — vertical propagation to index**

In `services/dashboard/src/app/api/sites/save/route.ts`, after `updateSiteInIndex(domain, { vertical })` (around line 381):

```typescript
await updateDashboardIndexEntry(domain, { vertical: configUpdates.vertical });
```

- [ ] **Step 11: Run typecheck, commit**

```bash
git add services/dashboard/src/actions/wizard.ts \
      services/dashboard/src/actions/sites.ts \
      services/dashboard/src/app/api/sites/save/route.ts
git commit -m "feat(dashboard): add MongoDB dual-writes to dashboard index mutations"
```

---

## Task 16: Dual-Write — Config Mutations (Org, Groups, Overrides, Scheduler)

**Files:**
- Modify: `services/dashboard/src/app/api/settings/org/route.ts`
- Modify: `services/dashboard/src/app/api/groups/[groupId]/route.ts`
- Modify: `services/dashboard/src/app/api/overrides/[id]/route.ts`
- Modify: `services/dashboard/src/app/api/scheduler/route.ts` (or `services/dashboard/src/lib/scheduler.ts`)

- [ ] **Step 1: Org config — dual-write**

In org route PUT handler, after `commitNetworkFiles()`:

```typescript
import { upsertOrgConfig } from "@/lib/db/configs";
await upsertOrgConfig(body);
```

- [ ] **Step 2: Group config — dual-write**

In group route PUT handler, after `commitNetworkFiles()`:

```typescript
import { upsertGroupConfig, deleteGroupConfig } from "@/lib/db/configs";
await upsertGroupConfig(groupId, body);
```

In DELETE handler, after `deleteNetworkFile()`:

```typescript
await deleteGroupConfig(groupId);
```

- [ ] **Step 3: Override config — dual-write**

Same pattern as groups in override route.

- [ ] **Step 4: Scheduler config — dual-write**

In `services/dashboard/src/lib/scheduler.ts` `writeSchedulerConfig()`, after `commitNetworkFiles()`:

```typescript
import { upsertSchedulerConfig } from "@/lib/db/configs";
await upsertSchedulerConfig({ enabled, run_at_hours, timezone });
```

- [ ] **Step 5: Run typecheck, commit**

```bash
git add services/dashboard/src/app/api/settings/org/route.ts \
      services/dashboard/src/app/api/groups/[groupId]/route.ts \
      services/dashboard/src/app/api/overrides/[id]/route.ts \
      services/dashboard/src/lib/scheduler.ts
git commit -m "feat(dashboard): add MongoDB dual-writes to config mutations"
```

---

## Task 17: Switch Dashboard Reads from Git to MongoDB

This is the high-impact switchover task. Replace Git-read calls in the dashboard with MongoDB queries.

**Prerequisites:** Tasks 5, 6, 7, 13, 14, 15, and 16 must ALL be complete and deployed. The backfill must have run. All dual-writes must be active for all 4 phases. Deploy the content-pipeline first, then the dashboard, to ensure no mutation window is missed.

**Safety:** Use a `USE_MONGO_READS` env var (default `"false"`) as a feature flag. Each read-replacement wrapper checks this flag and falls back to Git on `"false"`. This allows instant rollback without a deploy.

**Files:**
- Modify: Multiple dashboard page components and API routes that currently call `readArticles()`, `readSiteConfig()`, `readDashboardIndex()` etc from `github.ts`

- [ ] **Step 1: Add feature flag wrapper**

In each db helper file (`articles.ts`, `site-configs.ts`, `dashboard-index.ts`, `configs.ts`), add at the top:

```typescript
const USE_MONGO = process.env.USE_MONGO_READS === "true";
```

Wrap each read function with a fallback:

```typescript
export async function getArticlesMeta(domain: string, branch: string): Promise<ArticleMeta[]> {
  if (!USE_MONGO) {
    // Fallback: delegate to the existing Git-based readArticles()
    const { readArticles } = await import("../github.js");
    return readArticles(domain, branch);
  }
  // ... existing MongoDB implementation
}
```

This flag can be flipped in `cloudgrid env set atomic-content-platform USE_MONGO_READS=true` without a deploy.

- [ ] **Step 2: Identify all Git-read call sites**

Search for all imports of read functions from `@/lib/github` or `../lib/github` across the dashboard `src/` tree:

- `readArticles` → replace with `getArticlesMeta` from `@/lib/db/articles`
- `countArticles` → replace with `countArticles` from `@/lib/db/articles`
- `countArticlesForSites` → replace with a MongoDB aggregation grouping by domain
- `readSiteConfig` → replace with `getSiteConfig` from `@/lib/db/site-configs`
- `readDashboardIndex` → replace with `getDashboardIndex` from `@/lib/db/dashboard-index`

**Do NOT replace:**
- `readFileContent` — still needed for article editor (full markdown body from Git)
- `commitNetworkFiles`, `commitSiteFiles`, `deleteFileFromBranch` etc — write operations stay on Git

- [ ] **Step 3: Replace article reads**

For each file that calls `readArticles()` or `countArticles()`:
- Change the import source
- Adapt to the new return type (`ArticleMeta[]` vs `ArticleEntry[]` — field names may differ slightly)
- Map field names if needed: `publishDate` → `publish_date`, `featuredImage` → `featured_image`, `score` → `quality_score`

Also replace `countArticlesForSites()` (used by `/api/sites/article-counts/route.ts`) with a single MongoDB aggregation:

```typescript
const pipeline = [
  { $match: { branch: { $regex: /^staging\// } } },
  { $group: { _id: "$domain", count: { $sum: 1 } } },
];
```

- [ ] **Step 4: Replace site config reads**

For each file that calls `readSiteConfig()`:
- Change to `getSiteConfig()` from `@/lib/db/site-configs`

- [ ] **Step 5: Replace dashboard index reads**

For each file that calls `readDashboardIndex()`:
- Change to `getDashboardIndex()` from `@/lib/db/dashboard-index`

- [ ] **Step 6: Replace config reads (org, groups, overrides, scheduler)**

Search for reads of org/group/override/scheduler configs from Git and replace with MongoDB helpers.

- [ ] **Step 7: Run full dashboard typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 8: Deploy with flag OFF, verify dual-writes are flowing**

Deploy with `USE_MONGO_READS=false`. Dashboard still reads from Git. Verify MongoDB has fresh data by checking timestamps on recent mutations.

- [ ] **Step 9: Enable flag and test in browser**

```bash
cloudgrid env set atomic-content-platform USE_MONGO_READS=true
```

Verify:
- Sites list loads from MongoDB
- Site detail pages show correct config
- Article lists show correct metadata
- Review counts show correct numbers
- Settings pages load configs

If anything breaks: `cloudgrid env set atomic-content-platform USE_MONGO_READS=false` — instant rollback.

- [ ] **Step 10: Commit**

```bash
git add services/dashboard/src/
git commit -m "feat(dashboard): switch all reads from Git to MongoDB (behind USE_MONGO_READS flag)"
```

---

## Task 18: Remove Git-Read Caches

After reads are switched to MongoDB, the in-memory caches in `github.ts` are dead code.

**Files:**
- Modify: `services/dashboard/src/lib/github.ts`

- [ ] **Step 1: Remove cache declarations and functions**

Remove from `github.ts`:
- `articlesCache` map declaration (line ~731)
- `articleCountCache` map declaration (lines ~681-682)
- `siteConfigCache` map declaration (lines ~644-645)
- `dashboardIndexCache` declaration (line ~104)
- `treeCacheStore` declaration (line ~118)
- `getTreeCached()` function
- `flushAllCaches()` function
- `invalidateSiteCaches()` function
- The periodic sweep interval (lines ~796-820)
- `invalidateKVArticleCache()` if no longer used

- [ ] **Step 2: Remove invalidateSiteCaches calls from mutation points**

Search for all `invalidateSiteCaches()` calls across dashboard:
- `services/dashboard/src/actions/sites.ts`
- `services/dashboard/src/actions/wizard.ts`
- `services/dashboard/src/actions/review.ts`
- Various API routes

Remove these calls — MongoDB writes are immediate, no cache to invalidate.

- [ ] **Step 3: Remove unused Git-read functions**

Remove from `github.ts`:
- `readArticles()` — replaced by `getArticlesMeta()`
- `countArticles()` — replaced by `countArticles()` from db
- `readSiteConfig()` — replaced by `getSiteConfig()`
- `readDashboardIndex()` — replaced by `getDashboardIndex()`

**Keep:**
- `readFileContent()` — article editor still reads full markdown from Git
- All write functions (`commitNetworkFiles`, `commitSiteFiles`, etc.)

- [ ] **Step 4: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors — if errors appear, some call sites still reference the old functions

- [ ] **Step 5: Run full test suite**

Run: `pnpm test` (from repo root)
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/lib/github.ts \
      services/dashboard/src/actions/ \
      services/dashboard/src/app/
git commit -m "refactor(dashboard): remove Git-read caches, replaced by MongoDB"
```

---

## Task 19: Reconcile Endpoint

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` — add `GET /reconcile-mongo` handler
- Create or extend: `services/content-pipeline/src/scripts/backfill-mongo.ts` — reuse backfill logic

- [ ] **Step 1: Add reconcile endpoint**

In `services/content-pipeline/src/agents/content-generation/index.ts`, add a new route handler for `GET /reconcile-mongo`.

The handler:
1. Checks `CACHE_INVALIDATE_SECRET` bearer token
2. Reads `dashboard-index.yaml` from Git to get active sites
3. For each site: compares `db.articles.countDocuments({ domain, branch })` against Git `listFilesRecursive()` count
4. For mismatched sites: re-runs the backfill for that site's articles
5. Checks for orphaned MongoDB docs (domains not in dashboard-index)
6. Returns JSON report

- [ ] **Step 2: Test manually**

Run: `curl -H "Authorization: Bearer $SECRET" http://localhost:5000/reconcile-mongo`
Expected: JSON response with reconciliation report

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): add /reconcile-mongo endpoint"
```

---

## Task 20: Environment Setup and Deployment

- [ ] **Step 1: Add MONGODB_URL to dashboard env**

For local dev, add to `services/dashboard/.env.local`:
```
MONGODB_URL=mongodb://localhost:27017/atl_ops
```

For production:
```bash
cloudgrid secrets set atomic-content-platform MONGODB_URL=<production-mongodb-url>
```

(Verify if it's already available as a shared secret — the content-pipeline already has it.)

- [ ] **Step 2: Add mongodb dependency to dashboard**

```bash
cd services/dashboard && pnpm add mongodb
```

- [ ] **Step 3: Add gray-matter dependency to dashboard (if not present)**

```bash
cd services/dashboard && pnpm add gray-matter
```

Check if `gray-matter` is already in the dashboard's dependencies first.

- [ ] **Step 4: Run backfill script in production**

After deploying the dual-write code:

```bash
# From content-pipeline environment
GITHUB_TOKEN=... NETWORK_REPO=atomicfuse/atomic-labs-network MONGODB_URL=... npx tsx src/scripts/backfill-mongo.ts
```

- [ ] **Step 5: Verify in production**

- Check MongoDB collections have data: `articles`, `site_configs`, `dashboard_index`, etc.
- Check article counts match Git
- Check review counts are correct (no more counter drift)
- Verify dashboard loads data from MongoDB (check logs for `[db]` prefixed warnings — should be none)

- [ ] **Step 6: Commit dependency changes**

```bash
git add services/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add mongodb and gray-matter dependencies"
```

---

## Execution Order and Dependencies

```
Task 20 (deps + env setup)   ──┐── Must run first (adds mongodb dependency)
Task 1  (mongo.ts)           ──┤── Depends on 20 (mongodb package)
Task 2  (collections.ts)     ──┤── No dependencies
                                │
Task 3  (article helpers)     ──┤── Depends on 1, 2
Task 4  (pipeline helpers)    ──┘── Depends on nothing new (pipeline already has mongo.ts)
                                │
Task 5  (pipeline dual-write) ──┤── Depends on 4
Task 6  (dashboard dual-write)──┤── Depends on 3
Task 7  (auto-publish)        ──┤── Depends on 4
                                │
Task 9  (site config helpers) ──┤── Depends on 1, 2
Task 10 (dash index helpers)  ──┤── Depends on 1, 2
Task 11 (config helpers)      ──┤── Depends on 1, 2
Task 12 (barrel export)       ──┘── Depends on 3, 9, 10, 11
                                │
Task 13 (backfill script)     ──┤── Depends on 4 (pipeline helpers)
                                │
Task 14 (site config writes)  ──┤── Depends on 9
Task 15 (dash index writes)   ──┤── Depends on 10
Task 16 (config writes)       ──┤── Depends on 11
                                │
── DEPLOY CHECKPOINT ──────────── Deploy content-pipeline first, then dashboard.
── Run backfill (Task 13) ─────── Populate MongoDB from Git.
── Verify dual-writes flowing ─── Check MongoDB timestamps on new mutations.
                                │
Task 8  (review_counts kill)  ──┤── Depends on 5, 6, 7, 13 (backfill done)
Task 17 (switch reads)        ──┤── Depends on 5, 6, 7, 8, 13, 14, 15, 16 (ALL dual-writes active)
Task 18 (remove caches)       ──┤── Depends on 17 (reads confirmed working from MongoDB)
Task 19 (reconcile endpoint)  ──┘── Depends on 13 (can be done in parallel with 17)
```

**Critical path:** 20 → 1 → 3 → 6 → (deploy + backfill) → 17 → 18

**Can be parallelized:** Tasks 3+4, Tasks 5+6, Tasks 9+10+11, Tasks 14+15+16

**Deploy strategy:**
1. Deploy content-pipeline with dual-writes (Tasks 4, 5, 7)
2. Deploy dashboard with dual-writes (Tasks 1-3, 6, 9-12, 14-16)
3. Run backfill script (Task 13)
4. Verify MongoDB data matches Git
5. Enable `USE_MONGO_READS=true` (Task 17) — instant rollback available
6. After stable period: remove caches (Task 18), deploy reconcile (Task 19)
