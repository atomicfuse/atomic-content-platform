# Simplify SiteStatus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `SiteStatus` from 5 values (`New | Staging | Preview | Ready | Live`) to 3 (`Staging | Ready | Live`), removing unused statuses that don't gate meaningful behavior.

**Architecture:** Pure refactor — narrow the union type, update all status-setting and status-checking code to remove references to `New` and `Preview`, simplify the CF sync to skip unmanaged domains instead of adding them as "New", and update the domain picker to query CF directly.

**Tech Stack:** TypeScript, Next.js 15, React, Vitest

---

### File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `services/dashboard/src/types/dashboard.ts:1` | Type definition |
| Modify | `services/dashboard/src/lib/constants.ts:3-54` | Status config + list |
| Modify | `services/dashboard/src/actions/sync.ts:23-45,78-96,107-146` | CF sync detection logic |
| Modify | `services/dashboard/src/lib/github.ts:310-319` | Restore status detection |
| Modify | `services/dashboard/src/actions/wizard.ts:277` | Pre-check clash guard |
| Modify | `services/dashboard/src/actions/sites.ts:134` | Delete pre-trash status |
| Modify | `services/dashboard/src/components/dashboard/SitesTable.tsx:206-224` | Row click routing |
| (auto) | `services/dashboard/src/components/dashboard/Filters.tsx` | Updates automatically via `STATUSES` import from constants |
| Modify | `services/dashboard/src/components/ops/FilterBar.tsx:18` | Ops status filter |
| Modify | `services/dashboard/src/app/api/domains/available/route.ts` | Domain picker API |
| Modify | `services/dashboard/src/app/api/articles/general-images/route.ts:42-46` | Active sites filter |
| Modify | `services/dashboard/src/lib/db/dashboard-index.ts:40-51` | Legacy status normalization |
| Modify | `services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts` | Test fixtures |
| Modify | `services/dashboard/src/lib/__tests__/ops-helpers.test.ts:76` | Test fixtures |
| Modify | `services/dashboard/public/guide/02-sites.md:7-18` | Lifecycle diagram + status table |
| Modify | `services/dashboard/public/guide/17-site-deletion.md:14,45` | Restore status reference |

---

### Task 1: Narrow the type and constants

**Files:**
- Modify: `services/dashboard/src/types/dashboard.ts:1`
- Modify: `services/dashboard/src/lib/constants.ts:3-54`

- [ ] **Step 1: Update the SiteStatus type**

In `services/dashboard/src/types/dashboard.ts`, change line 1:

```ts
// Before:
export type SiteStatus = "New" | "Staging" | "Preview" | "Ready" | "Live";

// After:
export type SiteStatus = "Staging" | "Ready" | "Live";
```

- [ ] **Step 2: Update STATUS_CONFIG and STATUSES**

In `services/dashboard/src/lib/constants.ts`, remove the `New` and `Preview` entries from `STATUS_CONFIG` and `STATUSES`:

```ts
export const STATUS_CONFIG: Record<
  SiteStatus,
  { label: string; color: string; bgColor: string }
> = {
  Staging: {
    label: "Staging",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-500/20",
  },
  Ready: {
    label: "Ready",
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-500/20",
  },
  Live: {
    label: "Live",
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-100 dark:bg-green-500/20",
  },
};

// ...

export const STATUSES: SiteStatus[] = [
  "Staging",
  "Ready",
  "Live",
];
```

- [ ] **Step 3: Run typecheck to see all downstream breakages**

Run: `cd services/dashboard && pnpm typecheck`

