# GitHub API Resilience — Design Spec

**Date:** 2026-05-26
**Status:** Approved
**Trigger:** Rate limit exhaustion during 30+ site WordPress import; deprecated `/contents/` endpoint (removal March 2028)

## Problem

Three compounding issues with GitHub API usage across the platform:

1. **No retry on rate limit in content-pipeline.** The content generation agent uses plain Octokit (`createGitHubClient`) without retry or throttling plugins. A rate limit error crashes the job, and BullMQ retries re-run the entire LLM pipeline (Claude/OpenAI generation, quality scoring, SEO metadata) — wasting tokens and time just to retry a Git push.

2. **All reads use the deprecated `/contents/` endpoint.** `repos.getContent` is scheduled for removal on 2028-03-10. Every `readFile` and `listFiles` call in both `content-pipeline/src/lib/github.ts` and `dashboard/src/lib/github.ts` uses this endpoint — ~15 call sites in the dashboard, ~5 core functions in the pipeline.

3. **Per-file reads are inefficient.** Each `repos.getContent` call is 1 API request. A dedup scan of 50 articles = 52 API calls (1 list + 51 reads). Multi-site operations like WP import or scheduled generation across 30+ sites exhaust the 5,000/hour rate limit quickly.

## Non-Problem

Live site traffic is unaffected by GitHub rate limits. The Cloudflare Worker serves from KV + R2, never GitHub. The sync path is push-based: Git commit → `sync-kv.yml` Action → `seed-kv.ts` (local checkout, no API) → KV/R2. Once data is in KV, GitHub is irrelevant to readers.

## Solution

Three changes:

### 1. Resilient Client Everywhere

Remove `createGitHubClient`. Make `createResilientOctokit` the only Octokit factory in `content-pipeline/src/lib/github.ts`.

**Current state:**
- `createGitHubClient(config: GitHubConfig)` — plain Octokit, no plugins. Used by ~25 call sites.
- `createResilientOctokit(token: string)` — `@octokit/plugin-retry` + `@octokit/plugin-throttling`. Used by 2 call sites (CSV import only).

**Changes:**
- Delete `createGitHubClient`.
- Rename `createResilientOctokit` → `createOctokit`. Support overloaded signature: `createOctokit(token: string)` (used by import jobs that receive a raw token) and `createOctokit(config: GitHubConfig)` (used by agent code that has `AgentConfig`). Internally, extract the token from whichever form is passed.
- Remove `doNotRetry: ["429"]` from the retry config — this currently prevents the retry plugin from handling 429 responses, which is counterproductive when the throttle plugin should be handling them.
- Update all ~25 call sites in content-pipeline + tests.

The dashboard already uses `RetryOctokit` with throttling (singleton in `dashboard/src/lib/github.ts`). No changes needed there.

**Throttle behavior (preserved from current `createResilientOctokit`):**
- Primary rate limit: retry up to 2 times, wait `retryAfter` seconds
- Secondary rate limit: retry once, wait `retryAfter` seconds
- 5xx / network errors: retry up to 3 times (from `@octokit/plugin-retry`)

### 2. Separate LLM Generation from Git Push

Split `processGenerateJob` into two phases with a Redis checkpoint, so BullMQ retries only re-push — never re-generate.

**Current flow:**
```
processGenerateJob
  → runContentGeneration (LLM + quality + push — all in one)
  → failure at push step → BullMQ retries entire job → re-runs LLM
```

**New flow:**
```
processGenerateJob
  ├─ Check Redis for cached results (key: job:<jobId>:articles)
  ├─ If retry (attemptsMade > 0) and cache exists → skip to push phase
  ├─ Else → Phase 1: runContentGeneration (LLM only, no push)
  ├─ Cache results in Redis (TTL: 1 hour)
  └─ Phase 2: push (writeArticleBatch) + n8n image triggers
```

**Implementation details:**

