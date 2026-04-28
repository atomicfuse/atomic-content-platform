# Custom Domain Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make custom domain attach/detach fully automated — dashboard registers Workers Custom Domains and seeds KV hostname entries via Cloudflare API, eliminating manual redeploy.

**Architecture:** Extend the dashboard's existing Cloudflare API client (`cloudflare.ts`) with Workers Custom Domains + KV write functions. Rewrite `attachCustomDomain`/`detachCustomDomain` actions to orchestrate index write → CF route registration → KV seed in a single call. Fix the zone filtering bug that hides available domains.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Cloudflare API v4, React 19

**Spec:** `docs/superpowers/specs/2026-04-28-custom-domain-routing-design.md`

**Worktree:** `/Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker`

**Branch:** `feat/custom-domain-worker`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `services/dashboard/src/lib/constants.ts` | Modify | Add `WORKER_NAME_PROD`, `KV_NAMESPACE_PROD`, `KV_NAMESPACE_STAGING` |
| `services/dashboard/src/lib/cloudflare.ts` | Modify | Add 5 new API functions + `WorkerCustomDomain` type |
| `services/dashboard/src/actions/wizard.ts` | Modify | Fix `getAvailableZones`, rewrite `attachCustomDomain`/`detachCustomDomain` |
| `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx` | Modify | Error state, pass zoneId, remove redeploy banner |
| `cloudgrid.yaml` | Modify | Document CF secrets for dashboard |
| `CLAUDE.md` | Modify | Update env var table for `CLOUDFLARE_API_TOKEN` |

---

## Task 1: Add worker/KV constants

**Files:**
- Modify: `services/dashboard/src/lib/constants.ts:89` (append after `workerPreviewUrl`)

- [ ] **Step 1: Add constants**

Append to end of `services/dashboard/src/lib/constants.ts`:

```typescript
// --- Cloudflare Worker + KV identifiers (production) ---

/** Production worker name — used for Workers Custom Domains API. */
export const WORKER_NAME_PROD = "atomic-site-worker";

/** Production CONFIG_KV namespace ID. */
export const KV_NAMESPACE_PROD = "a69cb2c59507482ca5e6d114babdd098";

/** Staging CONFIG_KV namespace ID (not used by attach/detach — included for reference). */
export const KV_NAMESPACE_STAGING = "4673c82cdd7f41d49e93d938fb1c6848";
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/lib/constants.ts
git commit -m "feat(dashboard): add worker name and KV namespace constants

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Add Cloudflare Workers Custom Domains + KV API functions

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts:292` (append after `deletePagesProject`)

**Context:**
- `cloudflare.ts` already has `CF_API_BASE`, `getHeaders()`, `getAccountId()`, `CloudflareResponse<T>` type.
- Follow the same patterns (throw on `!data.success`, use `getHeaders()`, use `getAccountId()`).
- `WORKER_NAME_PROD` imported from `constants.ts` (Task 1).

- [ ] **Step 1: Add the `WorkerCustomDomain` type**

Add after the `CloudflareDomainInfo` interface (line ~52) in `cloudflare.ts`:

```typescript
/** A Workers Custom Domain registered on the Cloudflare account. */
export interface WorkerCustomDomain {
  id: string;
  hostname: string;
  zone_id: string;
  service: string;
  environment: string;
}
```

- [ ] **Step 2: Add `registerWorkerCustomDomain`**

Append to end of `cloudflare.ts`:

```typescript
// --- Workers Custom Domains API ---

import { WORKER_NAME_PROD } from "@/lib/constants";

/** Register a custom domain on the production worker.
 *  Cloudflare auto-manages the DNS A/AAAA record for the hostname. */
export async function registerWorkerCustomDomain(
  hostname: string,
  zoneId: string,
): Promise<{ id: string }> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains`,
    {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({
        zone_id: zoneId,
        hostname,
        service: WORKER_NAME_PROD,
        environment: "production",
      }),
    },
  );
  const data = (await response.json()) as CloudflareResponse<{ id: string }>;
  if (!data.success) {
    throw new Error(
      `Failed to register custom domain ${hostname}: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return data.result;
}
```

- [ ] **Step 3: Add `deregisterWorkerCustomDomain`**

Append to `cloudflare.ts`:

```typescript
/** Deregister a custom domain from the production worker.
 *  No-op if the domain is not currently registered. */
export async function deregisterWorkerCustomDomain(
  hostname: string,
): Promise<void> {
  const accountId = getAccountId();
  // Find the domain ID by hostname (server-side filter avoids pagination)
  const listResp = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}&service=${WORKER_NAME_PROD}`,
    { headers: getHeaders() },
  );
  const listData = (await listResp.json()) as CloudflareResponse<WorkerCustomDomain[]>;
  if (!listData.success) {
    throw new Error(
      `Failed to list custom domains: ${listData.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const match = listData.result.find((d) => d.hostname === hostname);
  if (!match) return; // Already removed — no-op

  const delResp = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains/${match.id}`,
    { method: "DELETE", headers: getHeaders() },
  );
  const delData = (await delResp.json()) as CloudflareResponse<null>;
  if (!delData.success) {
    throw new Error(
      `Failed to deregister custom domain ${hostname}: ${delData.errors.map((e) => e.message).join(", ")}`,
    );
  }
}
```

- [ ] **Step 4: Add `listWorkerCustomDomains`**

Append to `cloudflare.ts`:

```typescript
/** List all Workers Custom Domains registered for the production worker.
 *  Handles pagination (same pattern as listZones). */
export async function listWorkerCustomDomains(): Promise<WorkerCustomDomain[]> {
  const accountId = getAccountId();
  const domains: WorkerCustomDomain[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/domains?service=${WORKER_NAME_PROD}&per_page=50&page=${page}`,
      { headers: getHeaders() },
    );
    const data = (await response.json()) as CloudflareResponse<WorkerCustomDomain[]>;
    if (!data.success) {
      throw new Error(
        `Failed to list worker custom domains: ${data.errors.map((e) => e.message).join(", ")}`,
      );
    }
    domains.push(...data.result);
    hasMore = data.result.length === 50;
    page++;
  }

  return domains;
}
```

- [ ] **Step 5: Add `putKVEntry` and `deleteKVEntry`**

Append to `cloudflare.ts`:

```typescript
// --- KV Direct Write API ---

/** Write a single KV entry by key. Value is a raw string (caller must JSON.stringify).
 *  Content-Type is overridden to text/plain because the KV values API expects a raw
 *  body — the default application/json from getHeaders() would be semantically incorrect. */
export async function putKVEntry(
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        ...getHeaders(),
        "Content-Type": "text/plain",
      },
      body: value,
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    throw new Error(
      `Failed to write KV key "${key}": ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}

/** Delete a single KV entry by key. No-op if key does not exist. */
export async function deleteKVEntry(
  namespaceId: string,
  key: string,
): Promise<void> {
  const accountId = getAccountId();
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers: getHeaders(),
    },
  );
  const data = (await response.json()) as CloudflareResponse<null>;
  if (!data.success) {
    // KV delete on a missing key returns success=true, so a failure here is a real error
    throw new Error(
      `Failed to delete KV key "${key}": ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }
}
```

**Important:** The `import` for `WORKER_NAME_PROD` must go at the top of the file with other imports. Since `cloudflare.ts` currently has no imports, add it at line 1:

```typescript
import { WORKER_NAME_PROD } from "@/lib/constants";
```

- [ ] **Step 6: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): add Workers Custom Domains + KV API functions

registerWorkerCustomDomain, deregisterWorkerCustomDomain,
listWorkerCustomDomains, putKVEntry, deleteKVEntry.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Fix `getAvailableZones` filter

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:431-447` (`getAvailableZones` function)

**Context:**
- Current code filters by `usedAsSite` (all site domains) AND `usedCustomDomains`. The `usedAsSite` filter is the bug — it blocks zones that were synced as placeholder site entries.
- Fix: remove `usedAsSite`, keep only `usedCustomDomains`.
- Also add `status: 'active'` filter on zones — pending zones can't have custom domains registered.

- [ ] **Step 1: Fix the filter**

In `services/dashboard/src/actions/wizard.ts`, replace the `getAvailableZones` function body (lines 431-447):

**Before:**
```typescript
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [zones, index] = await Promise.all([
    listZones(),
    readDashboardIndex(),
  ]);

  const usedAsSite = new Set(index.sites.map((s) => s.domain));
  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  return zones
    .filter((z) => !usedAsSite.has(z.name) && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}
```

**After:**
```typescript
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [zones, index] = await Promise.all([
    listZones(),
    readDashboardIndex(),
  ]);

  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  return zones
    .filter((z) => z.status === "active" && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}
```

Changes:
1. Removed `usedAsSite` filter (root cause of the bug).
2. Added `z.status === "active"` — pending zones can't have custom domains registered.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/actions/wizard.ts
git commit -m "fix(dashboard): remove over-aggressive usedAsSite filter from getAvailableZones

The usedAsSite filter blocked zones that syncDomainsFromCloudflare had
created as placeholder entries. Only filter by usedCustomDomains (zones
already attached to a site) and zone status (must be active).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `attachCustomDomain`

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:455-494` (`attachCustomDomain` function)

**Context:**
- Current function: writes to dashboard-index, best-effort email routing, returns `{ redeployRequired: true }`.
- New function: writes index → registers CF custom domain → seeds KV hostname → email routing → returns `{ success: true }`.
- Signature changes: add `zoneId` parameter.
- Need to import `registerWorkerCustomDomain`, `putKVEntry` from `cloudflare.ts` and `KV_NAMESPACE_PROD` from `constants.ts`.
- Dupe-merge logic retained.
- Zone status pre-check: the zone status is already verified by `getAvailableZones` (only active zones shown), but double-check via the `zoneId` is not necessary — trust the dropdown data.

- [ ] **Step 1: Add imports**

In `services/dashboard/src/actions/wizard.ts`, update the `cloudflare` import (line 18):

**Before:**
```typescript
import { listZones } from "@/lib/cloudflare";
```

**After:**
```typescript
import {
  listZones,
  registerWorkerCustomDomain,
  deregisterWorkerCustomDomain,
  putKVEntry,
  deleteKVEntry,
} from "@/lib/cloudflare";
```

Update the `constants` import (line 19):

**Before:**
```typescript
import { workerPreviewUrl } from "@/lib/constants";
```

**After:**
```typescript
import { workerPreviewUrl, KV_NAMESPACE_PROD } from "@/lib/constants";
```

- [ ] **Step 2: Rewrite `attachCustomDomain`**

Replace `attachCustomDomain` function (lines 455-494):

**Before:**
```typescript
export async function attachCustomDomain(
  domain: string,
  customDomain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // Merge a duplicate zone-only entry's zone_id into this site, then drop the dupe.
  const dupeIndex = index.sites.findIndex((s) => s.domain === customDomain);
  if (dupeIndex !== -1) {
    const dupe = index.sites[dupeIndex]!;
    if (dupe.zone_id) site.zone_id = dupe.zone_id;
    index.sites.splice(dupeIndex, 1);
  }

  // Best-effort zone-level setup. Failures here must NOT abort the attach
  // — the data write is the contract; email routing is a nicety.
  if (site.zone_id) {
    try {
      await enableEmailRouting(site.zone_id);
      await createEmailRoutingRule(site.zone_id, customDomain);
    } catch (err) {
      console.error('[attachCustomDomain] email routing setup failed', err);
    }
  }

  site.custom_domain = customDomain;
  site.status = 'Live';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
}
```

**After:**
```typescript
export async function attachCustomDomain(
  domain: string,
  customDomain: string,
  zoneId: string,
): Promise<{ success: true }> {
  // --- Step 1: Write to dashboard-index ---
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // Dupe-merge: absorb zone_id from a placeholder entry matching the custom domain name.
  // If rollback is needed later, the spliced-out dupe is NOT restored — it will be
  // recreated on the next syncDomainsFromCloudflare() run.
  let resolvedZoneId = zoneId;
  const dupeIndex = index.sites.findIndex((s) => s.domain === customDomain);
  if (dupeIndex !== -1) {
    const dupe = index.sites[dupeIndex]!;
    if (dupe.zone_id && !resolvedZoneId) resolvedZoneId = dupe.zone_id;
    index.sites.splice(dupeIndex, 1);
  }

  const previousCustomDomain = site.custom_domain;
  const previousStatus = site.status;
  const previousZoneId = site.zone_id;
  const previousPendingDns = site.worker_pending_dns;

  site.custom_domain = customDomain;
  site.zone_id = resolvedZoneId;
  site.status = 'Live';
  site.worker_pending_dns = false;
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  // --- Step 2: Register custom domain on CF worker ---
  try {
    await registerWorkerCustomDomain(customDomain, resolvedZoneId);
  } catch (err) {
    // Roll back index write
    console.error('[attachCustomDomain] CF registration failed, rolling back index', err);
    site.custom_domain = previousCustomDomain;
    site.status = previousStatus;
    site.zone_id = previousZoneId;
    site.worker_pending_dns = previousPendingDns;
    site.last_updated = new Date().toISOString();
    await writeDashboardIndex(
      index,
      `dashboard: rollback attach ${customDomain} from ${domain}`,
    );
    throw new Error(
      `Failed to register ${customDomain} on Cloudflare: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Step 3: Seed KV hostname entry ---
  // key: site:<customDomain> → value: { siteId: domain }
  // domain is the dashboard-index domain field (site identifier, e.g. "coolnews-atl")
  try {
    await putKVEntry(
      KV_NAMESPACE_PROD,
      `site:${customDomain.toLowerCase()}`,
      JSON.stringify({ siteId: domain }),
    );
  } catch (err) {
    // Non-fatal: KV will be seeded on next sync-kv CI run
    console.warn('[attachCustomDomain] KV seed failed (will self-heal via CI)', err);
  }

  // --- Step 4: Best-effort email routing (existing) ---
  if (site.zone_id) {
    try {
      await enableEmailRouting(site.zone_id);
      await createEmailRoutingRule(site.zone_id, customDomain);
    } catch (err) {
      console.error('[attachCustomDomain] email routing setup failed', err);
    }
  }

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { success: true };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: Type error in `AttachDomainPanel.tsx` — `attachCustomDomain` now requires 3 args. This is expected and fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): rewrite attachCustomDomain with CF + KV automation

Orchestrates: index write → CF Workers Custom Domain registration →
KV hostname seed → email routing. Rolls back index if CF registration
fails. KV seed failure is non-fatal (self-heals via CI sync-kv).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `detachCustomDomain`

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:500-522` (`detachCustomDomain` function)

**Context:**
- Current function: clears field in index, returns `{ redeployRequired: true }`.
- New function: writes index first (clear field) → deregisters CF → deletes KV → returns `{ success: true }`.
- Critical: index write BEFORE CF/KV cleanup to avoid inconsistent state.

- [ ] **Step 1: Rewrite `detachCustomDomain`**

Replace `detachCustomDomain` function:

**Before:**
```typescript
export async function detachCustomDomain(
  domain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.custom_domain) {
    throw new Error(`No custom domain to detach for ${domain}`);
  }

  site.custom_domain = null;
  site.status = 'Ready';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: detach custom domain from ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
}
```

**After:**
```typescript
export async function detachCustomDomain(
  domain: string,
): Promise<{ success: true }> {
  // --- Step 1: Read current state ---
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.custom_domain) {
    throw new Error(`No custom domain to detach for ${domain}`);
  }
  const removedDomain = site.custom_domain;

  // --- Step 2: Write index FIRST (critical ordering) ---
  // If CF/KV cleanup fails later, the index is already correct.
  // Orphaned CF route + KV entry are harmless and self-healing.
  site.custom_domain = null;
  site.status = 'Ready';
  site.worker_pending_dns = true;
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: detach ${removedDomain} from ${domain}`,
  );

  // --- Step 3: Deregister from CF worker (best-effort) ---
  try {
    await deregisterWorkerCustomDomain(removedDomain);
  } catch (err) {
    console.warn('[detachCustomDomain] CF deregistration failed (will self-heal on next deploy)', err);
  }

  // --- Step 4: Delete KV hostname entry (best-effort) ---
  try {
    await deleteKVEntry(
      KV_NAMESPACE_PROD,
      `site:${removedDomain.toLowerCase()}`,
    );
  } catch (err) {
    console.warn('[detachCustomDomain] KV delete failed (stale entry is harmless)', err);
  }

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { success: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: Same type error in `AttachDomainPanel.tsx` from Task 4 (fixed in Task 6). `detachCustomDomain` signature is unchanged (1 arg), so no new errors from this change.

- [ ] **Step 3: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): rewrite detachCustomDomain with CF + KV cleanup

Index write first (critical ordering), then best-effort CF deregistration
and KV hostname deletion. Orphaned resources self-heal on next deploy/CI.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update `AttachDomainPanel` UI

**Files:**
- Modify: `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx`

**Context:**
- Current: silently swallows errors, doesn't pass zoneId, shows "redeploy required" banner.
- New: error state shown in red banner, passes zoneId to `attachCustomDomain`, removes redeploy banner.
- `attachCustomDomain` now takes 3 args: `(domain, customDomain, zoneId)`.

- [ ] **Step 1: Rewrite the component**

Replace the entire content of `AttachDomainPanel.tsx`:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { attachCustomDomain, detachCustomDomain, getAvailableZones } from "@/actions/wizard";

interface AttachDomainPanelProps {
  domain: string;
  customDomain: string | null;
}

export function AttachDomainPanel({
  domain,
  customDomain,
}: AttachDomainPanelProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();
  const [selectedZone, setSelectedZone] = useState<{ domain: string; zoneId: string } | null>(null);
  const [zones, setZones] = useState<Array<{ domain: string; zoneId: string }>>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customDomain) return;
    setLoadingZones(true);
    setError(null);
    getAvailableZones()
      .then(setZones)
      .catch((err) => {
        setZones([]);
        setError(err instanceof Error ? err.message : "Failed to load domains");
      })
      .finally(() => setLoadingZones(false));
  }, [customDomain]);

  function handleAttach(): void {
    if (!selectedZone) return;
    startTransition(async () => {
      try {
        await attachCustomDomain(domain, selectedZone.domain, selectedZone.zoneId);
        setSelectedZone(null);
        router.refresh();
        toast("Domain connected — live in ~60 seconds", "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to attach domain", "error");
      }
    });
  }

  function handleDetach(): void {
    startTransition(async () => {
      try {
        await detachCustomDomain(domain);
        router.refresh();
        toast("Domain disconnected", "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to disconnect domain", "error");
      }
    });
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-3">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">Custom Domain</h3>
      {customDomain ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[var(--text-primary)]">
              Connected to <span className="font-mono text-cyan">{customDomain}</span>
            </span>
          </div>
          <Button size="sm" variant="danger" loading={isPending} onClick={handleDetach}>
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <select
              value={selectedZone?.domain ?? ""}
              onChange={(e): void => {
                const zone = zones.find((z) => z.domain === e.target.value) ?? null;
                setSelectedZone(zone);
              }}
              disabled={loadingZones || zones.length === 0}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
            >
              <option value="">
                {loadingZones ? "Loading domains..." : zones.length === 0 ? "No available domains" : "Select a domain"}
              </option>
              {zones.map((z) => (
                <option key={z.zoneId} value={z.domain}>{z.domain}</option>
              ))}
            </select>
            <Button size="sm" loading={isPending} disabled={!selectedZone} onClick={handleAttach}>
              Attach Domain
            </Button>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

Changes:
1. Added `error` state — shown as red banner below the dropdown.
2. `selectedZone` is now `{ domain, zoneId } | null` — passes both to `attachCustomDomain`.
3. Removed `REDEPLOY_CMD`, `redeployHint`, `copyCmd`, and the entire yellow banner.
4. Toast on attach: "Domain connected — live in ~60 seconds".
5. Error toasts show the actual error message from the action.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker/services/dashboard && pnpm typecheck`
Expected: PASS — all type errors from Task 4 are now resolved.