Expected: Compilation errors in files that reference `"New"` or `"Preview"` — these will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/types/dashboard.ts services/dashboard/src/lib/constants.ts
git commit -m "refactor(status): narrow SiteStatus to Staging | Ready | Live"
```

---

### Task 2: Handle existing MongoDB data (normalize legacy statuses)

Existing MongoDB documents may have `status: "New"` or `status: "Preview"`. The DB read layer (`dashboard-index.ts`) must normalize these at read time **before** any other code changes, so the sync logic never encounters old status values.

**Files:**
- Modify: `services/dashboard/src/lib/db/dashboard-index.ts:40-51`

- [ ] **Step 1: Add status normalization in the MongoDB read path**

In `services/dashboard/src/lib/db/dashboard-index.ts`, add normalization for legacy statuses inside the `for (const doc of allDocs)` loop, before pushing to `sites`:

```ts
for (const doc of allDocs) {
  const { _id, updatedAt, ...rest } = doc as Record<string, unknown>;
  if (rest.status === "deleted" || (rest as Record<string, unknown>).deleted_at) {
    deleted.push(rest as unknown as DeletedSiteEntry);
  } else if (rest.status !== "permanently_deleted") {
    // Normalize legacy statuses
    if (rest.status === "New" || rest.status === "Preview") {
      rest.status = "Staging";
    }
    if (!rest.created_at && rest.last_updated) {
      rest.created_at = rest.last_updated as string;
    }
    sites.push(rest as unknown as DashboardSiteEntry);
  }
}
```

- [ ] **Step 2: Run tests**

Run: `cd services/dashboard && pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/db/dashboard-index.ts
git commit -m "fix(db): normalize legacy New/Preview statuses to Staging on read"
```

---

### Task 3: Simplify the Cloudflare sync logic

**Files:**
- Modify: `services/dashboard/src/actions/sync.ts:23-96,107-146`

The sync currently adds unrecognized CF domains as "New" entries. With "New" removed, the sync should **skip** domains that aren't already in the dashboard index (the wizard is the only entry point for new sites).

- [ ] **Step 1: Remove `detectSiteStatus` and simplify status re-check**

Replace the entire `detectSiteStatus` function and the status correction loop in `syncDomainsFromCloudflare`. The new logic:

- Sites with `staging_branch` + status `"Staging"` → keep `"Staging"`
- Sites with `staging_branch` + status `"Ready"` or `"Live"` → keep current status
- Sites with `custom_domain` → `"Live"`
- Sites in CF with no `custom_domain` and no `staging_branch` → `"Ready"` (deployed but no domain)
- Sites NOT in CF and no config → **remove from index** (orphaned "New" entries)
- Sites with config but not in CF → `"Staging"` (has content, not deployed)

```ts
// Remove the detectSiteStatus function entirely (lines 23-45)

// Replace the status re-check block (lines 73-104) with:
let updatedCount = 0;
const removedDomains: string[] = [];
for (const site of index.sites) {
  const cfInfo = cfDomains.find((d) => d.domain === site.domain);
  const siteConfig = await readSiteConfig(site.domain);

  let correctStatus: SiteStatus;
  if (site.staging_branch && site.status === "Staging") {
    correctStatus = "Staging";
  } else if (site.staging_branch && (site.status === "Ready" || site.status === "Live")) {
    correctStatus = site.status;
  } else if (site.custom_domain) {
    correctStatus = "Live";
  } else if (cfInfo) {
    correctStatus = "Ready";
  } else if (siteConfig) {
    correctStatus = "Staging";
  } else {
    // No CF zone, no config — orphaned entry, remove it
    removedDomains.push(site.domain);
    continue;
  }

  if (site.status !== correctStatus) {
    site.status = correctStatus;
    site.last_updated = now;
    updatedCount++;
  }
}

// Remove orphaned entries
if (removedDomains.length > 0) {
  index.sites = index.sites.filter((s) => !removedDomains.includes(s.domain));
}
```

- [ ] **Step 2: Stop adding new domains from CF sync**

Remove the `newDomainInfos` / `newEntries` block (lines 67-70, 107-157). New domains are no longer auto-added to the dashboard — the wizard handles site creation. Replace the write block:

```ts
if (updatedCount > 0 || removedDomains.length > 0) {
  await writeDashboardIndex(
    index,
    `dashboard: sync ${updatedCount} updated, ${removedDomains.length} removed`
  );
}

revalidatePath("/");

