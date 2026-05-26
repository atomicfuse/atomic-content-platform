# GitHub API Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate GitHub API rate limits as a bottleneck by migrating to resilient clients, caching LLM results for retry, replacing deprecated `/contents/` reads with Git Data API, and moving the general-images page off GitHub entirely.

**Architecture:** Four independent changes: (1) unify on a single resilient Octokit factory, (2) add Redis checkpoint to BullMQ content generation jobs, (3) replace `repos.getContent`/`repos.createOrUpdateFileContents` with `git.getTree`+`git.getBlob`+`commitBatch`, (4) read article indexes from Cloudflare KV REST API instead of GitHub.

**Tech Stack:** TypeScript, Octokit (`@octokit/rest`, `@octokit/plugin-retry`, `@octokit/plugin-throttling`), BullMQ, ioredis, Cloudflare KV REST API, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-github-api-resilience-design.md`

---

## Task 1: Resilient Octokit Factory (content-pipeline)

**Files:**
- Modify: `services/content-pipeline/src/lib/github.ts`
- Modify: `services/content-pipeline/src/__tests__/writer.test.ts`
- Modify: `services/content-pipeline/src/__tests__/process-generate-job.test.ts`
- Modify: `services/content-pipeline/src/__tests__/scheduled-publisher.test.ts`
- Modify: `services/content-pipeline/src/__tests__/scheduler-flow.test.ts`
- Modify: `services/content-pipeline/src/__tests__/bulk-image.test.ts`
- Modify: `services/content-pipeline/src/__tests__/n8n-image.test.ts`
- Modify: `services/content-pipeline/src/__tests__/incremental-history.test.ts`

**Step 1: Replace `createGitHubClient` with `createOctokit` in `github.ts`**

In `services/content-pipeline/src/lib/github.ts`:

- Delete `createGitHubClient` (lines 24-26)
- Rename `createResilientOctokit` to `createOctokit`
- Add overloaded signature accepting `GitHubConfig | string`
- Remove `doNotRetry: ["429"]` from the retry config (line 48-49)
- Keep exporting the old name as an alias during transition if needed

```ts
// Replace both factory functions with one:
export function createOctokit(configOrToken: GitHubConfig | string): Octokit {
  const token = typeof configOrToken === "string" ? configOrToken : configOrToken.token;
  return new ResilientOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[github] Rate limit hit for ${String(options.method)} ${String(options.url)} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[github] Secondary rate limit for ${String(options.method)} ${String(options.url)} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 1;
      },
    },
    // No doNotRetry: ["429"] — let throttle plugin handle rate limits
  });
}
```

**Step 2: Update all test mocks**

Every test file that mocks `createGitHubClient` needs to mock `createOctokit` instead. The pattern in each test:

```ts
// Old:
vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => mockOctokit),
  // ...
}));

// New:
vi.mock("../lib/github.js", () => ({
  createOctokit: vi.fn(() => mockOctokit),
  // ...
}));
```

Files to update:
- `__tests__/writer.test.ts` — line 14
- `__tests__/process-generate-job.test.ts` — lines 24-27
- `__tests__/scheduled-publisher.test.ts` — line 25
- `__tests__/scheduler-flow.test.ts` — lines 32-33
- `__tests__/bulk-image.test.ts` — lines 15, 29, 122
- `__tests__/n8n-image.test.ts` — lines 32, 50, 100, 113
- `__tests__/incremental-history.test.ts` — line 13

**Step 3: Run tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: All tests pass (mocks updated, same behavior).

**Step 4: Commit**

```bash
git add services/content-pipeline/src/lib/github.ts services/content-pipeline/src/__tests__/
git commit -m "refactor(pipeline): unify Octokit factory — createGitHubClient → createOctokit with retry+throttle"
```

---

## Task 2: Update All Content-Pipeline Call Sites

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/n8n-image.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/bulk-image.ts`
- Modify: `services/content-pipeline/src/agents/article-regeneration/index.ts`
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts`
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/history.ts`
- Modify: `services/content-pipeline/src/queue/content-generation.ts`
- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts`
- Modify: `services/content-pipeline/src/lib/writer.ts`

**Step 1: Find-and-replace imports and calls**

In every file listed above:

1. Change import: `createGitHubClient` → `createOctokit`
2. Change calls: `createGitHubClient(config.github)` → `createOctokit(config.github)`

For files that import `createResilientOctokit`:
- `src/queue/import-site.ts` — change `createResilientOctokit` → `createOctokit`
- `src/queue/import-finalize.ts` — change `createResilientOctokit` → `createOctokit`

**Step 2: Run typecheck + tests**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: All pass.

**Step 3: Commit**

```bash
git add services/content-pipeline/src/
git commit -m "refactor(pipeline): update all call sites to use createOctokit"
```

---

## Task 3: Git Data API — Tree Cache + New Read Primitives (content-pipeline)

**Files:**
- Modify: `services/content-pipeline/src/lib/github.ts`

**Step 1: Add `TreeTruncatedError`, `getTreeCached`, `clearTreeCache`**

Add after the existing imports and before `readFile`:

```ts
export class TreeTruncatedError extends Error {
  constructor(ref: string) {
    super(`Tree truncated for ref: ${ref}`);
    this.name = "TreeTruncatedError";
  }
}