- [ ] **Step 3: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add services/dashboard/src/components/site-detail/AttachDomainPanel.tsx
git commit -m "feat(dashboard): update AttachDomainPanel — error state, zoneId, no redeploy banner

Show actual Cloudflare API errors instead of silent 'No available domains'.
Pass zoneId through to attachCustomDomain for CF registration. Remove the
manual redeploy hint — attach/detach is now fully automated.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Update `cloudgrid.yaml` and `CLAUDE.md`

**Files:**
- Modify: `cloudgrid.yaml:12` (secrets comment)
- Modify: `CLAUDE.md:334-335` (env var table rows)

- [ ] **Step 1: Update `cloudgrid.yaml`**

In `cloudgrid.yaml`, update the secrets comment for the dashboard service (line 12):

**Before:**
```yaml
    # Secrets (via: cloudgrid secrets set atomic-content-platform KEY=value):
    #   NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_TOKEN, GOOGLE_SERVICE_ACCOUNT_KEY
```

**After:**
```yaml
    # Secrets (via: cloudgrid secrets set atomic-content-platform KEY=value):
    #   NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_TOKEN, GOOGLE_SERVICE_ACCOUNT_KEY,
    #   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
```

- [ ] **Step 2: Update `CLAUDE.md` env var table**

In `CLAUDE.md`, update the two Cloudflare rows:

**Before (line 334):**
```
| `CLOUDFLARE_ACCOUNT_ID` | site-worker (dev + CI) | `953511f6356ff606d84ac89bba3eff50` for Dev1 account during migration. Required for `wrangler deploy`, `wrangler kv ...`, `pnpm seed:kv`. |
```

**After:**
```
| `CLOUDFLARE_ACCOUNT_ID` | dashboard, site-worker (dev + CI) | `953511f6356ff606d84ac89bba3eff50` for Dev1 account. Required for `wrangler deploy`, `wrangler kv ...`, `pnpm seed:kv`, and dashboard domain management. |
```

**Before (line 335):**
```
| `CLOUDFLARE_API_TOKEN` | CI only | Needed by the sync-kv.yml workflow. Required scopes: Workers Scripts:Edit, Workers KV Storage:Edit. Not needed for local dev (uses OAuth via `wrangler login`). |
```

**After:**
```
| `CLOUDFLARE_API_TOKEN` | dashboard, CI | Needed by dashboard (domain attach/detach, zone listing) and sync-kv.yml workflow. Required scopes: Zone:Read, DNS:Edit, Workers Scripts:Edit, Workers KV Storage:Edit. Set in `.env.local` for local dev, CloudGrid secrets for production. |
```

- [ ] **Step 3: Commit**

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
git add cloudgrid.yaml CLAUDE.md
git commit -m "docs: update env var docs for dashboard Cloudflare API usage

CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are now also used by the
dashboard for domain attach/detach. Updated cloudgrid.yaml secrets comment
and CLAUDE.md env var table.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Manual verification

- [ ] **Step 1: Verify env vars and start dashboard locally**

Confirm `services/dashboard/.env.local` contains non-empty values for:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Without these, all Cloudflare API calls will throw.

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform--custom-domain-worker
cloudgrid dev
# or: cd services/dashboard && pnpm dev
```

- [ ] **Step 2: Verify domains load**

Navigate to a site detail page → Identity tab → Custom Domain panel. Verify the dropdown shows Cloudflare zones (not "No available domains"). If there's an error, a red banner should display the message.

- [ ] **Step 3: Test attach flow**

Select an available domain → click "Attach Domain". Verify:
- Toast: "Domain connected — live in ~60 seconds"
- No "redeploy required" banner appears
- Check Cloudflare dashboard: Workers > Custom Domains — the domain should be listed
- Check KV: `wrangler kv key get --namespace-id=a69cb2c59507482ca5e6d114babdd098 "site:<hostname>"` — should return `{"siteId":"<domain>"}`

- [ ] **Step 4: Test detach flow**

Click "Disconnect" on the attached domain. Verify:
- Toast: "Domain disconnected"
- Cloudflare dashboard: domain removed from Workers Custom Domains
- KV entry deleted

- [ ] **Step 5: Test error handling**

Temporarily set an invalid `CLOUDFLARE_API_TOKEN` in `.env.local`. Reload the page. Verify the red error banner appears with a meaningful message (not "No available domains").

---

## Summary

| Task | What | Commit |
|------|------|--------|
| 1 | Add constants | `feat(dashboard): add worker name and KV namespace constants` |
| 2 | Add CF API functions | `feat(dashboard): add Workers Custom Domains + KV API functions` |
| 3 | Fix zone filter | `fix(dashboard): remove over-aggressive usedAsSite filter` |
| 4 | Rewrite attach | `feat(dashboard): rewrite attachCustomDomain with CF + KV automation` |
| 5 | Rewrite detach | `feat(dashboard): rewrite detachCustomDomain with CF + KV cleanup` |
| 6 | Update UI | `feat(dashboard): update AttachDomainPanel` |
| 7 | Update docs | `docs: update env var docs` |
| 8 | Manual verify | No commit — testing only |
