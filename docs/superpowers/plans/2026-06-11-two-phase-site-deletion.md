# Two-Phase Site Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure site deletion into a proper two-phase flow: soft delete (trash) preserves staging branch + R2 for restore, permanent delete destroys everything and records a history entry.

**Architecture:** Split the current `deleteSiteEntry()` which nukes everything into a lightweight "move to trash" that only disconnects the domain and removes production KV. Move all destructive cleanup (staging branch, Git files, KV prefix scan, R2) into `permanentlyDeleteSite()`. Add a `history` array to `DashboardIndex` for permanent audit trail. Add a `/history` page to view permanently deleted sites.

**Tech Stack:** Next.js 15 App Router, TypeScript, Cloudflare KV API, R2 S3 API, Octokit

---

## Current State

`deleteSiteEntry()` in `services/dashboard/src/actions/sites.ts` currently performs **all cleanup at soft-delete time**:
1. Deletes staging branch
2. Deletes site files from Git main
3. Deletes CF Pages project
4. Deletes ALL KV entries (both namespaces)
5. Deletes ALL R2 assets
6. Moves to trash in dashboard-index

This means "Restore" is broken — it only moves metadata back, but Git/KV/R2 are gone. And "Delete Forever" is a no-op retry.

## Desired Behavior

| Phase | Action | What it does |
|-------|--------|-------------|
| **Soft delete** (trash icon on sites table) | Disconnect domain + move to trash | 1. If domain connected: disconnect (deregister CF, delete `site:<customDomain>` from prod KV, revert config.domain). 2. Delete site files from Git main (published data). 3. Delete `site:<siteId>` from prod KV only (so domain stops resolving). 4. Keep staging branch intact. 5. Keep R2 images. 6. Keep staging KV (worker preview still works). 7. Move to `deleted[]` in dashboard-index. |
| **Restore** (from trash page) | Bring back to active list | Move from `deleted[]` to `sites[]`. Staging branch + R2 are intact, site is immediately editable. No KV/Git restoration needed. |
| **Permanent delete** (from trash page) | Destroy everything | 1. Delete staging branch. 2. Delete ALL remaining KV entries (staging + prod). 3. Delete ALL R2 assets. 4. Delete CF Pages project if exists. 5. Remove from `deleted[]`. 6. Add entry to `history[]` with full timestamp. |
| **History** (new page) | Audit trail | Read-only list of permanently deleted sites with domain, custom_domain, and deletion timestamp. Stored in `dashboard-index.yaml` under `history[]`. |

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `services/dashboard/src/types/dashboard.ts` | Modify:74-82 | Add `HistoryEntry` type, add `history` field to `DashboardIndex` |
| `services/dashboard/src/actions/sites.ts` | Modify:53-246,320-348 | Rewrite `deleteSiteEntry()` (light), rewrite `permanentlyDeleteSite()` (heavy) |
| `services/dashboard/src/lib/github.ts` | Modify:329-372 | Fix `restoreSiteInIndex()` status detection + update `permanentlyRemoveFromTrash()` to write `history[]` |
| `services/dashboard/src/components/dashboard/SitesTable.tsx` | Modify:457-540 | Update delete modal text to reflect new soft-delete behavior |
| `services/dashboard/src/components/trash/TrashList.tsx` | Modify:47-62,147-206 | Update permanent delete modal text + add step-by-step progress UI |
| `services/dashboard/src/app/trash/page.tsx` | Modify:1-47 | Add History section below trash list |
| `services/dashboard/src/components/trash/HistoryList.tsx` | Create | Read-only table of permanently deleted sites |

---

### Task 1: Add `HistoryEntry` type and update `DashboardIndex`

**Files:**
- Modify: `services/dashboard/src/types/dashboard.ts:74-82`

- [ ] **Step 1: Add `HistoryEntry` interface and update `DashboardIndex`**

In `services/dashboard/src/types/dashboard.ts`, after the `DeletedSiteEntry` interface (line 77), add:

```typescript
export interface HistoryEntry {
  /** Site folder name (e.g. "rumorumor"). */
  domain: string;
  /** Custom domain that was connected (e.g. "rumorumor.com"), or null. */
  custom_domain: string | null;
  /** Display name / company for reference. */
  company: Company | null;
  /** Category for reference. */
  vertical: Vertical;
  /** ISO 8601 timestamp of when the site was permanently deleted. */
  permanently_deleted_at: string;
}
```

Update the `DashboardIndex` interface (line 79-82) to add the `history` field:

```typescript
export interface DashboardIndex {
  sites: DashboardSiteEntry[];
  deleted?: DeletedSiteEntry[];
  history?: HistoryEntry[];
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (new types are additive, no breaking changes)

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/types/dashboard.ts
git commit -m "feat(types): add HistoryEntry type and history field to DashboardIndex"
```

---

### Task 2: Rewrite `deleteSiteEntry()` — lightweight soft delete

**Files:**
- Modify: `services/dashboard/src/actions/sites.ts:53-246`

The new `deleteSiteEntry()` should:
1. Disconnect custom domain if connected (deregister CF, delete prod KV `site:<customDomain>`, revert config.domain, clear custom_domain on index entry)
2. Delete site files from Git main (published data only — `sites/<domain>/` + `overrides/<domain>/`)
3. Delete the site's hostname from prod KV (`site:<domain>`) so the domain stops resolving
4. Delete CF Pages project if it exists (legacy cleanup)
5. **Do NOT** delete staging branch
6. **Do NOT** delete R2 assets
7. **Do NOT** delete staging KV entries (keeps Worker Preview working)
8. Invalidate in-memory caches (landmine #45)
9. Move to trash in dashboard-index (with custom_domain cleared)

- [ ] **Step 1: Rewrite `deleteSiteEntry()` function**

Replace the function body (lines 53-246) with:

```typescript
export async function deleteSiteEntry(domain: string): Promise<{
  steps: Array<{ label: string; success: boolean; error?: string }>;
}> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  const steps: Array<{ label: string; success: boolean; error?: string }> = [];

  // 1. Disconnect custom domain if connected (domain goes offline)
  if (site.custom_domain) {
    const removedDomain = site.custom_domain;

    // 1a. Deregister from CF worker (best-effort)
    try {
      await deregisterWorkerCustomDomain(removedDomain, domain);
      steps.push({ label: `Deregistered custom domain: ${removedDomain}`, success: true });
    } catch (err) {
      steps.push({
        label: `Deregister custom domain: ${removedDomain}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1b. Delete prod KV hostname entry for custom domain
    try {
      const kv = getKvNamespaces(domain);
      await deleteKVEntry(kv.prod, `site:${removedDomain.toLowerCase()}`, domain);
      steps.push({ label: `Deleted KV hostname: site:${removedDomain.toLowerCase()}`, success: true });
    } catch (err) {
      steps.push({
        label: `Delete KV hostname: site:${removedDomain.toLowerCase()}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1c. Revert config.domain back to siteId in KV + site.yaml (best-effort)
    // Without this, canonical URLs and og:url in staging preview would reference
    // the disconnected domain. patchSiteConfigDomain is private in wizard.ts,
    // so we inline the KV patch here. site.yaml update is unnecessary since
    // staging branch is preserved and will be correct on restore.
    try {
      const kv = getKvNamespaces(domain);
      const configKey = `site-config:${domain}`;
      for (const ns of [kv.prod, kv.staging]) {
        try {
          const raw = await getKVEntry(ns, configKey, domain);
          if (!raw) continue;
          const config = JSON.parse(raw) as Record<string, unknown>;
          config.domain = domain;
          await putKVEntry(ns, configKey, JSON.stringify(config), domain);
        } catch {
          // best-effort per namespace
        }
      }
      steps.push({ label: "Reverted config.domain to siteId", success: true });
    } catch (err) {
      steps.push({
        label: "Revert config.domain",
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1d. Clear custom_domain on site entry before trashing
    // so the trash entry doesn't show a stale domain, and restore
    // doesn't come back with a custom_domain that no longer works.
    site.custom_domain = null;
    site.status = "Ready";
    site.worker_pending_dns = true;
  }

  // 2. Delete prod KV hostname entry for siteId (stops domain resolution)
  {
    const kv = getKvNamespaces(domain);
    try {
      await deleteKVEntry(kv.prod, `site:${domain.toLowerCase()}`, domain);
      steps.push({ label: `Deleted KV hostname: site:${domain.toLowerCase()}`, success: true });
    } catch (err) {
      steps.push({
        label: `Delete KV hostname: site:${domain.toLowerCase()}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // 3. Delete site files from Git main (published data only)
  try {
    await deleteSiteFilesFromRepo(domain);
    steps.push({ label: "Deleted site files from Git main", success: true });
  } catch (err) {
    steps.push({
      label: "Delete site files from Git main",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 4. Delete CF Pages project if it exists (legacy)
  if (site.pages_project) {
    try {
      await deletePagesProject(site.pages_project, domain);
      steps.push({ label: `Deleted CF Pages project: ${site.pages_project}`, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("not found") || msg.includes("404")) {
        steps.push({ label: `CF Pages project already gone: ${site.pages_project}`, success: true });
      } else {
        steps.push({
          label: `Delete CF Pages project: ${site.pages_project}`,
          success: false,
          error: msg,
        });
      }
    }
  }

  // 5. Move to trash in dashboard index (staging branch + R2 preserved)
  // Note: site.custom_domain was already cleared in step 1d if it was set,
  // so removeSiteFromIndex will store the entry with custom_domain=null.
  try {
    await removeSiteFromIndex(domain);
    steps.push({ label: "Moved to trash (staging branch + images preserved)", success: true });
  } catch (err) {
    steps.push({
      label: "Move to trash in dashboard index",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 6. Invalidate caches (landmine #45) — must come before revalidatePath
  invalidateSiteCaches(domain, `staging/${domain}`);

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");

  return { steps };
}
```

- [ ] **Step 2: Add missing imports**

At the top of `sites.ts`, update the cloudflare import to add `deregisterWorkerCustomDomain`, `getKVEntry`, and `putKVEntry`:

```typescript
import {
  deletePagesProject,
  deleteKVEntry,
  deleteKVByPrefix,
  deleteR2ObjectsByPrefix,
  deleteR2Objects,
  deregisterWorkerCustomDomain,
  getKVEntry,
  putKVEntry,
} from "@/lib/cloudflare";
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/actions/sites.ts
git commit -m "refactor(sites): make soft delete lightweight — preserve staging branch and R2"
```

---

### Task 3: Fix `restoreSiteInIndex()` to check staging branch for status

**Files:**
- Modify: `services/dashboard/src/lib/github.ts:329-357`

Since soft delete now preserves the staging branch but deletes from main, `readSiteConfig(domain)` (which defaults to main) will always return `null` after restore, resetting status to "New". The staging branch is the source of truth now.

- [ ] **Step 1: Update `restoreSiteInIndex()` to check staging branch**

In `services/dashboard/src/lib/github.ts`, update the status detection logic in `restoreSiteInIndex()`. Replace the status detection block (around lines 342-348) with:

```typescript
  // Re-detect status: check if site.yaml exists on staging branch first
  // (soft delete preserves staging but removes main), then fall back to main.
  const stagingBranch = siteEntry.staging_branch ?? `staging/${domain}`;
  const stagingConfig = await readSiteConfig(domain, stagingBranch);
  let newStatus = siteEntry.status;
  if (stagingConfig) {
    // Staging branch has config — site is restorable
    newStatus = "Staging";
  } else {
    // Check main as fallback
    const mainConfig = await readSiteConfig(domain);
    if (!mainConfig) {
      newStatus = "New";
    }
  }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "fix(github): check staging branch when restoring site status from trash"
```

---

### Task 4: Update `permanentlyRemoveFromTrash()` in github.ts to write history

**Files:**
- Modify: `services/dashboard/src/lib/github.ts:360-372`

- [ ] **Step 1: Update `permanentlyRemoveFromTrash()` to move entry to history**

Replace the function (lines 360-372) with:

```typescript
export async function permanentlyRemoveFromTrash(
  domain: string
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  index.deleted = index.deleted ?? [];
  const trashIndex = index.deleted.findIndex((s) => s.domain === domain);
  if (trashIndex === -1) {
    throw new Error(`Site ${domain} not found in trash`);
  }
  const [removed] = index.deleted.splice(trashIndex, 1);

  // Record in history for audit trail
  index.history = index.history ?? [];
  index.history.push({
    domain: removed!.domain,
    custom_domain: removed!.custom_domain,
    company: removed!.company,
    vertical: removed!.vertical,
    permanently_deleted_at: new Date().toISOString(),
  });

  await writeDashboardIndex(index, `dashboard: permanently delete ${domain}`);
  return index;
}
```

- [ ] **Step 2: Add `HistoryEntry` to the import at the top of github.ts**

The file imports types from `@/types/dashboard`. Add `HistoryEntry` to the import:

```typescript
import type {
  DashboardIndex,
  DashboardSiteEntry,
  DeletedSiteEntry,
  HistoryEntry,
  ArticleEntry,
  ActivityEvent,
} from "@/types/dashboard";
```

Note: `HistoryEntry` may not be directly referenced in the function signature since it's accessed through `DashboardIndex.history`, but import it for explicitness. If the linter flags it as unused, remove it — the type flows through `DashboardIndex`.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "feat(github): write history entry when permanently removing site from trash"
```

---

### Task 5: Rewrite `permanentlyDeleteSite()` — full destructive cleanup

**Files:**
- Modify: `services/dashboard/src/actions/sites.ts` (the `permanentlyDeleteSite` function, currently at line ~320)

The new `permanentlyDeleteSite()` should do ALL the heavy cleanup that was previously in soft delete, plus return step-by-step results to the UI.

- [ ] **Step 1: Rewrite `permanentlyDeleteSite()` with step tracking**

Replace lines 320-348 with:

```typescript
/** Permanently delete a site from trash — destroys staging branch, all KV,
 *  all R2 assets, and records a history entry. Returns cleanup log for UI. */
export async function permanentlyDeleteSite(domain: string): Promise<{
  steps: Array<{ label: string; success: boolean; error?: string }>;
}> {
  const steps: Array<{ label: string; success: boolean; error?: string }> = [];

  // 1. Delete staging branch if it exists
  {
    const branchName = `staging/${domain}`;
    try {
      const exists = await branchExists(branchName);
      if (exists) {
        await deleteBranch(branchName);
        steps.push({ label: `Deleted staging branch: ${branchName}`, success: true });
      } else {
        steps.push({ label: "Staging branch already gone", success: true });
      }
    } catch (err) {
      steps.push({
        label: `Delete staging branch: ${branchName}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // 2. Delete site files from Git main (safety retry — may already be gone from soft delete)
  try {
    await deleteSiteFilesFromRepo(domain);
    steps.push({ label: "Deleted site files from Git main", success: true });
  } catch {
    steps.push({ label: "Site files already removed from Git", success: true });
  }

  // 3. Delete ALL KV entries (staging + prod)
  {
    const kv = getKvNamespaces(domain);
    const namespaces = [
      { id: kv.staging, label: "staging" },
      { id: kv.prod, label: "prod" },
    ];
    let kvDeleted = 0;
    const kvErrors: string[] = [];

    for (const ns of namespaces) {
      // Known keys
      for (const key of [
        `site:${domain}`,
        `site-config:${domain}`,
        `article-index:${domain}`,
        `sync-status:${domain}`,
        `site-config-prev:${domain}`,
        `cond-overrides:${domain}`,
      ]) {
        try {
          await deleteKVEntry(ns.id, key, domain);
          kvDeleted++;
        } catch {
          // Key may not exist — that's fine
        }
      }
      // Prefix-scanned keys
      for (const prefix of [`article:${domain}:`, `shared-page:${domain}:`]) {
        try {
          const count = await deleteKVByPrefix(ns.id, prefix, domain);
          kvDeleted += count;
        } catch (err) {
          kvErrors.push(`${ns.label}/${prefix}: ${err instanceof Error ? err.message : "Unknown"}`);
        }
      }
    }

    if (kvErrors.length === 0) {
      steps.push({ label: `Cleaned ${kvDeleted} KV entries (staging + prod)`, success: true });
    } else {
      steps.push({
        label: `KV cleanup: ${kvDeleted} deleted, ${kvErrors.length} errors`,
        success: false,
        error: kvErrors.join("; "),
      });
    }
  }

  // 4. Delete ALL R2 assets
  try {
    const count = await deleteR2ObjectsByPrefix(R2_BUCKET_PROD, `${domain}/`, domain);
    if (count > 0) {
      steps.push({ label: `Deleted ${count} R2 assets`, success: true });
    } else {
      steps.push({ label: "No R2 assets to clean up", success: true });
    }
  } catch (err) {
    steps.push({
      label: "R2 cleanup",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 5. Delete CF Pages project if referenced in trash entry
  // (Read from dashboard-index deleted array before we remove it)
  {
    const index = await readDashboardIndex();
    const trashed = (index.deleted ?? []).find((s) => s.domain === domain);
    if (trashed?.pages_project) {
      try {
        await deletePagesProject(trashed.pages_project, domain);
        steps.push({ label: `Deleted CF Pages project: ${trashed.pages_project}`, success: true });
      } catch {
        steps.push({ label: "CF Pages project already gone", success: true });
      }
    }
  }

  // 6. Remove from trash + write history entry
  try {
    await permanentlyRemoveFromTrash(domain);
    steps.push({ label: "Removed from trash, added to history", success: true });
  } catch (err) {
    steps.push({
      label: "Remove from trash",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 7. Invalidate caches (landmine #45) — must come before revalidatePath
  invalidateSiteCaches(domain, `staging/${domain}`);

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");

  return { steps };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/actions/sites.ts
git commit -m "feat(sites): move destructive cleanup to permanentlyDeleteSite with step tracking"
```

---

### Task 6: Update SitesTable delete modal text

**Files:**
- Modify: `services/dashboard/src/components/dashboard/SitesTable.tsx:457-518`

The delete modal currently says "This will permanently remove" which is misleading — soft delete now preserves staging + R2.

- [ ] **Step 1: Update the pre-delete confirmation text**

Replace the content inside the `{!deleteSteps && (...)}` block (lines 466-518). The new text should say:

```tsx
{!deleteSteps && (
  <>
    <div className="flex items-start gap-3">
      <div className="mt-0.5 w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <div>
        <p className="text-[var(--text-primary)] font-medium">
          Move <strong>{deleteTarget}</strong> to trash?
        </p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          This will:
        </p>
        <ul className="text-sm text-[var(--text-muted)] mt-1 space-y-1.5">
          {deleteTargetSite?.custom_domain && (
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              Disconnect domain: <span className="font-mono text-xs">{deleteTargetSite.custom_domain}</span>
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            Remove published files from Git main
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            Take domain offline (remove from KV)
          </li>
        </ul>
        <p className="text-sm text-green-400/80 mt-3">
          Staging branch and images are preserved. You can restore from trash.
        </p>
      </div>
    </div>

    <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
      <Button variant="ghost" onClick={closeDeleteModal}>
        Cancel
      </Button>
      <Button
        onClick={confirmDelete}
        loading={isPending}
        className="!bg-amber-600 hover:!bg-amber-700 !text-white"
      >
        Move to Trash
      </Button>
    </div>
  </>
)}
```

Also update the modal title (line 461):

```tsx
title={deleteSteps ? "Move to Trash Complete" : "Move to Trash"}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/dashboard/SitesTable.tsx
git commit -m "fix(ui): update delete modal to reflect soft-delete behavior"
```

---

### Task 7: Update TrashList with step-by-step permanent delete UI

**Files:**
- Modify: `services/dashboard/src/components/trash/TrashList.tsx`

The permanent delete handler currently returns `void`. We need it to show step-by-step progress like the soft-delete modal does.

- [ ] **Step 1: Update `permanentlyDeleteSite` import and handler**

The function signature changed — it now returns `{ steps }`. Update the handler and add state for showing steps:

Add new state after the existing state declarations (around line 31):

```typescript
const [deleteSteps, setDeleteSteps] = useState<Array<{ label: string; success: boolean; error?: string }> | null>(null);
```

Replace `handlePermanentDelete` (lines 47-62) with:

```typescript
function handlePermanentDelete(): void {
  if (!deleteTarget) return;
  const domain = deleteTarget.domain;
  setActionDomain(domain);
  startDeleteTransition(async () => {
    try {
      const result = await permanentlyDeleteSite(domain);
      setDeleteSteps(result.steps);
      const allSuccess = result.steps.every((s) => s.success);
      if (allSuccess) {
        toast(`Permanently deleted ${domain}`, "success");
      } else {
        toast(`Deleted ${domain} with some warnings`, "info");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to delete", "error");
    } finally {
      setActionDomain(null);
    }
  });
}
```

Add a close handler:

```typescript
function closeDeleteModal(): void {
  setDeleteTarget(null);
  setDeleteSteps(null);
}
```

- [ ] **Step 2: Update the permanent delete modal to show step results**

Replace the Modal content (lines 148-206) with a two-phase modal similar to SitesTable's:

```tsx
<Modal
  open={deleteTarget !== null}
  onClose={closeDeleteModal}
  title={deleteSteps ? "Permanent Delete Complete" : "Permanently Delete Site"}
  size="sm"
>
  {deleteTarget && !deleteSteps && (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <div>
          <p className="text-[var(--text-primary)] font-medium">
            Permanently delete <strong>{deleteTarget.domain}</strong>?
          </p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            This will destroy:
          </p>
          <ul className="text-sm text-[var(--text-muted)] mt-1 list-disc list-inside space-y-1">
            <li>Staging branch and all draft content</li>
            <li>All images from R2 storage</li>
            <li>All KV cache entries (staging + production)</li>
            <li>CF Pages project (if exists)</li>
          </ul>
          <p className="text-sm text-red-400 mt-3 font-medium">
            This cannot be undone. The site will only remain in the history log.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border-secondary)]">
        <Button variant="ghost" onClick={closeDeleteModal}>
          Cancel
        </Button>
        <Button
          onClick={handlePermanentDelete}
          loading={deletePending && actionDomain === deleteTarget.domain}
          className="!bg-red-500 hover:!bg-red-600 !text-white"
        >
          Delete Forever
        </Button>
      </div>
    </div>
  )}

  {deleteSteps && (
    <div className="space-y-4">
      <div className="space-y-2">
        {deleteSteps.map((step, i) => (
          <div key={i} className="flex items-start gap-2.5 text-sm">
            {step.success ? (
              <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            )}
            <div>
              <span className={step.success ? "text-[var(--text-secondary)]" : "text-red-400"}>
                {step.label}
              </span>
              {step.error && (
                <p className="text-xs text-red-400/70 mt-0.5">{step.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button variant="ghost" onClick={closeDeleteModal}>
          Close
        </Button>
      </div>
    </div>
  )}
</Modal>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/components/trash/TrashList.tsx
git commit -m "feat(trash): add step-by-step progress UI for permanent delete"
```

---

### Task 8: Create `HistoryList` component

**Files:**
- Create: `services/dashboard/src/components/trash/HistoryList.tsx`

- [ ] **Step 1: Create the read-only history table**

```tsx
import type { HistoryEntry } from "@/types/dashboard";

interface HistoryListProps {
  items: HistoryEntry[];
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HistoryList({ items }: HistoryListProps): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)]">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Site
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Domain
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Company
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Category
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Permanently Deleted
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={`${item.domain}-${i}`}
                className="border-b border-[var(--border-secondary)] last:border-b-0"
              >
                <td className="px-4 py-3 font-medium text-[var(--text-secondary)]">
                  {item.domain}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                  {item.custom_domain ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {item.company ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {item.vertical ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                  {formatDateTime(item.permanently_deleted_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/trash/HistoryList.tsx
git commit -m "feat(ui): add HistoryList component for permanently deleted sites"
```

---

### Task 9: Update trash page to show history section

**Files:**
- Modify: `services/dashboard/src/app/trash/page.tsx`

- [ ] **Step 1: Add history section below the trash list**

Replace the entire file with:

```tsx
import { readDashboardIndex } from "@/lib/github";
import { TrashList } from "@/components/trash/TrashList";
import { HistoryList } from "@/components/trash/HistoryList";

export const dynamic = "force-dynamic";

export default async function TrashPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();
  const deleted = index.deleted ?? [];
  const history = (index.history ?? []).slice().reverse(); // newest first

  return (
    <div className="space-y-8">
      {/* Trash section */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Deleted Sites</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {deleted.length === 0
              ? "No deleted sites. Sites moved to trash will appear here."
              : `${deleted.length} site${deleted.length === 1 ? "" : "s"} in trash — staging branch and images preserved`}
          </p>
        </div>

        {deleted.length === 0 ? (
          <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
            <svg
              className="w-10 h-10 mx-auto text-[var(--text-muted)] mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
            <p className="text-sm text-[var(--text-muted)]">
              Trash is empty.
            </p>
          </div>
        ) : (
          <TrashList items={deleted} />
        )}
      </div>

      {/* History section */}
      {history.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-secondary)]">History</h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {history.length} site{history.length === 1 ? "" : "s"} permanently deleted
            </p>
          </div>
          <HistoryList items={history} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Verify the page renders**

Run: `cd services/dashboard && pnpm build`
Expected: PASS — page compiles, no import errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/trash/page.tsx
git commit -m "feat(trash): add history section showing permanently deleted sites"
```

---

### Task 10: Update CLAUDE.md landmines and conventions

**Files:**
- Modify: `CLAUDE.md` (root of platform repo)

- [ ] **Step 1: Update landmine #22 to reflect new two-phase behavior**

Find the current landmine #22 text and replace it with:

```
22. **Site deletion is two-phase.** Soft delete (`deleteSiteEntry`) moves to trash: disconnects custom domain, deletes Git main files, removes prod KV hostname — but **preserves staging branch and R2 images** so the site can be restored. Permanent delete (`permanentlyDeleteSite`) destroys staging branch, all KV entries, all R2 assets, and records a `history[]` entry in `dashboard-index.yaml`. Restore from trash works because staging + R2 are intact. After permanent delete, the site only exists in the `history[]` audit trail.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update landmine #22 to document two-phase site deletion"
```

---

### Task 11: Manual verification

No files to change — this is a manual testing checklist.

- [ ] **Step 1: Start local dev**

Run: `cloudgrid dev`

- [ ] **Step 2: Test soft delete flow**

1. Navigate to the sites table
2. Click the trash icon on a test site
3. Verify the modal says "Move to Trash" (not "Delete Site")
4. Verify the modal mentions staging branch and images are preserved
5. Confirm the action
6. Verify the step-by-step results show domain disconnect + KV cleanup
7. Navigate to `/trash` — verify the site appears

- [ ] **Step 3: Test restore flow**

1. On the trash page, click "Restore" on the trashed site
2. Navigate to `/sites` — verify the site is back
3. Navigate to `/sites/<domain>` — verify Worker Preview still works (staging branch intact)

- [ ] **Step 4: Test permanent delete flow**

1. Move the test site back to trash
2. On the trash page, click "Delete Forever"
3. Verify the modal lists what will be destroyed (staging branch, R2, KV)
4. Confirm the action
5. Verify step-by-step progress shows all cleanup
6. Verify the site disappears from trash
7. Verify a history entry appears below with the deletion timestamp

- [ ] **Step 5: Commit any fixups from testing**

If any code changes were needed during testing, stage only the specific files changed and commit:

```bash
git add <specific-files>
git commit -m "fix: address issues found during two-phase deletion testing"
```

Skip this step if no changes were needed.