return {
  totalDomains: cfDomains.length,
  newCount: 0,
  domains: [],
};
```

- [ ] **Step 3: Clean up dead code and unused imports**

- Remove the `detectSiteStatus` function entirely (lines 23-45).
- Remove the `generateSiteId` function (lines 170-176) — it was only used by the removed `newEntries` block.
- Remove the `addSitesToIndex` import (line 6) — no longer called.
- Remove the `getAPOStatus` import (line 3) — was only used in the removed `newEntries` block.
- Remove the `CloudflareDomainInfo` type import (line 8) — no longer referenced.
- Keep the `SyncResult` interface returning `newCount: 0` and `domains: []` for backwards compat with callers.

- [ ] **Step 4: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors in `sync.ts`.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/actions/sync.ts
git commit -m "refactor(sync): remove New/Preview statuses, skip unmanaged domains"
```

---

### Task 4: Update domain picker API

**Files:**
- Modify: `services/dashboard/src/app/api/domains/available/route.ts`

The `/api/domains/available` route currently filters `status === "New"`. Since "New" no longer exists, it should return CF domains that are NOT already in the dashboard index.

- [ ] **Step 1: Rewrite the available domains route**

```ts
import { NextResponse } from "next/server";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { listDomainsWithPagesInfo } from "@/lib/cloudflare";

export async function GET(): Promise<NextResponse> {
  try {
    const [index, assetsDomains, dev1Domains] = await Promise.all([
      readDashboardIndex(),
      listDomainsWithPagesInfo(),
      listDomainsWithPagesInfo("financenewsbase"),
    ]);

    const seen = new Set<string>();
    const cfDomains = [...assetsDomains, ...dev1Domains].filter((d) => {
      if (seen.has(d.domain)) return false;
      seen.add(d.domain);
      return true;
    });

    const existingDomains = new Set(index.sites.map((s) => s.domain));
    const existingCustomDomains = new Set(
      index.sites.map((s) => s.custom_domain).filter(Boolean),
    );

    const available = cfDomains
      .map((d) => d.domain)
      .filter((d) => !existingDomains.has(d) && !existingCustomDomains.has(d))
      .sort();

    return NextResponse.json({ domains: available });
  } catch {
    return NextResponse.json({ domains: [] }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/domains/available/route.ts
git commit -m "refactor(domains): query CF directly for available domains"
```

---

### Task 5: Fix the restore (github.ts) fallback

**Files:**
- Modify: `services/dashboard/src/lib/github.ts:310-319`

The restore logic falls back to `"New"` when no config exists. Change it to `"Staging"` since restored sites should at minimum be in staging.

- [ ] **Step 1: Update restore status fallback**

In `services/dashboard/src/lib/github.ts`, around line 318, change:

```ts
// Before:
if (!mainConfig) {
  newStatus = "New";
}

// After:
if (!mainConfig) {
  newStatus = "Staging";
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "fix(restore): use Staging instead of removed New status"
```

---

### Task 6: Update UI components

**Files:**
- Modify: `services/dashboard/src/components/dashboard/SitesTable.tsx:206-224`
- Modify: `services/dashboard/src/components/ops/FilterBar.tsx:18`
- Modify: `services/dashboard/src/app/api/articles/general-images/route.ts:42-46`

- [ ] **Step 1: Simplify SitesTable row click handler**

In `SitesTable.tsx`, replace the switch at lines 206-224:

```ts
function handleRowClick(site: DashboardSiteEntry): void {
  if (site.status === "Staging") {
    router.push(`/sites/${encodeURIComponent(site.domain)}?tab=staging`);
  } else {
    router.push(`/sites/${encodeURIComponent(site.domain)}`);
  }
}
```

- [ ] **Step 2: Update ops FilterBar**

In `services/dashboard/src/components/ops/FilterBar.tsx`, line 18:

```ts
// Before:
const STATUSES: (SiteStatus | "All")[] = ["All", "Live", "Staging", "Preview", "Ready", "New"];

// After:
const STATUSES: (SiteStatus | "All")[] = ["All", "Live", "Staging", "Ready"];
```

- [ ] **Step 3: Simplify general-images active sites filter**

In `services/dashboard/src/app/api/articles/general-images/route.ts`, the filter at lines 42-46 checked for Staging/Ready/Live which was all statuses except New and Preview. Now all sites are active, so remove the filter or simplify:

```ts
// Before:
const activeSites = index.sites.filter(
  (s) =>
    s.status === "Staging" ||
    s.status === "Ready" ||
    s.status === "Live",
);

// After:
const activeSites = index.sites;
```