type TreeEntry = {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
};

const treeCache = new Map<string, TreeEntry[]>();

export async function getTreeCached(
  octokit: Octokit,
  repo: string,
  branch?: string,
): Promise<TreeEntry[]> {
  const ref = branch ?? "main";
  const cacheKey = `${repo}:${ref}`;
  if (treeCache.has(cacheKey)) return treeCache.get(cacheKey)!;

  const { owner, repo: repoName } = parseRepo(repo);
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${ref}`,
  });
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: refData.object.sha,
    recursive: "true",
  });

  if (tree.truncated) {
    console.warn(`[github] Tree for ${ref} is truncated — falling back to per-directory fetches`);
    throw new TreeTruncatedError(ref);
  }

  treeCache.set(cacheKey, tree.tree);
  return tree.tree;
}

export function clearTreeCache(): void {
  treeCache.clear();
}
```

**Step 2: Add `listFilesNonRecursive` fallback for truncated trees**

```ts
async function listFilesNonRecursive(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<TreeEntry[]> {
  const { owner, repo: repoName } = parseRepo(repo);
  const ref = branch ?? "main";
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${ref}`,
  });
  let treeSha = (
    await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: refData.object.sha,
    })
  ).data.tree.sha;

  for (const segment of dirPath.split("/").filter(Boolean)) {
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: treeSha,
    });
    const entry = tree.tree.find(
      (e) => e.path === segment && e.type === "tree",
    );
    if (!entry?.sha) throw new Error(`Directory not found: ${dirPath}`);
    treeSha = entry.sha;
  }

  const { data: dirTree } = await octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: treeSha,
  });
  return dirTree.tree;
}
```

**Step 3: Replace `readFile` implementation**

Replace the current `readFile` body (that uses `repos.getContent`) with tree+blob:

```ts
export async function readFile(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);

  let entry: TreeEntry | undefined;
  try {
    const tree = await getTreeCached(octokit, repo, branch);
    entry = tree.find((f) => f.path === path && f.type === "blob");
  } catch (err) {
    if (err instanceof TreeTruncatedError) {
      const dirPath = path.split("/").slice(0, -1).join("/");
      const fileName = path.split("/").pop()!;
      const entries = await listFilesNonRecursive(octokit, repo, dirPath, branch);
      entry = entries.find((e) => e.path === fileName && e.type === "blob");
    } else {
      throw err;
    }
  }

  if (!entry?.sha) throw new Error(`Expected file at ${path}, got nothing`);

  const { data } = await octokit.git.getBlob({
    owner,
    repo: repoName,
    file_sha: entry.sha,
  });
  return Buffer.from(data.content, "base64").toString("utf-8");
}
```

**Step 4: Replace `listFiles` implementation**

```ts
export async function listFiles(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<string[]> {
  try {
    const tree = await getTreeCached(octokit, repo, branch);
    const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
    return tree
      .filter(
        (f) =>
          f.path?.startsWith(prefix) &&
          f.type === "blob" &&
          !f.path.slice(prefix.length).includes("/"),
      )
      .map((f) => f.path!.split("/").pop()!);
  } catch (err) {
    if (err instanceof TreeTruncatedError) {
      const entries = await listFilesNonRecursive(octokit, repo, dirPath, branch);
      return entries
        .filter((e) => e.type === "blob")
        .map((e) => e.path!)
        .filter(Boolean);
    }
    throw err;
  }
}
```

**Step 5: Replace `commitFile` with `commitBatch` wrapper**

```ts
export async function commitFile(
  octokit: Octokit,
  repo: string,
  commit: FileCommit,
): Promise<string> {
  return commitBatch(
    octokit,
    repo,
    [{ path: commit.path, content: commit.content }],
    [],
    commit.message,
    commit.branch,
  );
}
```

**Step 6: Add `clearTreeCache` call inside `commitBatch`**

At the end of `commitBatch`, after `updateRef`, add:

```ts
// Invalidate tree cache — the commit changed the tree
clearTreeCache();
```

**Step 7: Run typecheck + tests**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: All pass. Existing tests mock `readFile`/`listFiles`/`commitFile` at the module level so they don't exercise the real GitHub API calls.

**Step 8: Commit**

```bash
git add services/content-pipeline/src/lib/github.ts
git commit -m "feat(pipeline): migrate readFile/listFiles/commitFile to Git Data API (trees+blobs)"
```

---

## Task 4: Separate LLM Generation from Git Push

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts`
- Modify: `services/content-pipeline/src/queue/content-generation.ts`
- Modify: `services/content-pipeline/src/__tests__/process-generate-job.test.ts`

**Step 1: Extract write + n8n logic from `runContentGeneration`**

In `services/content-pipeline/src/agents/content-generation/agent.ts`:

1. Remove the `writeArticleBatch` call block (lines 844-878)
2. Remove the n8n trigger block (lines 880-952)
3. **Keep** `_pendingArticle` and `_imageRequest` in results — do NOT strip them (remove lines 955 that strip internal fields)
4. Return the raw results with internal fields intact

The function signature and return type stay the same (`BatchContentGenerationResult`), but now the results include `_pendingArticle` and `_imageRequest`.

Replace lines 844-965 (from `// Step 6:` to the `return` before `catch`) with:

```ts
    // Return results with internal fields intact — caller handles write + n8n
    return {
      siteDomain,
      requested: targetCount,
      totalSourced: totalFetched,
      duplicateCount,
      availableNew: newItems.length,
      n8nImagesTriggered: 0,
      results,
    };
```

Also remove the `writeArticleBatch` import and the `matter` import if no longer used in this file (check — `matter` is still used in `getAllExistingArticles` so keep it, but `writeArticleBatch` can be removed).

**Step 2: Move push + n8n logic into `processGenerateJob`**

In `services/content-pipeline/src/queue/content-generation.ts`:

1. Add Redis parameter to `processGenerateJob` and `createGenerateWorker`
2. Add checkpoint logic with Redis cache
3. Add the extracted push + n8n trigger code after the LLM phase

```ts
import { Queue, Worker, QueueEvents, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import matter from "gray-matter";
import type { BatchContentGenerationResult, ContentGenerationResult, ExistingArticles } from "../agents/content-generation/agent.js";
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";
import { createOctokit } from "../lib/github.js";
import { readSiteBriefWithFallback } from "../lib/site-brief.js";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import { writeArticleBatch, type PendingArticle, type BatchFileEntry } from "../lib/writer.js";
import { triggerN8nImage, trackPendingImage } from "../agents/content-generation/n8n-image.js";
import { notifyImageDefaultFallback } from "../lib/notifications.js";
import type { AgentConfig } from "../lib/config.js";
import { clearTreeCache } from "../lib/github.js";

// ... keep createGenerateQueue, createGenerateQueueEvents unchanged ...

export async function processGenerateJob(
  job: Job<GenerateJobData>,
  config: AgentConfig,
  redis: Redis,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = job.data;

  // Clear tree cache at start of each job
  clearTreeCache();

  // Pre-flight: verify site exists and has a schedule
  const octokit = createOctokit(config.github);
  let briefData;
  try {
    briefData = await readSiteBriefWithFallback(
      octokit,
      config.networkRepo,
      siteDomain,
      branch,
    );
  } catch {
    throw new UnrecoverableError(
      `Site "${siteDomain}" not found — no brief in staging or main`,
    );
  }

  if (!briefData.data.brief?.schedule) {
    throw new UnrecoverableError(
      `No publishing schedule for ${siteDomain}`,
    );
  }

  // --- Phase 1: LLM generation (skip on retry if cached) ---
  const cacheKey = `job:${job.id}:articles`;
  let result: BatchContentGenerationResult;

  const cached = await redis.get(cacheKey);
  if (cached && job.attemptsMade > 0) {
    result = JSON.parse(cached);
    console.log(
      `[generate] Retry #${job.attemptsMade} for ${siteDomain} — loaded ${result.results.length} cached articles, skipping LLM`,
    );
  } else {
    result = await runContentGeneration(
      { siteDomain, branch, count, jobId: job.id },
      config,
    );
    // Cache before push — so retries skip LLM
    await redis.set(cacheKey, JSON.stringify(result), "EX", 3600);
  }

  // Surface total failure to BullMQ for retry
  const created = result.results.filter((r) => r.status === "created");
  const errors = result.results.filter((r) => r.status === "error");
  if (created.length === 0 && errors.length > 0) {
    const reasons = errors
      .map((r) => r.message ?? "unknown")
      .slice(0, 3)
      .join("; ");
    throw new Error(
      `All ${errors.length} article(s) failed for ${siteDomain}: ${reasons}`,
    );
  }

  // --- Phase 2: Push to Git ---
  if (created.length > 0) {
    const pendingArticles = created
      .map((r) => r._pendingArticle)
      .filter((a): a is PendingArticle => !!a);

    // Build updated dedup index
    const updatedExisting: ExistingArticles = { urls: new Set(), titles: new Set() };
    for (const r of created) {
      if (r._pendingArticle) {
        const { data } = matter(r._pendingArticle.content);
        if (data.source_url) updatedExisting.urls.add(normalizeUrl(data.source_url as string));
        if (data.title) updatedExisting.titles.add(normalizeTitleKey(data.title as string));
      }
    }
    const dedupIndexFile: BatchFileEntry = {
      path: dedupIndexPath(siteDomain),
      content: serializeDedupIndex(updatedExisting),
    };

    const slugList = pendingArticles.map((a) => a.slug).join(", ");
    const commitMsg = `feat(content): add ${pendingArticles.length} article(s) for ${siteDomain}\n\n${slugList}`;

    await writeArticleBatch(
      { localNetworkPath: config.localNetworkPath, github: config.github, branch },
      pendingArticles,
      [],
      commitMsg,
      [dedupIndexFile],
    );
  }

  // --- Phase 3: n8n image triggers (fire-and-forget, after push) ---
  let n8nImagesTriggered = 0;
  const jobId = job.id;
  if (config.n8nImageWebhookUrl && branch) {
    const imageRequests = created
      .filter((r) => r._imageRequest)
      .map((r) => r._imageRequest!);

    if (imageRequests.length > 0) {
      n8nImagesTriggered = imageRequests.length;
      const webhookUrl = config.n8nImageWebhookUrl;
      const callbackUrl = config.imageCallbackUrl ?? "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

      for (const req of imageRequests) {
        void triggerN8nImage(webhookUrl, {
          request_id: req.requestId,
          callback_url: callbackUrl,
          job_id: jobId ?? "",
          site_domain: req.siteDomain,
          slug: req.slug,
          branch,
          article: {
            title: req.articleTitle,
            description: req.articleDescription,
            summary: req.articleSummary,
            vertical: req.vertical,
            source_thumbnail_url: req.sourceThumbnailUrl ?? null,
            image_guidelines: Array.isArray(req.imageGuidelines)
              ? req.imageGuidelines.join("\n")
              : req.imageGuidelines,
          },
        }).then((accepted) => {
          if (accepted) {
            trackPendingImage(req.requestId, req.siteDomain, req.slug, req.articleTitle, config.notifications);
          } else {
            void notifyImageDefaultFallback(config.notifications, {
              site: req.siteDomain, articleTitle: req.articleTitle,
              slug: req.slug, reason: "n8n webhook trigger failed",
            });
          }
        });
      }
    }
  } else if (branch) {
    const imageRequests = created
      .filter((r) => r._imageRequest)
      .map((r) => r._imageRequest!);
    for (const req of imageRequests) {
      void notifyImageDefaultFallback(config.notifications, {
        site: req.siteDomain, articleTitle: req.articleTitle,
        slug: req.slug, reason: "n8n image webhook not configured (N8N_IMAGE_WEBHOOK_URL unset)",
      });
    }
  }

  // Clean up Redis cache on success
  await redis.del(cacheKey);

  // Strip internal fields before returning
  const cleanResults = result.results.map(({ _pendingArticle, _imageRequest, ...rest }) => rest);

  return {
    ...result,
    n8nImagesTriggered,
    results: cleanResults,
  };
}

