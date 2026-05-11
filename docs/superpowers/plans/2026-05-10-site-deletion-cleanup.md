# Site Deletion Cleanup — Fix All Four Orphan Gaps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that deleting a site removes all related data from KV, R2, and Git — no orphaned resources left behind.

**Architecture:** Extend the existing `deleteSiteEntry()` flow in `services/dashboard/src/actions/sites.ts` with four new cleanup steps: (1) delete `article:<siteId>:*` and `shared-page:<siteId>:*` KV entries using a new prefix-based bulk delete helper, (2) delete `overrides/<siteId>/` files from Git main (in the same commit as `sites/<domain>/` deletion to avoid race conditions), (3) delete `<siteId>/*` objects from R2 buckets. Mirror the same cleanup in `permanentlyDeleteSite()` as a safety net for partial soft-delete failures.

**Tech Stack:** TypeScript, Cloudflare KV API (v4), Cloudflare R2 S3-compatible API (`@aws-sdk/client-s3`), Octokit (GitHub Git Data API)

---

## Current State

`deleteSiteEntry()` in `services/dashboard/src/actions/sites.ts` performs 5 steps:

1. Delete staging branch (this also removes override files on the staging branch)
2. Delete `sites/<domain>/` files from Git main
3. Delete CF Pages project
4. Delete known KV keys (`site:*`, `site-config:*`, `article-index:*`, `sync-status:*`) from staging + prod
5. Move to trash in `dashboard-index.yaml`

**Four gaps exist** — these resources are NOT cleaned up:

| Gap | Resource | Location | Why missed |
|-----|----------|----------|------------|
| 1 | `article:<siteId>:<slug>` | KV (staging + prod) | KV has no prefix-delete; slugs unknown without enumeration |
| 2 | `shared-page:<siteId>:<name>` | KV (staging + prod) | Not referenced in deletion logic at all |
| 3 | `overrides/<siteId>/*.md` | Git main branch (after publish-to-prod merges overrides to main) | `deleteSiteFilesFromRepo` only targets `sites/<domain>/` |
| 4 | `<siteId>/assets/*` | R2 (`atl-assets-staging` + `atl-assets-prod`) | No R2 cleanup code exists anywhere |

Additionally, `site-config-prev:<siteId>` (defined in KV schema, may be written by future sync flows) is not deleted.

**Note on Gap 3:** Shared-page overrides are initially written to `staging/<siteId>` branches (see `shared-pages.ts`). Deleting the staging branch (step 1) already removes those. However, when a site is published to production, the staging branch is merged to main, which copies `overrides/<siteId>/` files to main. These persist after deletion. This gap is a safety net for that case.

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `services/dashboard/src/lib/cloudflare.ts` | Modify | Add `bulkDeleteKV`, `deleteKVByPrefix`, R2 helpers |
| `services/dashboard/src/lib/constants.ts` | Modify | Add R2 bucket name constants |
| `services/dashboard/src/lib/github.ts` | Modify | Extend `deleteSiteFilesFromRepo` to also delete `overrides/<siteId>/` |
| `services/dashboard/src/actions/sites.ts` | Modify | Wire new cleanup into `deleteSiteEntry` + `permanentlyDeleteSite` |
| `services/dashboard/package.json` | Modify | Add `@aws-sdk/client-s3` dependency |
| `CLAUDE.md` | Modify | Update landmine #22 and env vars table |

---

## Task 1: Add `bulkDeleteKV` helper to cloudflare.ts

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts:500-522` (after `bulkPutKV`)

The Cloudflare API supports bulk KV deletion at `DELETE /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk`. This mirrors the existing `bulkPutKV` pattern.

- [ ] **Step 1: Add `bulkDeleteKV` function**

Add this function directly after `bulkPutKV` in `cloudflare.ts`:

```typescript
/** Bulk delete KV entries by key. Accepts up to 10,000 keys per call.
 *  No-op if keys array is empty. Missing keys are silently ignored. */
export async function bulkDeleteKV(
  namespaceId: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "DELETE",
      headers: getHeaders(),
      body: JSON.stringify(keys),
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to bulk delete ${keys.length} KV keys: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): add bulkDeleteKV helper for batch KV cleanup"
```

---

## Task 2: Add `deleteKVByPrefix` helper to cloudflare.ts

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts` (after `bulkDeleteKV`)