- [ ] **Step 4: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/components/dashboard/SitesTable.tsx services/dashboard/src/components/ops/FilterBar.tsx services/dashboard/src/app/api/articles/general-images/route.ts
git commit -m "refactor(ui): remove New/Preview from status filters and row routing"
```

---

### Task 7: Fix remaining status references

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:277`
- Modify: `services/dashboard/src/actions/sites.ts:134`

- [ ] **Step 1: Update wizard clash guard**

In `services/dashboard/src/actions/wizard.ts`, line 277:

```ts
// Before:
if (clash && clash.status !== "Staging") {

// After (same logic, just confirming no "New" reference):
if (clash && clash.status !== "Staging") {
```

This line is actually fine — it checks `!== "Staging"` which still works. No change needed. Verify by reading the surrounding context.

- [ ] **Step 2: Update delete pre-trash status**

In `services/dashboard/src/actions/sites.ts`, line 134, the status is set to `"Ready"` before trashing. This is still valid — no change needed. Verify.

- [ ] **Step 3: Run full typecheck to confirm zero errors**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS — zero errors.

- [ ] **Step 4: Commit (only if changes were made)**

---

### Task 8: Update tests

**Files:**
- Modify: `services/dashboard/src/lib/__tests__/ops-helpers.test.ts`
- Modify: `services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts`

- [ ] **Step 1: Verify ops-helpers test**

In `services/dashboard/src/lib/__tests__/ops-helpers.test.ts`, line 76:

```ts
expect(fn(makeRow({ status: "Staging" }))).toBe(false);
```

This is still valid — "Staging" is still a valid status. Check the `makeRow` default status is still valid (uses `"Live"` — fine).

- [ ] **Step 2: Verify dashboard-index tests**

In `services/dashboard/src/lib/db/__tests__/dashboard-index.test.ts`, the test data uses lowercase `"live"`, `"staging"` — these are MongoDB doc values which are strings, not the TypeScript enum. They don't need to change since MongoDB stores whatever was written, and the DB layer casts them.

- [ ] **Step 3: Run tests**

Run: `cd services/dashboard && pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit (only if changes were made)**

---

### Task 9: Update guide documentation

**Files:**
- Modify: `services/dashboard/public/guide/02-sites.md:7-18`
- Modify: `services/dashboard/public/guide/17-site-deletion.md:14,45`

- [ ] **Step 1: Update lifecycle diagram and status table in 02-sites.md**

Replace the lifecycle diagram (line 8) and status table (lines 11-18):

```markdown
## Site Lifecycle

Every site moves through these statuses:

```
Staging --> Ready --> Live
```

| Status | Meaning |
|--------|---------|
| **Staging** | Wizard completed. Site files committed to a staging branch, KV seeded, Worker preview available |
| **Ready** | Staging merged to main. Production KV seeded. No custom domain yet |
| **Live** | Custom domain attached to the production Worker and DNS verified |
```

Remove line 19 ("There is also a **WordPress** status...") if WordPress import now uses "Staging".

- [ ] **Step 2: Update restore diagram in 17-site-deletion.md**

Line 14 — change restore target status:

```markdown
<!-- Before: -->
└──[Restore]──> Active Site (status: New)

<!-- After: -->
└──[Restore]──> Active Site (status: Staging)
```

Line 45 — update restore description:

```markdown
<!-- Before: -->
the site status resets to **New** — it will need to be set up again through the wizard.

<!-- After: -->
the site status resets to **Staging** — it returns to the staging workflow.
```

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/public/guide/02-sites.md services/dashboard/public/guide/17-site-deletion.md
git commit -m "docs(guide): update lifecycle to reflect simplified 3-status model"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `cd services/dashboard && pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Run content-pipeline typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS (content-pipeline uses `status: "Staging"` and `status: "live"` — both still valid).

- [ ] **Step 4: Grep for any remaining "New" or "Preview" status string literals**

Run: `grep -rn '"New"\|"Preview"' services/dashboard/src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.'`
Expected: No matches related to SiteStatus (may have unrelated uses of "New" in UI text).
