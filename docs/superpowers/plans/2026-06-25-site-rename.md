# Site Rename (Slug Change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to rename a site's domain/slug (the folder name in Git, branch name, and all references) via a "Site Slug" field in the Identity tab.

**Architecture:** New `POST /api/sites/rename` route handles the full rename across Git (staging branch folder rename + new branch, main branch if published, dashboard-index.yaml update) and MongoDB (dashboard_index, site_configs, articles, site_stats). R2 assets are untouched — old image URLs keep working, new uploads use the new slug. The client calls rename first, then the existing save endpoint for any other config changes, then redirects to the new URL.

**Tech Stack:** Next.js App Router API route, Octokit Git Data API, MongoDB driver, React state.

---

### Task 1: Add `renameSiteFolder` to github.ts

**Files:**
- Modify: `services/dashboard/src/lib/github.ts` (append after `deleteBranch` at ~line 882)

This function renames `sites/<old>/` to `sites/<new>/` on a given branch in a single atomic commit. It reuses blob SHAs (no content re-upload). Optionally renames `overrides/<old>/` too.

- [ ] **Step 1: Add the `renameSiteFolder` function**

```typescript
/**
 * Rename a site folder on a branch: `sites/<oldDomain>/` → `sites/<newDomain>/`.
 * Optionally also renames `overrides/<oldDomain>/` → `overrides/<newDomain>/`.
 * Uses blob SHA reuse — no file content is re-uploaded.
 */
export async function renameSiteFolder(
  branch: string,
  oldDomain: string,
  newDomain: string,
  includeOverrides: boolean = false,
): Promise<void> {
  const octokit = getOctokit();

  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const commitSha = ref.object.sha;

  const { data: srcTree } = await octokit.git.getTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    tree_sha: commitSha,
    recursive: "true",
  });

  const prefixes = [`sites/${oldDomain}/`];
  if (includeOverrides) prefixes.push(`overrides/${oldDomain}/`);

  const entries = srcTree.tree.filter(
    (e) => prefixes.some((p) => e.path?.startsWith(p)) && e.type === "blob" && e.sha && e.mode,
  );

  if (entries.length === 0) {
    throw new Error(`No files found under sites/${oldDomain}/ on branch ${branch}`);
  }

  // Build tree items: add files under new domain + delete files under old domain
  const treeItems = [
    ...entries.map((e) => ({
      path: e.path!
        .replace(`sites/${oldDomain}/`, `sites/${newDomain}/`)
        .replace(`overrides/${oldDomain}/`, `overrides/${newDomain}/`),
      mode: e.mode as "100644" | "100755" | "040000" | "160000" | "120000",
      type: "blob" as const,
      sha: e.sha!,
    })),
    ...entries.map((e) => ({
      path: e.path!,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null as unknown as string,
    })),
  ];

  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: commitSha,
  });

  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: treeItems,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `site(${oldDomain}): rename to ${newDomain}`,
    tree: newTree.sha,
    parents: [commitSha],
  });

  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (no new type errors)

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "feat(dashboard): add renameSiteFolder Git helper"
```

---

### Task 2: Create the rename API route

**Files:**
- Create: `services/dashboard/src/app/api/sites/rename/route.ts`

The route validates the new slug, then performs all rename operations in safe order (create new state before deleting old state).

- [ ] **Step 1: Create the route file**

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  renameSiteFolder,
  createBranch,
  deleteBranch,
  branchExists,
  readDashboardIndex,
  writeDashboardIndex,
  invalidateTreeCache,
  triggerWorkflowViaPush,
} from "@/lib/github";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getMongoDb } from "@/lib/mongo";
import { COLLECTIONS } from "@/lib/db/collections";

interface RenameRequestBody {
  oldDomain: string;
  newDomain: string;
}