Combines `listKVKeys` + `bulkDeleteKV` into a single convenience function. Note: `listKVKeys` loads all matching keys into memory. For typical sites (<1000 articles), this is fine. Sites with 10,000+ articles would use more memory but still work correctly — the 10,000-key batch limit on the delete call handles chunking.

- [ ] **Step 1: Add `deleteKVByPrefix` function**

Add this function after `bulkDeleteKV`:

```typescript
/** List all KV keys matching a prefix, then bulk-delete them.
 *  Returns the number of keys deleted. Handles pagination internally. */
export async function deleteKVByPrefix(
  namespaceId: string,
  prefix: string,
): Promise<number> {
  const keys = await listKVKeys(namespaceId, prefix);
  if (keys.length === 0) return 0;
  // CF bulk delete supports up to 10,000 keys per call
  for (let i = 0; i < keys.length; i += 10_000) {
    await bulkDeleteKV(namespaceId, keys.slice(i, i + 10_000));
  }
  return keys.length;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): add deleteKVByPrefix — list + bulk-delete by prefix"
```

---

## Task 3: Extend `deleteSiteFilesFromRepo` to also delete overrides

**Files:**
- Modify: `services/dashboard/src/lib/github.ts:238-330` (`deleteSiteFilesFromRepo`)

Instead of creating a separate `deleteOverrideFilesFromRepo` function (which would make a second commit to main and risk a stale-ref race condition), extend the existing `deleteSiteFilesFromRepo` to also enumerate and delete `overrides/<siteId>/` files in the same atomic commit.

- [ ] **Step 1: Modify `deleteSiteFilesFromRepo` to include override files**

Replace the existing `deleteSiteFilesFromRepo` function in `github.ts`:

```typescript
/** Delete site files (site.yaml, articles, assets) AND shared-page override
 *  files (overrides/<domain>/) from the Git repo in a single atomic commit.
 *  No-op if neither directory exists. */
export async function deleteSiteFilesFromRepo(domain: string): Promise<void> {
  const octokit = getOctokit();

  // Collect files from both sites/<domain>/ and overrides/<domain>/
  let files: Array<{ path: string; sha: string }> = [];

  for (const basePath of [`sites/${domain}`, `overrides/${domain}`]) {
    try {
      const { data } = await octokit.repos.getContent({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        path: basePath,
      });
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === "file") {
            files.push({ path: item.path, sha: item.sha });
          } else if (item.type === "dir") {
            // Recurse one level into subdirs (articles/, assets/)
            try {
              const { data: subData } = await octokit.repos.getContent({
                owner: NETWORK_REPO_OWNER,
                repo: NETWORK_REPO_NAME,
                path: item.path,
              });
              if (Array.isArray(subData)) {
                for (const subItem of subData) {
                  if (subItem.type === "file") {
                    files.push({ path: subItem.path, sha: subItem.sha });
                  }
                }
              }
            } catch {
              // Skip subdirs that fail
            }
          }
        }
      }
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        continue; // This directory doesn't exist — try the next one
      }
      throw error;
    }
  }

  if (files.length === 0) return;

  // Use Git Data API to delete all files in a single commit
  const branch = "main";
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });

  // Create tree entries that delete each file (sha: null)
  const treeItems = files.map((f) => ({
    path: f.path,
    mode: "100644" as const,
    type: "blob" as const,
    sha: null as unknown as string, // null sha = delete file
  }));

  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: treeItems,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `site(${domain}): delete all site files and overrides`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}
```

**Key changes from the original:**
- Iterates over two base paths: `sites/<domain>` and `overrides/<domain>`
- Uses `continue` instead of `return` on 404 so the second path is still tried
- Single atomic commit covers both directories
- Commit message updated to mention overrides

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "feat(dashboard): extend deleteSiteFilesFromRepo to also delete overrides in same commit"
```

---

## Task 4: Add R2 cleanup helpers

**Files:**
- Modify: `services/dashboard/package.json` (add `@aws-sdk/client-s3`)
- Modify: `services/dashboard/src/lib/constants.ts` (add R2 constants)
- Modify: `services/dashboard/src/lib/cloudflare.ts` (add R2 helpers)

R2 uses the S3-compatible API. We use `@aws-sdk/client-s3` for listing and batch-deleting objects. This is a server-side-only dependency — it doesn't affect client bundle size.

- [ ] **Step 1: Install `@aws-sdk/client-s3`**

```bash
cd services/dashboard && pnpm add @aws-sdk/client-s3
```

- [ ] **Step 2: Add R2 constants to constants.ts**

Add at the end of `services/dashboard/src/lib/constants.ts`:

```typescript
// --- R2 bucket identifiers ---