export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
  config: AgentConfig,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker(
    GENERATE_QUEUE,
    async (job) => processGenerateJob(job, config, connection),
    { connection, concurrency },
  );
}
```

**Step 3: Export new symbols from `agent.ts`**

In `agent.ts`, ensure these are exported (they're already exported per `export function` / `export interface`):
- `normalizeUrl`, `normalizeTitleKey`, `dedupIndexPath`, `serializeDedupIndex` — already exported
- `ExistingArticles` — already exported

**Step 4: Update tests for `processGenerateJob`**

In `__tests__/process-generate-job.test.ts`:

- Add a mock Redis to every `processGenerateJob` call
- Update the mock for `createGitHubClient` → `createOctokit`
- Add tests for the Redis checkpoint behavior

```ts
// Add mock Redis at the top:
const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
} as unknown as Redis;

// Update every processGenerateJob call to pass mockRedis:
// Old: processGenerateJob(makeJob(), config)
// New: processGenerateJob(makeJob(), config, mockRedis)

// Add new test:
it("uses cached results on retry (skips LLM)", async () => {
  const cachedResult = {
    siteDomain: "test.com",
    requested: 3,
    totalSourced: 5,
    duplicateCount: 0,
    availableNew: 5,
    n8nImagesTriggered: 0,
    results: [{ status: "created", slug: "cached-article" }],
  };
  mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedResult));
  mockReadSiteBriefWithFallback.mockResolvedValue(makeBriefResult());

  const job = makeJob();
  (job as any).attemptsMade = 1;

  const result = await processGenerateJob(job, config, mockRedis);
  expect(mockRunContentGeneration).not.toHaveBeenCalled();
  expect(result.results).toHaveLength(1);
});
```

**Step 5: Run tests**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts \
  services/content-pipeline/src/queue/content-generation.ts \
  services/content-pipeline/src/__tests__/process-generate-job.test.ts
git commit -m "feat(pipeline): separate LLM generation from Git push — Redis checkpoint for retry"
```