const SLUG_RE = /^[a-z0-9]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RenameRequestBody;
  try {
    body = (await req.json()) as RenameRequestBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { oldDomain, newDomain } = body;

  // --- Validate ---
  if (!oldDomain || !newDomain) {
    return NextResponse.json(
      { status: "error", message: "oldDomain and newDomain are required" },
      { status: 400 },
    );
  }
  if (oldDomain === newDomain) {
    return NextResponse.json(
      { status: "error", message: "New slug is the same as the current one" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(newDomain)) {
    return NextResponse.json(
      { status: "error", message: "Slug must contain only lowercase letters and numbers" },
      { status: 400 },
    );
  }

  try {
    // Check old site exists
    const index = await readDashboardIndex({ fresh: true });
    const siteIdx = index.sites.findIndex((s) => s.domain === oldDomain);
    if (siteIdx === -1) {
      return NextResponse.json(
        { status: "error", message: `Site "${oldDomain}" not found` },
        { status: 404 },
      );
    }

    // Check new slug not taken
    const taken =
      index.sites.some((s) => s.domain === newDomain) ||
      index.deleted?.some((s) => s.domain === newDomain);
    if (taken) {
      return NextResponse.json(
        { status: "error", message: `Slug "${newDomain}" is already in use` },
        { status: 409 },
      );
    }

    const site = index.sites[siteIdx]!;
    const oldStagingBranch = site.staging_branch;
    const newStagingBranch = `staging/${newDomain}`;
    const isPublished = site.status === "Live" || site.status === "Ready";

    // --- 1. Git: Create new staging branch from old staging HEAD ---
    if (oldStagingBranch) {
      await createBranch(newStagingBranch, oldStagingBranch);

      // --- 2. Git: Rename folder on the new staging branch ---
      await renameSiteFolder(newStagingBranch, oldDomain, newDomain);
      invalidateTreeCache(newStagingBranch);
    }

    // --- 3. Git: Rename on main if published ---
    if (isPublished) {
      const mainHasFiles = await branchExists("main");
      if (mainHasFiles) {
        try {
          await renameSiteFolder("main", oldDomain, newDomain, true);
          invalidateTreeCache("main");
        } catch (err) {
          console.warn(
            `[sites/rename] Failed to rename on main (may not have files yet):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    // --- 4. Git: Update dashboard-index.yaml ---
    // Re-read fresh to avoid SHA conflicts
    const freshIndex = await readDashboardIndex({ fresh: true });
    const freshIdx = freshIndex.sites.findIndex((s) => s.domain === oldDomain);
    if (freshIdx !== -1) {
      freshIndex.sites[freshIdx] = {
        ...freshIndex.sites[freshIdx]!,
        domain: newDomain,
        staging_branch: newStagingBranch,
        last_updated: new Date().toISOString(),
      };
      await writeDashboardIndex(
        freshIndex,
        `dashboard: rename ${oldDomain} → ${newDomain}`,
      );
    }

    // --- 5. MongoDB: Rename across collections (soft-fail) ---
    try {
      const db = await getMongoDb();

      // dashboard_index: domain is unique key, so insert new + delete old
      const dashDoc = await db.collection(COLLECTIONS.dashboardIndex).findOne({ domain: oldDomain });
      if (dashDoc) {
        const { _id, ...rest } = dashDoc;
        await db.collection(COLLECTIONS.dashboardIndex).insertOne({
          ...rest,
          domain: newDomain,
          staging_branch: newStagingBranch,
          updatedAt: new Date(),
        });
        await db.collection(COLLECTIONS.dashboardIndex).deleteOne({ domain: oldDomain });
      }

      // site_configs: same pattern
      const configDoc = await db.collection(COLLECTIONS.siteConfigs).findOne({ domain: oldDomain });
      if (configDoc) {
        const { _id, ...rest } = configDoc;
        await db.collection(COLLECTIONS.siteConfigs).insertOne({
          ...rest,
          domain: newDomain,
          updatedAt: new Date(),
        });
        await db.collection(COLLECTIONS.siteConfigs).deleteOne({ domain: oldDomain });
      }

      // articles: bulk update domain field
      await db.collection(COLLECTIONS.articles).updateMany(
        { domain: oldDomain },
        {
          $set: {
            domain: newDomain,
            branch: newStagingBranch,
            updatedAt: new Date(),
          },
        },
      );

      // site_stats: _id is the domain, so insert new + delete old
      const statsDoc = await db.collection("site_stats").findOne({ _id: oldDomain as any });
      if (statsDoc) {
        const { _id, ...rest } = statsDoc;
        await db.collection("site_stats").insertOne({
          _id: newDomain as any,
          ...rest,
        });
        await db.collection("site_stats").deleteOne({ _id: oldDomain as any });
      }
    } catch (err) {
      console.warn(
        `[sites/rename] MongoDB rename failed (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }

    // --- 6. Git: Delete old staging branch (cleanup, last step) ---
    if (oldStagingBranch) {
      try {
        await deleteBranch(oldStagingBranch);
      } catch (err) {
        console.warn(
          `[sites/rename] Failed to delete old branch ${oldStagingBranch}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // --- 7. Trigger KV sync for the new site ---
    if (newStagingBranch) {
      try {
        await triggerWorkflowViaPush(newStagingBranch, newDomain);
      } catch (err) {
        console.warn(
          `[sites/rename] Failed to trigger KV sync:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Invalidate all tree caches
    invalidateTreeCache();

    return NextResponse.json({
      status: "ok",
      newDomain,
      message: `Site renamed from ${oldDomain} to ${newDomain}`,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/sites/rename/route.ts
git commit -m "feat(dashboard): add site rename API endpoint"
```

---

### Task 3: Add Site Slug field to ContentAgentTab

**Files:**
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`

Add a "Site Slug" input above "Site Name" in the identity section. When saving, if slug changed, call rename API first, then continue with normal save, then redirect.

- [ ] **Step 1: Add slug state (near line 88, after the identity state comment)**

After `const initSiteName = ...` line, add:

```typescript
const [siteSlug, setSiteSlug] = useState(domain);
```

- [ ] **Step 2: Add slug to `identityDirty` check (near line 531)**

Add `siteSlug !== domain ||` to the beginning of the `identityDirty` expression.

- [ ] **Step 3: Update `saveIdentity()` function (near line 421)**

Replace the `saveIdentity` function body to handle rename before save:

```typescript
async function saveIdentity(): Promise<void> {
  setSavingIdentity(true);
  const effectiveFavicon = faviconSameAsLogo ? null : pendingFavicon;
  const slugChanged = siteSlug !== domain;
  let activeDomain = domain;

  try {
    // Step 1: Rename if slug changed
    if (slugChanged) {
      const renameRes = await fetch("/api/sites/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldDomain: domain, newDomain: siteSlug }),
      });
      const renameData = (await renameRes.json()) as { status: string; message?: string; newDomain?: string };
      if (renameData.status !== "ok") {
        toast(renameData.message ?? "Failed to rename site", "error");
        setSavingIdentity(false);
        return;
      }
      activeDomain = renameData.newDomain ?? siteSlug;
    }

    // Step 2: Save config updates (using new domain if renamed)
    const hasConfigChanges =
      siteName !== initSiteName ||
      siteTagline !== initSiteTagline ||
      author !== initAuthor ||
      tone !== initTone ||
      JSON.stringify(audienceIds) !== JSON.stringify(initAudienceIds) ||
      !!pendingLogo ||
      !!pendingFooterLogo ||
      !!pendingFavicon ||
      clearLogo ||
      clearFooterLogo;

    if (hasConfigChanges) {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: activeDomain,
          logoBase64: pendingLogo ?? null,
          footerLogoBase64: pendingFooterLogo ?? undefined,
          faviconBase64: effectiveFavicon ?? null,
          clearLogo: clearLogo || undefined,
          clearFooterLogo: clearFooterLogo || undefined,
          configUpdates: {
            siteName,
            siteTagline,
            author,
            audiences,
            audienceIds,
            tone,
            verticalId,
            vertical: verticals.find((v) => v.id === verticalId)?.name ?? "",
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status !== "ok") {
        toast(data.message ?? "Failed to save identity", "error");
        setSavingIdentity(false);
        return;
      }
    }

    // Step 3: Success
    if (slugChanged) {
      toast(`Site renamed to ${activeDomain}`, "success");
      router.push(`/sites/${activeDomain}`);
    } else {
      toast("Identity saved", "success");
      setPendingLogo(null);
      setPendingFooterLogo(null);
      setPendingFavicon(null);
      setClearLogo(false);
      setClearFooterLogo(false);
      setAssetVersion((v) => v + 1);
      router.refresh();
    }
  } catch {
    toast("Failed to save identity", "error");
  } finally {
    setSavingIdentity(false);
  }
}
```

- [ ] **Step 4: Add the Site Slug input to the identity section JSX (near line 558)**

Before the existing `<Input label="Site Name" ... />`, add:

```tsx
<Input
  label="Site Slug"
  value={siteSlug}
  onChange={(e): void => setSiteSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
  placeholder="e.g. sillycapybara"
/>
```

- [ ] **Step 5: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/components/site-detail/ContentAgentTab.tsx
git commit -m "feat(dashboard): add Site Slug field with rename support"
```

---

### Task 4: Manual testing

- [ ] **Step 1: Start dev server**

Run: `cloudgrid dev` (or `cd services/dashboard && pnpm dev`)

- [ ] **Step 2: Test slug validation**

1. Navigate to a site detail page (e.g., `/sites/funnypigeon`)
2. In the Identity tab, verify the "Site Slug" field shows `funnypigeon`
3. Try entering invalid chars (spaces, hyphens, uppercase) — they should be stripped
4. Try saving with a slug that already exists — should show error toast

- [ ] **Step 3: Test rename flow**

1. Change slug from `funnypigeon` to `sillycapybara`
2. Click Save
3. Verify toast says "Site renamed to sillycapybara"
4. Verify redirect to `/sites/sillycapybara`
5. Verify site loads correctly with all config, articles intact
6. Check GitHub: `staging/sillycapybara` branch exists, `staging/funnypigeon` is deleted
7. Check `dashboard-index.yaml`: domain changed to `sillycapybara`

- [ ] **Step 4: Commit any fixes from testing**