/** Staging R2 bucket for per-site assets. */
export const R2_BUCKET_STAGING = "atl-assets-staging";

/** Production R2 bucket for per-site assets. */
export const R2_BUCKET_PROD = "atl-assets-prod";
```

- [ ] **Step 3: Add R2 helpers to cloudflare.ts**

Add the import at the top of `services/dashboard/src/lib/cloudflare.ts` with the other imports:

```typescript
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
```

Add the following at the end of the file:

```typescript
// --- R2 Cleanup (S3-compatible API) ---

/** Lazily-initialised S3 client for R2 operations.
 *  Requires R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY env vars. */
let _s3Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (_s3Client) return _s3Client;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.warn("R2 cleanup skipped: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not configured");
    return null;
  }
  const accountId = getAccountId();
  _s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _s3Client;
}

/** Delete all R2 objects matching a prefix from a bucket.
 *  Handles pagination (ListObjectsV2) and batch deletion (DeleteObjects, 1000 per batch).
 *  Returns the number of objects deleted. Returns 0 if R2 credentials are not configured. */
export async function deleteR2ObjectsByPrefix(
  bucket: string,
  prefix: string,
): Promise<number> {
  const client = getR2Client();
  if (!client) return 0;

  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = list.Contents;
    if (!objects || objects.length === 0) break;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key })),
          Quiet: true,
        },
      }),
    );

    deleted += objects.length;
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}
```

**Key design decisions:**
- `getR2Client()` returns `null` instead of throwing when credentials are missing — this lets `deleteR2ObjectsByPrefix` skip silently without catching overly broad errors.
- A `console.warn` is emitted once when credentials are missing, so operators can see it in logs.
- The `CLOUDFLARE_ACCOUNT_ID` error (from `getAccountId()`) is NOT caught — that's a real misconfiguration that should surface.

- [ ] **Step 4: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/package.json services/dashboard/pnpm-lock.yaml \
       services/dashboard/src/lib/constants.ts services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): add R2 cleanup helpers (S3-compatible API via @aws-sdk/client-s3)"
```

---

## Task 5: Wire KV and R2 cleanup into `deleteSiteEntry`

**Files:**
- Modify: `services/dashboard/src/actions/sites.ts`

Add two new steps between existing step 4 (KV known-key cleanup) and step 5 (move to trash). Git override cleanup is already handled by the modified `deleteSiteFilesFromRepo` (Task 3). The new steps are best-effort — failures are logged but don't block deletion.

- [ ] **Step 1: Update imports**

In `services/dashboard/src/actions/sites.ts`, update the imports:

```typescript
import {
  readDashboardIndex,
  updateSiteInIndex,
  removeSiteFromIndex,
  restoreSiteInIndex,
  permanentlyRemoveFromTrash,
  deleteSiteFilesFromRepo,
  deleteBranch,
  branchExists,
  deleteFileFromBranch,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
} from "@/lib/github";
import {
  deletePagesProject,
  deleteKVEntry,
  deleteKVByPrefix,              // NEW
  deleteR2ObjectsByPrefix,       // NEW
} from "@/lib/cloudflare";
import {
  KV_NAMESPACE_PROD,
  KV_NAMESPACE_STAGING,
  R2_BUCKET_STAGING,             // NEW
  R2_BUCKET_PROD,                // NEW
} from "@/lib/constants";
```

- [ ] **Step 2: Add article + shared-page KV cleanup step**

Insert after the existing KV cleanup block (after line 136), before the "Move to trash" step:

```typescript
  // 4b. Delete article + shared-page + prev-config KV entries by prefix (staging + prod)
  {
    const siteId = domain;
    const prefixes = [
      { prefix: `article:${siteId}:`, label: "articles" },
      { prefix: `shared-page:${siteId}:`, label: "shared pages" },
    ];
    const extraKeys = [`site-config-prev:${siteId}`];
    let totalDeleted = 0;
    const prefixErrors: string[] = [];

    for (const ns of [
      { id: KV_NAMESPACE_STAGING, label: "staging" },
      { id: KV_NAMESPACE_PROD, label: "prod" },
    ]) {
      for (const { prefix, label } of prefixes) {
        try {
          const count = await deleteKVByPrefix(ns.id, prefix);
          totalDeleted += count;
        } catch (err) {
          prefixErrors.push(
            `${ns.label}/${label}: ${err instanceof Error ? err.message : "Unknown"}`,
          );
        }
      }
      for (const key of extraKeys) {
        try {
          await deleteKVEntry(ns.id, key);
          totalDeleted++;
        } catch (err) {
          prefixErrors.push(
            `${ns.label}/${key}: ${err instanceof Error ? err.message : "Unknown"}`,
          );
        }
      }
    }

    if (prefixErrors.length === 0) {
      steps.push({
        label: `Cleaned ${totalDeleted} KV entries (articles, shared pages, prev-config)`,
        success: true,
      });
    } else {
      steps.push({
        label: `KV prefix cleanup: ${totalDeleted} deleted, ${prefixErrors.length} errors`,
        success: totalDeleted > 0,
        error: prefixErrors.join("; "),
      });
    }
  }
```

- [ ] **Step 3: Add R2 asset cleanup step**

Insert after the KV prefix cleanup step:

```typescript
  // 4c. Delete R2 assets (staging + prod buckets) — best-effort
  {
    const siteId = domain;
    let r2Deleted = 0;
    const r2Errors: string[] = [];

    for (const { bucket, label } of [
      { bucket: R2_BUCKET_STAGING, label: "staging" },
      { bucket: R2_BUCKET_PROD, label: "prod" },
    ]) {
      try {
        const count = await deleteR2ObjectsByPrefix(bucket, `${siteId}/`);
        r2Deleted += count;
      } catch (err) {
        r2Errors.push(
          `${label}: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      }
    }

    if (r2Errors.length === 0 && r2Deleted > 0) {
      steps.push({ label: `Deleted ${r2Deleted} R2 assets (staging + prod)`, success: true });
    } else if (r2Errors.length === 0) {
      steps.push({ label: "No R2 assets to clean up", success: true });
    } else {
      steps.push({
        label: `R2 cleanup: ${r2Deleted} deleted, ${r2Errors.length} errors`,
        success: r2Deleted > 0 || r2Errors.length < 2,
        error: r2Errors.join("; "),
      });
    }
  }
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/actions/sites.ts
git commit -m "feat(dashboard): wire article/shared-page KV + R2 cleanup into deleteSiteEntry"
```

---

## Task 6: Add safety-net cleanup to `permanentlyDeleteSite`

**Files:**
- Modify: `services/dashboard/src/actions/sites.ts:205-217`

If a soft delete partially failed, some resources may still exist. `permanentlyDeleteSite` should retry cleanup as a safety net. Since permanent delete doesn't return step logs to the UI, failures are silently swallowed (best-effort).

- [ ] **Step 1: Expand `permanentlyDeleteSite`**

Replace the existing `permanentlyDeleteSite` function:

```typescript
/** Permanently delete a domain — remove from trash AND retry cleanup for anything
 *  the soft delete may have missed. Best-effort: swallows all cleanup errors. */
export async function permanentlyDeleteSite(domain: string): Promise<void> {
  // Retry site file + override file deletion (may already be gone from soft delete)
  try {
    await deleteSiteFilesFromRepo(domain);
  } catch {
    // Files may already be deleted — that's fine
  }

  // Retry KV cleanup (all key patterns)
  for (const nsId of [KV_NAMESPACE_STAGING, KV_NAMESPACE_PROD]) {
    try { await deleteKVByPrefix(nsId, `article:${domain}:`); } catch { /* best-effort */ }
    try { await deleteKVByPrefix(nsId, `shared-page:${domain}:`); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `site-config-prev:${domain}`); } catch { /* best-effort */ }
    // Also retry the known keys in case soft delete missed them
    try { await deleteKVEntry(nsId, `site:${domain}`); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `site-config:${domain}`); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `article-index:${domain}`); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `sync-status:${domain}`); } catch { /* best-effort */ }
  }

  // Retry R2 cleanup
  try { await deleteR2ObjectsByPrefix(R2_BUCKET_STAGING, `${domain}/`); } catch { /* best-effort */ }
  try { await deleteR2ObjectsByPrefix(R2_BUCKET_PROD, `${domain}/`); } catch { /* best-effort */ }

  await permanentlyRemoveFromTrash(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}