---

## Task 5: Dashboard — Tree Cache + Blob-Based Reads

**Files:**
- Modify: `services/dashboard/src/lib/github.ts`

**Step 1: Add tree cache infrastructure**

Add after the existing `dashboardIndexCache` section (~line 75):

```ts
// Tree cache — per-branch, 60-second TTL (longer than dashboardIndex because
// trees change less frequently during interactive sessions)
interface TreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
}

const TREE_CACHE_TTL = 60_000;
const treeCacheStore = new Map<string, { tree: TreeEntry[]; expiresAt: number }>();

async function getTreeCached(branch?: string): Promise<TreeEntry[]> {
  const ref = branch ?? "main";
  const cached = treeCacheStore.get(ref);
  if (cached && Date.now() < cached.expiresAt) return cached.tree;

  const octokit = getOctokit();
  const { data: refData } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${ref}`,
  });
  const { data: tree } = await octokit.git.getTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    tree_sha: refData.object.sha,
    recursive: "true",
  });

  if (tree.truncated) {
    console.warn(`[github] Tree for ${ref} is truncated`);
    throw new Error(`Tree truncated for ${ref}`);
  }

  treeCacheStore.set(ref, { tree: tree.tree, expiresAt: Date.now() + TREE_CACHE_TTL });
  return tree.tree;
}