1. **Modify `runContentGeneration`:** Remove the `writeArticleBatch` call (currently at line 871 of `agent.ts`). The function returns `BatchContentGenerationResult` with `_pendingArticle` fields intact (don't strip them). The caller is responsible for writing.

2. **Modify `processGenerateJob`:** Add Redis checkpoint logic:
   ```ts
   const cacheKey = `job:${job.id}:articles`;
   let result: BatchContentGenerationResult;

   const cached = await redis.get(cacheKey);
   if (cached && job.attemptsMade > 0) {
     result = JSON.parse(cached);
   } else {
     result = await runContentGeneration(params, config);
     await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
   }

   // Push phase — extracted from runContentGeneration
   const created = result.results.filter(r => r.status === 'created');
   if (created.length > 0) {
     // writeArticleBatch + dedup index update
   }

   // n8n image triggers — only after successful push
   ```

3. **Redis key TTL:** 1 hour. BullMQ exponential backoff is 30s → 60s → 120s (3 attempts total = ~3.5 min). 1 hour provides ample margin.

4. **Redis access:** The BullMQ worker already has a Redis connection. Pass it to `processGenerateJob` or access via the worker's connection.

5. **n8n image triggers:** Move out of `runContentGeneration` and into `processGenerateJob`, after the push succeeds. Already fire-and-forget, so no change to their behavior — just relocated.

### 3. Migrate Reads to Git Data API

Replace all `repos.getContent` reads with `git.getTree` (recursive) + `git.getBlob`. Replace single-file writes (`repos.createOrUpdateFileContents`) with `commitBatch` (already uses Git Data API).

#### New read primitives (content-pipeline `github.ts`)

**`getTree` with per-operation cache:**
```ts
const treeCache = new Map<string, TreeEntry[]>();

async function getTreeCached(
  octokit: Octokit,
  repo: string,
  branch?: string,
): Promise<TreeEntry[]> {
  const ref = branch ?? 'main';
  const cacheKey = `${repo}:${ref}`;
  if (treeCache.has(cacheKey)) return treeCache.get(cacheKey)!;

  const { owner, repo: repoName } = parseRepo(repo);
  const { data: refData } = await octokit.git.getRef({
    owner, repo: repoName, ref: `heads/${ref}`,
  });
  const { data: tree } = await octokit.git.getTree({
    owner, repo: repoName, tree_sha: refData.object.sha, recursive: 'true',
  });

  // GitHub truncates recursive trees at 100,000 entries / 7 MB.
  // If truncated, fall back to non-recursive per-directory fetches.
  if (tree.truncated) {
    console.warn(`[github] Tree for ${ref} is truncated — falling back to per-directory fetches`);
    throw new TreeTruncatedError(ref);
  }

  treeCache.set(cacheKey, tree.tree);
  return tree.tree;
}

function clearTreeCache(): void {
  treeCache.clear();
}
```

**Truncation handling:** The network repo has 30+ sites with articles, configs, themes, and assets. A recursive tree could exceed GitHub's 100,000-entry / 7 MB limit. When `tree.truncated === true`, `getTreeCached` throws `TreeTruncatedError`. Callers fall back to non-recursive per-directory tree fetches:

```ts
class TreeTruncatedError extends Error {
  constructor(ref: string) { super(`Tree truncated for ref: ${ref}`); }
}

// Fallback: fetch tree for a specific directory only
async function listFilesNonRecursive(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<TreeEntry[]> {
  // Walk path segments to find the subtree SHA, then fetch just that subtree
  const { owner, repo: repoName } = parseRepo(repo);
  const ref = branch ?? 'main';
  const { data: refData } = await octokit.git.getRef({ owner, repo: repoName, ref: `heads/${ref}` });
  let treeSha = (await octokit.git.getCommit({ owner, repo: repoName, commit_sha: refData.object.sha })).data.tree.sha;

  for (const segment of dirPath.split('/').filter(Boolean)) {
    const { data: tree } = await octokit.git.getTree({ owner, repo: repoName, tree_sha: treeSha });
    const entry = tree.tree.find(e => e.path === segment && e.type === 'tree');
    if (!entry?.sha) throw new Error(`Directory not found: ${dirPath}`);
    treeSha = entry.sha;
  }

  const { data: dirTree } = await octokit.git.getTree({ owner, repo: repoName, tree_sha: treeSha });
  return dirTree.tree;
}
```

**Cache invalidation:** `clearTreeCache()` must be called at the start of each `processGenerateJob` invocation, and after any `commitBatch` call (since commits change the tree SHA).
```

**`readFile` replacement (text):**
```ts
async function readFile(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  const tree = await getTreeCached(octokit, repo, branch);
  const entry = tree.find(f => f.path === path && f.type === 'blob');
  if (!entry?.sha) throw new Error(`File not found: ${path}`);

  const { owner, repo: repoName } = parseRepo(repo);
  const { data } = await octokit.git.getBlob({
    owner, repo: repoName, file_sha: entry.sha,
  });
  return Buffer.from(data.content, 'base64').toString('utf-8');
}
```

**`readFileBase64` replacement (binary assets):**

The dashboard has `readFileBase64` for reading logos, favicons, and other binary assets. `git.getBlob` returns base64 natively — skip the UTF-8 decode:

```ts
async function readFileBase64(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string | null> {
  try {
    const tree = await getTreeCached(octokit, repo, branch);
    const entry = tree.find(f => f.path === path && f.type === 'blob');
    if (!entry?.sha) return null;

    const { owner, repo: repoName } = parseRepo(repo);
    const { data } = await octokit.git.getBlob({
      owner, repo: repoName, file_sha: entry.sha,
    });
    return data.content.replace(/\n/g, '');
  } catch {
    return null;
  }
}
```

Dashboard call sites: `wizard.ts` (lines 540, 1146), `/api/sites/asset/route.ts` (line 34).
```

**`listFiles` replacement:**
```ts
async function listFiles(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<string[]> {
  const tree = await getTreeCached(octokit, repo, branch);
  const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
  return tree
    .filter(f => f.path?.startsWith(prefix) && f.type === 'blob'
      && !f.path.slice(prefix.length).includes('/'))
    .map(f => f.path!.split('/').pop()!);
}
```

**SHA lookup for writes:**
```ts
async function getFileSha(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string | undefined> {
  const tree = await getTreeCached(octokit, repo, branch);
  return tree.find(f => f.path === path && f.type === 'blob')?.sha ?? undefined;
}
```

#### `commitFile` becomes a `commitBatch` wrapper

Currently `commitFile` does: `getContent` (read SHA) → `createOrUpdateFileContents`. Replace with:

```ts
async function commitFile(
  octokit: Octokit,
  repo: string,
  commit: FileCommit,
): Promise<string> {
  return commitBatch(
    octokit, repo,
    [{ path: commit.path, content: commit.content }],
    [],
    commit.message,
    commit.branch,
  );
}
```

This eliminates the last `repos.createOrUpdateFileContents` call in the pipeline.

#### Dashboard migration

The dashboard's `github.ts` has more call sites (~15 `repos.getContent`). Same approach:

- Add `getTreeCached` and blob-based `readFileContent` to the dashboard's github module
- The dashboard already has a TTL cache for `dashboard-index.yaml` — extend the pattern: cache the tree for 30-60 seconds to avoid refetching on rapid page loads
- Key functions to migrate: `readFileContent`, `readSiteConfig`, `listSiteArticles`, `readArticle`, `commitNetworkFiles` (SHA lookup), `readGroupConfig`, `readOrgConfig`, `readSchedulerConfig`
- Writes: `commitNetworkFiles` already builds multi-file commits — convert its SHA-fetching step to use the tree cache instead of `getContent`

#### `import-finalize.ts` and `.build-trigger`

Lines 107-134 use `repos.getContent` + `repos.createOrUpdateFileContents` for KV sync triggers (`.build-trigger` files). **This mechanism must stay.** Git Data API commits (`createTree` → `createCommit` → `updateRef`) do NOT trigger GitHub Actions — only Contents API pushes do. Since `import-site.ts` uses `commitBatch` (Git Data API), the subsequent `.build-trigger` push via Contents API in `import-finalize.ts` is the only thing that fires `sync-kv.yml`.

**Changes:** Keep `triggerWorkflowViaPush` using `repos.createOrUpdateFileContents` — this is one of the few `/contents/` calls that must remain because GitHub Actions requires it. Migrate the SHA-fetching `repos.getContent` call to use the tree cache (`getFileSha`) instead, but keep the final write via Contents API.

Alternatively, in a future follow-up: add `actions:write` scope to `GITHUB_TOKEN` and replace with `workflow_dispatch`, which would eliminate the last `/contents/` call. Not in scope for this change.

The same applies to `dashboard/src/lib/github.ts` `triggerWorkflowViaPush` (lines 765-808) and `/api/sites/rebuild/route.ts`.

#### What gets deleted

- `repos.getContent` — all usages across both services, **except** SHA-fetching inside `triggerWorkflowViaPush` (migrated to tree cache) 
- `repos.createOrUpdateFileContents` — all usages replaced by `commitBatch`, **except** `triggerWorkflowViaPush` (must stay on Contents API to trigger GitHub Actions)
- `createGitHubClient` — entire function
- Raw `new Octokit()` calls in dashboard `actions/agent.ts` and `commit-article/route.ts` — replaced with `getOctokit()` singleton

## API Call Reduction

**WordPress import of 30 sites (estimated):**

| Operation | Old | New |
|-----------|-----|-----|
| Import-finalize: read dashboard-index | 1 | 1 tree + 1 blob = 2 (tree cached) |
| Import-finalize: per-site KV trigger (read + write) | 60 (2 × 30) | 0 (removed or batched) |
| Dashboard reads during import | ~30-50 | ~5 (tree cached) |
| **Total overhead** | **~90-110** | **~7** |

(Site scaffolding in `import-site.ts` already uses `commitBatch` — no change needed there.)

**Scheduled generation across 10 sites (estimated):**

| Operation | Old | New |
|-----------|-----|-----|
| Read scheduler config | 1 | 1 tree + 1 blob = 2 (tree cached for main) |
| Read dashboard-index | 1 | 1 blob (tree cached) |
| Per-site: read brief | 10 | 10 blobs (1 tree per branch, cached) |
| Per-site: read dedup index | 10 | 10 blobs (tree cached per branch) |
| Per-site: slug checks | ~30 | 0 (tree cached) |
| **Total** | **~52** | **~33** |

Savings are modest for single operations but compound significantly under concurrent load.

## Files Changed

### content-pipeline
| File | Change |
|------|--------|
| `src/lib/github.ts` | Core: remove `createGitHubClient`, rename `createResilientOctokit`, add tree-based `readFile`/`listFiles`/`getFileSha`, make `commitFile` a `commitBatch` wrapper |
| `src/agents/content-generation/agent.ts` | Remove `writeArticleBatch` + n8n triggers (moved to caller). Update all `createGitHubClient` → `createOctokit` |
| `src/queue/content-generation.ts` | Add Redis checkpoint, extracted push + n8n trigger logic |
| `src/lib/writer.ts` | Update `createGitHubClient` → `createOctokit` |
| `src/agents/content-generation/index.ts` | Update client calls |
| `src/agents/content-generation/n8n-image.ts` | Update client calls |
| `src/agents/content-generation/bulk-image.ts` | Update client calls |
| `src/agents/article-regeneration/index.ts` | Update client calls |
| `src/agents/scheduled-publisher/index.ts` | Update client calls |
| `src/agents/scheduled-publisher/history.ts` | Update client calls |
| `src/queue/scheduler-flow.ts` | Update client calls |
| `src/queue/import-finalize.ts` | Remove `/contents/` KV trigger, use `commitBatch` or remove `.build-trigger` |
| `src/lib/site-brief.ts` | Update to use new `readFile` (no API change — same signature) |
| `src/__tests__/*.test.ts` | Update mocks for renamed factory |

### dashboard
| File | Change |
|------|--------|
| `src/lib/github.ts` | Add tree cache + blob-based reads, migrate ~14 `repos.getContent` sites, add `readFileBase64` blob variant, keep `triggerWorkflowViaPush` on Contents API (migrate only its SHA-fetch to tree cache) |
| `src/actions/agent.ts` | Replace raw `new Octokit()` (line 26) with `getOctokit()` singleton. Migrate `repos.getContent` + `createOrUpdateFileContents` |
| `src/app/api/agent/commit-article/route.ts` | Replace raw `new Octokit()` with `getOctokit()` singleton. Migrate to tree-based SHA lookup + `commitBatch` |
| `src/app/api/sites/rebuild/route.ts` | Uses `triggerWorkflowViaPush` — no change (kept on Contents API) |
| `src/app/api/sites/asset/route.ts` | Migrate to `readFileBase64` blob variant |
| `src/actions/wizard.ts` | Migrate `readFileBase64` calls (lines 540, 1146) |

## Testing

- Existing Vitest tests cover `readFile`, `listFiles`, `commitFile`, `commitBatch`, `processGenerateJob`, scheduler flow. Update mocks to match new API (tree/blob instead of getContent).
- Manual test: run content generation for 1 site, verify articles committed correctly.
- Manual test: run WP import with 2-3 sites, verify no rate limit issues.
- Verify: trigger a rate limit by temporarily lowering throttle thresholds, confirm BullMQ retry uses cached articles (no LLM re-run in logs).

## Rollback

Each section is independently deployable:
1. Resilient client — revert the rename, no behavioral change
2. Redis checkpoint — remove checkpoint logic, `processGenerateJob` runs as before
3. Trees API — revert `readFile`/`listFiles` to `getContent` calls

No data migration. No KV schema changes. No infrastructure changes.