```

**Note:** `site:<custom_domain>` is not retried here because the custom domain value is not available from the trash entry. The soft delete handles it (it reads from the active site entry which has `custom_domain`). If the `site:<custom_domain>` key was missed during soft delete, it would need manual cleanup. This is acceptable — custom domains are rare and the key becomes inert once the site-config is gone.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/actions/sites.ts
git commit -m "feat(dashboard): add safety-net cleanup to permanentlyDeleteSite"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update landmine #22**

Find and replace the existing landmine #22 text:

```
22. **Site deletion cleans up KV.** `deleteSiteEntry()` in `src/actions/sites.ts` deletes `site:<domain>`, `site-config:<domain>`, `article-index:<domain>`, and `sync-status:<domain>` from both staging and prod KV namespaces. Individual `article:<domain>:<slug>` entries are not deleted (KV has no prefix-list API); they become unreachable once the index is gone.
```

Replace with:

```
22. **Site deletion performs full resource cleanup.** `deleteSiteEntry()` in `src/actions/sites.ts` deletes: (a) known KV keys (`site:*`, `site-config:*`, `article-index:*`, `sync-status:*`), (b) prefix-scanned KV keys (`article:<domain>:*`, `shared-page:<domain>:*`, `site-config-prev:<domain>`) via `listKVKeys` + `bulkDeleteKV`, (c) `sites/<domain>/` AND `overrides/<domain>/` files from Git main in one atomic commit, and (d) `<domain>/*` objects from R2 staging + prod buckets. All KV operations target both namespaces. `permanentlyDeleteSite()` retries all cleanup as a safety net. R2 cleanup requires `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` env vars — logs a warning and skips if not configured.
```

- [ ] **Step 2: Add R2 env vars to the Key Environment Variables table**

Add these rows to the env vars table:

```
| `R2_ACCESS_KEY_ID` | dashboard | R2 S3-compatible API access key. Required for R2 asset cleanup on site deletion. Skipped with warning if not set. |
| `R2_SECRET_ACCESS_KEY` | dashboard | R2 S3-compatible API secret key. Paired with `R2_ACCESS_KEY_ID`. |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update site deletion landmine and add R2 env vars"
```

---

## Task 8: Configure R2 credentials

This is an ops task, not a code task. The R2 helpers log a warning and skip if credentials are missing, so the system works without them — R2 cleanup just won't run.

- [ ] **Step 1: Create an R2 API token in the Cloudflare dashboard**

Go to Cloudflare Dashboard > R2 > Manage R2 API Tokens > Create API token. Grant "Object Read & Write" permission for both `atl-assets-staging` and `atl-assets-prod` buckets.

- [ ] **Step 2: Set the credentials locally**

Add to `services/dashboard/.env.local`:

```
R2_ACCESS_KEY_ID=<access-key-id-from-step-1>
R2_SECRET_ACCESS_KEY=<secret-access-key-from-step-1>
```

- [ ] **Step 3: Set the credentials in CloudGrid**

```bash
cloudgrid secrets set atomic-content-platform R2_ACCESS_KEY_ID=<value>
cloudgrid secrets set atomic-content-platform R2_SECRET_ACCESS_KEY=<value>
```

---

## Task 9: Verify end-to-end

- [ ] **Step 1: Run typecheck across the monorepo**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 2: Run existing tests**

```bash
pnpm test
```

Expected: All 381+ tests pass. No regressions.

- [ ] **Step 3: Manual smoke test**

1. Start local dev: `cloudgrid dev`
2. Navigate to a test site in the dashboard
3. Delete the site (soft delete)
4. Confirm the step log in the UI shows the new cleanup steps:
   - "Deleted site files from Git" (now includes overrides in the same commit)
   - "Cleaned N KV entries (articles, shared pages, prev-config)"
   - "Deleted N R2 assets (staging + prod)" or "No R2 assets to clean up"
5. Check trash, permanently delete the site
6. Confirm no errors in the console

- [ ] **Step 4: Final commit and push**

```bash
git push origin michal-v2-clean
```