function invalidateTreeCache(branch?: string): void {
  if (branch) {
    treeCacheStore.delete(branch);
  } else {
    treeCacheStore.clear();
  }
}
```

**Step 2: Migrate `readFileContent` to tree+blob**

Replace the body of `readFileContent` (lines 488-511):

```ts
export async function readFileContent(
  path: string,
  branch?: string,
  repo?: { owner: string; name: string },
): Promise<string | null> {
  // Custom repo — can't use tree cache (different repo)
  if (repo) {
    const octokit = getOctokit();
    try {
      const { data } = await octokit.repos.getContent({
        owner: repo.owner, repo: repo.name, path,
        ...(branch ? { ref: branch } : {}),
      });
      if ("content" in data && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  // Network repo — use tree cache
  try {
    const tree = await getTreeCached(branch);
    const entry = tree.find((f) => f.path === path && f.type === "blob");
    if (!entry?.sha) return null;

    const octokit = getOctokit();
    const { data } = await octokit.git.getBlob({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      file_sha: entry.sha,
    });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}
```

**Step 3: Migrate `readFileBase64` to tree+blob**

```ts
export async function readFileBase64(
  path: string,
  branch?: string,
): Promise<string | null> {
  try {
    const tree = await getTreeCached(branch);
    const entry = tree.find((f) => f.path === path && f.type === "blob");
    if (!entry?.sha) return null;

    const octokit = getOctokit();
    const { data } = await octokit.git.getBlob({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      file_sha: entry.sha,
    });
    return data.content.replace(/\n/g, "");
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}
```

**Step 4: Migrate `readArticles` to tree+blob**

Replace the `repos.getContent` calls (lines 639-677) with tree-based reads:

```ts
export async function readArticles(domain: string, branch?: string): Promise<ArticleEntry[]> {
  const cached = getCachedArticles(domain, branch);
  if (cached) return cached;

  const octokit = getOctokit();
  try {
    const tree = await getTreeCached(branch);
    const prefix = `sites/${domain}/articles/`;
    const mdEntries = tree.filter(
      (f) =>
        f.path?.startsWith(prefix) &&
        f.type === "blob" &&
        f.path.endsWith(".md") &&
        !f.path.endsWith(".gitkeep") &&
        !f.path.slice(prefix.length).includes("/"),
    );

    const results = await Promise.allSettled(
      mdEntries.map(async (entry) => {
        const { data } = await octokit.git.getBlob({
          owner: NETWORK_REPO_OWNER,
          repo: NETWORK_REPO_NAME,
          file_sha: entry.sha!,
        });
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        const frontmatter = extractFrontmatter(content);
        const fileName = entry.path!.split("/").pop()!;
        return {
          slug: fileName.replace(".md", ""),
          title: (frontmatter.title as string) ?? fileName,
          type: (frontmatter.type as string) ?? "standard",
          status: (frontmatter.status as string) ?? "draft",
          publishDate: (frontmatter.publishDate as string) ?? "",
          featuredImage: (frontmatter.featuredImage as string) ?? undefined,
          score: (frontmatter.quality_score as number) ?? (frontmatter.score as number | undefined),
          scoreBreakdown: frontmatter.score_breakdown as ArticleEntry["scoreBreakdown"],
          qualityNote: frontmatter.quality_note as string | undefined,
          reviewerNotes: frontmatter.reviewer_notes as string | undefined,
        } as ArticleEntry;
      }),
    );

    const articles: ArticleEntry[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) articles.push(r.value);
    }
    setCachedArticles(domain, branch, articles);
    return articles;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}
```

**Step 5: Migrate `readDashboardIndex` to tree+blob**

Replace the `repos.getContent` call in `readDashboardIndex` (lines 88-94):

```ts
// Replace:
const { data } = await octokit.repos.getContent({
  owner: NETWORK_REPO_OWNER,
  repo: NETWORK_REPO_NAME,
  path: DASHBOARD_INDEX_PATH,
});
if ("content" in data && data.content) {
  const content = Buffer.from(data.content, "base64").toString("utf-8");

// With:
const tree = await getTreeCached();
const entry = tree.find((f) => f.path === DASHBOARD_INDEX_PATH && f.type === "blob");
if (!entry?.sha) {
  const empty: DashboardIndex = { sites: [], deleted: [] };
  dashboardIndexCache.set(empty);
  return empty;
}
const { data: blobData } = await octokit.git.getBlob({
  owner: NETWORK_REPO_OWNER,
  repo: NETWORK_REPO_NAME,
  file_sha: entry.sha,
});
const content = Buffer.from(blobData.content, "base64").toString("utf-8");
```

**Step 6: Migrate `writeDashboardIndex` SHA fetch to tree**

In `writeDashboardIndex` (lines 148-158), replace the `repos.getContent` SHA fetch:

```ts
// Replace the SHA fetch with:
let sha: string | undefined;
try {
  const tree = await getTreeCached();
  const entry = tree.find((f) => f.path === DASHBOARD_INDEX_PATH && f.type === "blob");
  sha = entry?.sha;
} catch {
  // File doesn't exist yet
}
invalidateTreeCache(); // will be stale after the write
```

**Step 7: Migrate `deleteSiteFilesFromRepo` to tree**

Replace the recursive `repos.getContent` calls (lines 282-310) with a tree filter:

```ts
export async function deleteSiteFilesFromRepo(domain: string): Promise<void> {
  const octokit = getOctokit();
  const tree = await getTreeCached();

  const files: Array<{ path: string; sha: string }> = [];
  for (const prefix of [`sites/${domain}/`, `overrides/${domain}/`]) {
    for (const entry of tree) {
      if (entry.path?.startsWith(prefix) && entry.type === "blob" && entry.sha) {
        files.push({ path: entry.path, sha: entry.sha });
      }
    }
  }

  if (files.length === 0) return;
  // ... rest of the delete logic (createTree with sha: null) stays the same
```

**Step 8: Migrate `triggerWorkflowViaPush` SHA fetch only**

In `triggerWorkflowViaPush` (lines 786-797), replace the `repos.getContent` SHA fetch but **keep** the `repos.createOrUpdateFileContents` write:

```ts
// Replace SHA fetch:
let existingSha: string | undefined;
try {
  const tree = await getTreeCached(branch);
  const entry = tree.find((f) => f.path === triggerPath && f.type === "blob");
  existingSha = entry?.sha;
} catch {
  // File doesn't exist yet
}
invalidateTreeCache(branch);

// Keep the createOrUpdateFileContents write — it triggers GitHub Actions
await octokit.repos.createOrUpdateFileContents({ /* unchanged */ });
```

**Step 9: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Pass.

**Step 10: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "feat(dashboard): migrate GitHub reads to Git Data API (tree cache + blobs)"
```

---

## Task 6: Dashboard — Fix Raw Octokit Calls

**Files:**
- Modify: `services/dashboard/src/actions/agent.ts`
- Modify: `services/dashboard/src/app/api/agent/commit-article/route.ts`

**Step 1: Migrate `actions/agent.ts`**

Replace the raw `new Octokit()` on line 26 with the shared singleton. Migrate `repos.getContent` + `repos.createOrUpdateFileContents` to use `readFileContent` + `commitSiteFiles`:

```ts
// Old (line 26):
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// New:
import { readFileContent, commitSiteFiles } from "@/lib/github";
```

Replace the `getContent` + `createOrUpdateFileContents` pattern with calls to the migrated functions.

**Step 2: Migrate `commit-article/route.ts`**

Same pattern — replace raw `new Octokit()` with `getOctokit()` from `@/lib/github`, and replace `repos.getContent` SHA fetch + `repos.createOrUpdateFileContents` with `commitSiteFiles`.

**Step 3: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Pass.

**Step 4: Commit**

```bash
git add services/dashboard/src/actions/agent.ts services/dashboard/src/app/api/agent/commit-article/route.ts
git commit -m "fix(dashboard): replace raw Octokit() with shared resilient singleton"
```

---

## Task 7: General-Images Page — KV REST API

**Files:**
- Create: `services/dashboard/src/lib/kv-api.ts`
- Modify: `services/dashboard/src/app/api/articles/general-images/route.ts`

**Step 1: Create KV REST API helper**

Create `services/dashboard/src/lib/kv-api.ts`:

```ts
import {
  KV_NAMESPACE_PROD,
  KV_NAMESPACE_STAGING,
} from "@/lib/constants";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

export interface KVArticleIndexEntry {
  slug: string;
  title: string;
  description?: string;
  author: string;
  publishDate: string;
  featuredImage?: string;
  tags: string[];
  type: string;
  status: string;
}

export async function readArticleIndexFromKV(
  domain: string,
  namespace: "staging" | "production" = "staging",
): Promise<KVArticleIndexEntry[] | null> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.warn("[kv-api] CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set — skipping KV read");
    return null;
  }

  const namespaceId = namespace === "staging" ? KV_NAMESPACE_STAGING : KV_NAMESPACE_PROD;
  const key = `article-index:${domain}`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as KVArticleIndexEntry[];
  } catch {
    return null;
  }
}
```

**Step 2: Migrate general-images route**

In `services/dashboard/src/app/api/articles/general-images/route.ts`:

Replace the `readArticles` import and loop with `readArticleIndexFromKV`:

```ts
import { readDashboardIndex } from "@/lib/github";
import { readArticleIndexFromKV } from "@/lib/kv-api";
import { isGeneralImage } from "@/lib/general-image-utils";

// ... keep interfaces ...

async function loadGeneralImageArticles(): Promise<GeneralImageArticle[]> {
  const now = Date.now();
  if (cachedResults && now - cachedResults.ts < CACHE_TTL_MS) {
    return cachedResults.data;
  }

  const index = await readDashboardIndex();
  const activeSites = index.sites.filter(
    (s) =>
      s.status === "Staging" ||
      s.status === "Ready" ||
      s.status === "Live" ||
      s.status === "WordPress",
  );

  const results: GeneralImageArticle[] = [];

  await Promise.allSettled(
    activeSites.map(async (site) => {
      const kvNamespace = site.status === "Live" ? "production" : "staging";
      const articles = await readArticleIndexFromKV(site.domain, kvNamespace);
      if (!articles) return;
      for (const a of articles) {
        if (isGeneralImage(a.featuredImage, site.domain)) {
          results.push({
            domain: site.domain,
            siteName: site.domain,
            slug: a.slug,
            title: a.title,
            featuredImage: a.featuredImage,
            publishDate: a.publishDate,
            status: a.status,
            stagingBranch: site.staging_branch ?? null,
          });
        }
      }
    }),
  );

  results.sort(
    (a, b) =>
      new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime(),
  );

  cachedResults = { data: results, ts: now };
  return results;
}
```

**Step 3: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Pass.

**Step 4: Commit**

```bash
git add services/dashboard/src/lib/kv-api.ts services/dashboard/src/app/api/articles/general-images/route.ts
git commit -m "feat(dashboard): general-images reads from KV REST API instead of GitHub (~946 → 46 calls)"
```

---

## Task 8: Typecheck + Full Test Suite

**Step 1: Run monorepo typecheck**

Run: `pnpm typecheck`
Expected: All packages pass.

**Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

**Step 3: Fix any failures**

Address any remaining type errors or test failures from the migration.

**Step 4: Final commit if fixes needed**

```bash
git commit -m "fix: address typecheck/test issues from GitHub API migration"
```

---

## Task 9: Manual Verification

**Step 1: Start local dev**

Run: `cloudgrid dev`

**Step 2: Test content generation**

Trigger a generate for one site from the dashboard. Verify:
- Articles created successfully
- Logs show `[github] Rate limit hit` retries (if applicable) instead of crashes
- No `repos.getContent` deprecation warnings in logs

**Step 3: Test general-images page**

Navigate to `/articles/general-images`. Verify:
- Page loads without errors
- Articles display with correct image status
- No GitHub API calls for article reads (check server logs)

**Step 4: Test dashboard config pages**

Browse site configs, org settings, groups. Verify:
- All config data loads correctly
- Tree cache reuse visible in logs (single tree fetch per branch per 60s window)

**Step 5: Commit any fixes**

```bash
git commit -m "fix: manual verification fixes"
```
