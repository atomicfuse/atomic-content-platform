# Dual-Account Cloudflare Credential Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Cloudflare API calls to the Dev1 account for two legacy sites (financenewsbase, coolnews-atl) while all other sites use the Assets @ AtomicLabs account.

**Architecture:** A `CfCredentials` type + `getCredentials(domain?)` resolver in `cloudflare.ts` checks via `isDev1Domain()` from `constants.ts` (matches both siteIds like "financenewsbase" and custom domains like "financenewsbase.com"). Every function in cloudflare.ts and email-routing.ts that calls the CF API gets an optional `domain` parameter threaded through. List-all operations (zones, custom domains) query both accounts and merge results. The R2 client is keyed per-account.

**Tech Stack:** TypeScript, Next.js App Router (server actions + API routes), Cloudflare REST API, AWS S3 SDK (R2)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/dashboard/src/lib/constants.ts` | Modify | Add Dev1 domain set + Dev1 account constants (KV IDs, staging URL) |
| `services/dashboard/src/lib/cloudflare.ts` | Modify | Add `CfCredentials` type, `getCredentials(domain?)`, thread domain through all functions |
| `services/dashboard/src/lib/email-routing.ts` | Modify | Thread domain through `getHeaders()` and `getAccountId()` calls |
| `services/dashboard/src/lib/r2-upload.ts` | Modify | Accept optional domain, use per-account R2 client |
| `services/dashboard/src/actions/sites.ts` | Modify | Pass domain to CF/KV/R2 functions, use per-domain KV namespace IDs |
| `services/dashboard/src/actions/wizard.ts` | Modify | Pass domain to CF/KV functions, use per-domain KV namespace IDs + staging URL |
| `services/dashboard/src/actions/sync.ts` | Modify | Query both accounts for zones, merge results |
| `services/dashboard/src/actions/domains.ts` | Modify | Query both accounts for zones, merge results |
| `services/dashboard/src/app/api/sites/save/route.ts` | Modify | Pass domain to DNS functions for correct API token routing |
| `services/dashboard/src/app/api/email-routing/[domain]/route.ts` | Modify | Pass domain to email routing functions for correct API token routing |

---

### Task 1: Add Dev1 constants and credential resolver

**Files:**
- Modify: `services/dashboard/src/lib/constants.ts`
- Modify: `services/dashboard/src/lib/cloudflare.ts`

This task adds the Dev1 domain set, Dev1 account constants, and the `getCredentials(domain?)` function that all other tasks depend on.

- [ ] **Step 1: Add Dev1 constants to constants.ts**

Add after the existing `R2_BUCKET_PROD` constant at the end of the file:

```typescript
// --- Dev1 legacy account (temporary — remove after zone transfer to Assets) ---

/** Site identifiers whose zones still live on the Dev1 Cloudflare account.
 *  These are dashboard-index `domain` values (site folder names).
 *  Remove a domain from this set after its zone is transferred to Assets. */
export const DEV1_SITE_IDS = new Set(["financenewsbase", "coolnews-atl"]);

/** Custom domains (hostnames) that belong to Dev1 sites.
 *  Used by functions that receive a custom domain instead of a siteId
 *  (e.g. email routing's `createEmailRoutingRule`). */
export const DEV1_CUSTOM_DOMAINS = new Set(["financenewsbase.com", "coolnews.dev"]);

/** Check if a domain identifier (siteId OR custom domain) belongs to the Dev1 account. */
export function isDev1Domain(domain: string): boolean {
  return DEV1_SITE_IDS.has(domain) || DEV1_CUSTOM_DOMAINS.has(domain);
}

/** Dev1 account ID. */
export const DEV1_ACCOUNT_ID = "953511f6356ff606d84ac89bba3eff50";

/** Dev1 production CONFIG_KV namespace ID. */
export const DEV1_KV_NAMESPACE_PROD = "a69cb2c59507482ca5e6d114babdd098";

/** Dev1 staging CONFIG_KV namespace ID. */
export const DEV1_KV_NAMESPACE_STAGING = "4673c82cdd7f41d49e93d938fb1c6848";

/** Dev1 staging Worker preview URL. */
export const DEV1_WORKER_STAGING_URL =
  "https://atomic-site-worker-staging.dev1-953.workers.dev";
```

- [ ] **Step 2: Add CfCredentials type and getCredentials resolver to cloudflare.ts**

Replace the existing `getHeaders()` and `getAccountId()` functions (lines 72-85) with:

```typescript
// --- Credential resolver ---

export interface CfCredentials {
  accountId: string;
  token: string;
}

/** Resolve CF credentials for a domain. Dev1 domains use DEV1_CLOUDFLARE_API_TOKEN;
 *  everything else uses the primary CLOUDFLARE_API_TOKEN.
 *  Accepts both siteIds ("financenewsbase") and custom domains ("financenewsbase.com"). */
export function getCredentials(domain?: string): CfCredentials {
  if (domain && isDev1Domain(domain)) {
    const token = process.env.DEV1_CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error("DEV1_CLOUDFLARE_API_TOKEN is not set");
    return { accountId: DEV1_ACCOUNT_ID, token };
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  return { accountId, token };
}

function headersFromCreds(creds: CfCredentials): HeadersInit {
  return {
    Authorization: `Bearer ${creds.token}`,
    "Content-Type": "application/json",
  };
}

// Keep backward-compat wrappers for callers that don't have domain context.
function getHeaders(): HeadersInit {
  return headersFromCreds(getCredentials());
}

export function getAccountId(): string {
  return getCredentials().accountId;
}
```

Also add the import at the top of cloudflare.ts:

```typescript
import { WORKER_NAME_PROD, isDev1Domain, DEV1_ACCOUNT_ID } from "@/lib/constants";
```

- [ ] **Step 3: Add `getKvNamespaces` helper to constants.ts**

Add a helper that returns the right KV namespace IDs for a domain:

```typescript
/** Get the KV namespace IDs for a domain (Dev1 or Assets). */
export function getKvNamespaces(domain: string): {
  prod: string;
  staging: string;
} {
  if (isDev1Domain(domain)) {
    return { prod: DEV1_KV_NAMESPACE_PROD, staging: DEV1_KV_NAMESPACE_STAGING };
  }
  return { prod: KV_NAMESPACE_PROD, staging: KV_NAMESPACE_STAGING };
}

/** Get the Worker staging preview URL for a domain (Dev1 or Assets). */
export function getWorkerStagingUrl(domain: string): string {
  if (isDev1Domain(domain)) return DEV1_WORKER_STAGING_URL;
  return WORKER_STAGING_URL;
}
```

Update `workerPreviewUrl` to use it:

```typescript
export function workerPreviewUrl(siteId: string, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = getWorkerStagingUrl(siteId);
  return `${base}${cleanPath}?_atl_site=${encodeURIComponent(siteId)}`;
}
```

- [ ] **Step 4: Verify the file compiles**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No new errors (existing callers still use the backward-compat wrappers)

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/constants.ts services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): add Dev1 credential resolver for dual-account CF routing"
```

---

### Task 2: Thread domain through cloudflare.ts account-scoped functions

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts`

Every function that calls `getAccountId()` or `getHeaders()` gets an optional `domain?: string` parameter. The function passes it to `getCredentials(domain)` and uses the result.

**Zone-scoped functions** (`upsertDnsTxtRecord`, `deleteDnsTxtRecord`, `getAPOStatus`, `getEmailRoutingStatus`, etc.) don't need the domain parameter — they use `zoneId` and the token is account-agnostic for zone operations. But `getHeaders()` still provides the token, so we need a way to pass the right token for zone-scoped operations too.

Strategy: Zone-scoped functions get an optional `domain?: string` so the correct API token is used. Account-scoped functions get it for both accountId and token routing.

- [ ] **Step 1: Update account-scoped functions**

For each of these functions, add `domain?: string` as the **last** parameter and replace the internal `getAccountId()` / `getHeaders()` calls with credential-resolved versions:

**`listZones`** — special: needs to return zones from a specific account or the default.

```typescript
export async function listZones(domain?: string): Promise<CloudflareZone[]> {
  const creds = getCredentials(domain);
  const headers = headersFromCreds(creds);
  const zones: CloudflareZone[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${CF_API_BASE}/zones?account.id=${creds.accountId}&per_page=50&page=${page}`,
      { headers },
    );
    const data = (await response.json()) as CloudflareResponse<CloudflareZone[]>;
    if (!data.success) {
      throw new Error(
        `Cloudflare API error: ${data.errors.map((e) => e.message).join(", ")}`,
      );
    }
    zones.push(...data.result);
    hasMore = data.result.length === 50;
    page++;
  }

  return zones;
}
```

Apply the same pattern (`const creds = getCredentials(domain); const headers = headersFromCreds(creds);`) to:

- `listPagesProjects(domain?: string)` — line 118
- `getPagesProjectDomains(projectName, domain?: string)` — line 134
- `listDomainsWithPagesInfo(domain?: string)` — line 161 (passes domain to listZones + listPagesProjects)
- `triggerPagesBuild(projectName, domain?: string)` — line 216
- `getLatestDeployment(projectName, domain?: string)` — line 240
- `deletePagesProject(name, domain?: string)` — line 292
- `registerWorkerCustomDomain(hostname, zoneId, domain?: string)` — line 314
- `deregisterWorkerCustomDomain(hostname, domain?: string)` — line 343
- `listWorkerCustomDomains(domain?: string)` — line 376
- `putKVEntry(namespaceId, key, value, domain?: string)` — line 498
- `deleteKVEntry(namespaceId, key, domain?: string)` — line 524
- `getKVEntry(namespaceId, key, domain?: string)` — line 547
- `listKVKeys(namespaceId, prefix, domain?: string)` — line 565
- `bulkPutKV(namespaceId, entries, domain?: string)` — line 599
- `bulkDeleteKV(namespaceId, keys, domain?: string)` — line 623
- `deleteKVByPrefix(namespaceId, prefix, domain?: string)` — line 647 (passes domain to listKVKeys + bulkDeleteKV)

- [ ] **Step 2: Update zone-scoped functions**

These use `getHeaders()` for the token but don't need `getAccountId()`. Add `domain?: string` so the correct token is used:

- `getAPOStatus(zoneId, domain?: string)` — line 274
- `upsertDnsTxtRecord(zoneId, name, content, domain?: string)` — line 413
- `deleteDnsTxtRecord(zoneId, name, contentPrefix, domain?: string)` — line 472

For these, use: `const headers = headersFromCreds(getCredentials(domain));`

- [ ] **Step 3: Update R2 client to be per-account**

Replace the lazy singleton with an account-keyed cache:

```typescript
const _s3Clients = new Map<string, S3Client>();

export function getR2Client(domain?: string): S3Client | null {
  const creds = getCredentials(domain);
  const existing = _s3Clients.get(creds.accountId);
  if (existing) return existing;

  const accessKeyId = domain && isDev1Domain(domain)
    ? process.env.DEV1_R2_ACCESS_KEY_ID
    : process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = domain && isDev1Domain(domain)
    ? process.env.DEV1_R2_SECRET_ACCESS_KEY
    : process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.warn("R2 cleanup skipped: R2 credentials not configured");
    return null;
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  _s3Clients.set(creds.accountId, client);
  return client;
}
```

Update `deleteR2ObjectsByPrefix` and `deleteR2Objects` to accept and pass `domain?: string`:

```typescript
export async function deleteR2ObjectsByPrefix(
  bucket: string,
  prefix: string,
  domain?: string,
): Promise<number> {
  const client = getR2Client(domain);
  // ... rest unchanged
}

export async function deleteR2Objects(
  bucket: string,
  keys: string[],
  domain?: string,
): Promise<number> {
  if (keys.length === 0) return 0;
  const client = getR2Client(domain);
  // ... rest unchanged
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Errors in consumer files (sites.ts, wizard.ts, etc.) because they import functions whose signatures changed. That's expected — we fix them in the next tasks. The cloudflare.ts file itself should have no errors since all new params are optional.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/cloudflare.ts
git commit -m "feat(dashboard): thread domain param through all cloudflare.ts functions"
```

---

### Task 3: Update r2-upload.ts

**Files:**
- Modify: `services/dashboard/src/lib/r2-upload.ts`

- [ ] **Step 1: Add domain parameter to uploadToR2**

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client } from "@/lib/cloudflare";

const R2_BUCKET = "atl-assets-prod";

export async function uploadToR2(
  key: string,
  data: Buffer,
  contentType: string,
  domain?: string,
): Promise<boolean> {
  const client = getR2Client(domain);
  if (!client) {
    console.warn("[r2-upload] R2 not configured — skipping upload");
    return false;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    console.log(`[r2-upload] Uploaded ${key} (${(data.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(
      `[r2-upload] Failed to upload ${key}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Pass (domain is optional, no callers break)

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/r2-upload.ts
git commit -m "feat(dashboard): thread domain through r2-upload for dual-account support"
```

---

### Task 4: Update email-routing.ts

**Files:**
- Modify: `services/dashboard/src/lib/email-routing.ts`

The email-routing module has its own `getHeaders()` and imports `getAccountId` from cloudflare. Replace both with credential-resolved versions.

- [ ] **Step 1: Replace credential usage**

Replace the local `getHeaders()` (lines 46-53) and the `getAccountId` import:

```typescript
import { getCredentials, headersFromCreds } from "@/lib/cloudflare";
```

Remove the local `getHeaders()` function. Remove the `import { getAccountId } from "@/lib/cloudflare"` line.

In every function that uses `getHeaders()` or `getAccountId()`, add a `domain?: string` parameter and use:

```typescript
const creds = getCredentials(domain);
const headers = headersFromCreds(creds);
```

Functions to update:
- `addDestinationAddress(email, domain?: string)` — uses accountId + headers
- `listDestinationAddresses(domain?: string)` — uses accountId + headers
- `getEmailRoutingStatus(zoneId, domain?: string)` — uses headers
- `enableEmailRouting(zoneId, domain?: string)` — uses headers
- `listEmailRoutingRules(zoneId, domain?: string)` — uses headers
- `findEmailRule(zoneId, email, domain?: string)` — passes domain to listEmailRoutingRules
- `createEmailRoutingRule(zoneId, domain, destination?)` — already has `domain` as its second param (used to build `contact@domain`). This value may be a custom domain like "financenewsbase.com" (when called from `attachCustomDomain`) or a siteId like "financenewsbase" (when called from the email routing API). Thanks to `isDev1Domain()` checking both `DEV1_SITE_IDS` and `DEV1_CUSTOM_DOMAINS`, calling `getCredentials(domain)` with the existing `domain` param works in both cases. No new parameter needed.
- `findEmailRule(zoneId, email, domain?: string)` — add `domain` as a third param, pass to `listEmailRoutingRules`
- `deleteEmailRoutingRule(zoneId, ruleId, domain?: string)` — uses headers
- `getSiteEmailConfig(domain, zoneId, customDomain)` — the first param IS the siteId. Pass it to `findEmailRule` for credential routing.

- [ ] **Step 2: Update email routing API route to pass domain**

In `services/dashboard/src/app/api/email-routing/[domain]/route.ts`, pass `domain` to all email routing function calls:

- `getSiteEmailConfig(domain, site.zone_id, site.custom_domain)` — first param is already the siteId, `getSiteEmailConfig` will thread it through. No change needed here since the function signature uses it internally.
- `createEmailRoutingRule(site.zone_id, domain, destination)` — `domain` here is the URL param (siteId like "financenewsbase"). `isDev1Domain` will match it against `DEV1_SITE_IDS`. No change needed.
- `findEmailRule(site.zone_id, email)` → `findEmailRule(site.zone_id, email, domain)` — add domain as third param
- `deleteEmailRoutingRule(site.zone_id, rule.id)` → `deleteEmailRoutingRule(site.zone_id, rule.id, domain)` — add domain as third param

- [ ] **Step 3: Export headersFromCreds from cloudflare.ts**

In `cloudflare.ts`, change `headersFromCreds` from a private function to an exported function:

```typescript
export function headersFromCreds(creds: CfCredentials): HeadersInit {
```

- [ ] **Step 4: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/email-routing.ts services/dashboard/src/lib/cloudflare.ts services/dashboard/src/app/api/email-routing/\[domain\]/route.ts
git commit -m "feat(dashboard): thread domain through email-routing for dual-account support"
```

---

### Task 5: Update actions/sites.ts (site deletion)

**Files:**
- Modify: `services/dashboard/src/actions/sites.ts`

Site deletion uses KV namespace IDs from constants and calls cloudflare.ts functions. Replace hardcoded namespace IDs with `getKvNamespaces(domain)`.

- [ ] **Step 1: Update imports**

Replace:
```typescript
import {
  KV_NAMESPACE_PROD,
  KV_NAMESPACE_STAGING,
  R2_BUCKET_PROD,
} from "@/lib/constants";
```

With:
```typescript
import {
  R2_BUCKET_PROD,
  getKvNamespaces,
} from "@/lib/constants";
```

- [ ] **Step 2: Update deleteSiteEntry**

In the KV cleanup section (around line 121), replace:
```typescript
const namespaces = [
  { id: KV_NAMESPACE_STAGING, label: "staging" },
  { id: KV_NAMESPACE_PROD, label: "prod" },
];
```

With:
```typescript
const kv = getKvNamespaces(domain);
const namespaces = [
  { id: kv.staging, label: "staging" },
  { id: kv.prod, label: "prod" },
];
```

Pass `domain` to all CF function calls:
- `deleteKVEntry(ns.id, key)` → `deleteKVEntry(ns.id, key, domain)`
- `deleteKVByPrefix(ns.id, prefix)` → `deleteKVByPrefix(ns.id, prefix, domain)`
- `deleteR2ObjectsByPrefix(R2_BUCKET_PROD, ...)` → `deleteR2ObjectsByPrefix(R2_BUCKET_PROD, ..., domain)`
- `deletePagesProject(site.pages_project)` → `deletePagesProject(site.pages_project, domain)`

In the prefix cleanup section (around line 159), apply the same `getKvNamespaces(domain)` + pass `domain` pattern.

- [ ] **Step 3: Update permanentlyDeleteSite**

Replace:
```typescript
for (const nsId of [KV_NAMESPACE_STAGING, KV_NAMESPACE_PROD]) {
```

With:
```typescript
const kv = getKvNamespaces(domain);
for (const nsId of [kv.staging, kv.prod]) {
```

Pass `domain` to all CF function calls within this function:
- `deleteKVByPrefix(nsId, ...)` → `deleteKVByPrefix(nsId, ..., domain)`
- `deleteKVEntry(nsId, ...)` → `deleteKVEntry(nsId, ..., domain)`
- `deleteR2ObjectsByPrefix(R2_BUCKET_PROD, ..., domain)`

- [ ] **Step 4: Update deleteArticleImages**

Pass `domain` to `deleteR2Objects`:

```typescript
async function deleteArticleImages(domain: string, slugs: string[]): Promise<void> {
  const keys = slugs.map((s) => articleImageKey(domain, s));
  try {
    await deleteR2Objects(R2_BUCKET_PROD, keys, domain);
  } catch (err) {
    // ... unchanged
  }
}
```

- [ ] **Step 5: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/actions/sites.ts
git commit -m "feat(dashboard): route site deletion KV/R2 calls through dual-account resolver"
```

---

### Task 6: Update actions/wizard.ts (domain attach/detach, KV promotion, preview URL)

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

This is the largest consumer. Uses KV namespaces, domain registration, and email routing.

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { workerPreviewUrl, KV_NAMESPACE_PROD, KV_NAMESPACE_STAGING } from "@/lib/constants";
```

With:
```typescript
import { workerPreviewUrl, getKvNamespaces } from "@/lib/constants";
```

- [ ] **Step 2: Update getAvailableZones (line 663)**

This must return zones from BOTH accounts:

```typescript
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [assetsZones, dev1Zones, index] = await Promise.all([
    listZones(),
    listZones("financenewsbase"), // any Dev1 domain triggers Dev1 creds
    readDashboardIndex(),
  ]);

  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  // Merge and dedupe by zone name (shouldn't overlap but defensive)
  const seen = new Set<string>();
  const allZones = [...assetsZones, ...dev1Zones].filter((z) => {
    if (seen.has(z.name)) return false;
    seen.add(z.name);
    return true;
  });

  return allZones
    .filter((z) => z.status === "active" && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}
```

- [ ] **Step 3: Update promoteSiteToProduction (line 684)**

Replace KV namespace constants with per-domain lookup. The `siteId` param IS the domain:

```typescript
async function promoteSiteToProduction(siteId: string): Promise<number> {
  const kv = getKvNamespaces(siteId);

  const singleKeys = [
    `site-config:${siteId}`,
    `article-index:${siteId}`,
    `sync-status:${siteId}`,
  ];

  const [articleKeys, sharedPageKeys] = await Promise.all([
    listKVKeys(kv.staging, `article:${siteId}:`, siteId),
    listKVKeys(kv.staging, `shared-page:${siteId}:`, siteId),
  ]);

  const allKeys = [...singleKeys, ...articleKeys, ...sharedPageKeys];

  const BATCH_SIZE = 20;
  const entries: Array<{ key: string; value: string }> = [];

  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batch = allKeys.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (key) => {
        const value = await getKVEntry(kv.staging, key, siteId);
        return value ? { key, value } : null;
      }),
    );
    for (const r of results) {
      if (r) entries.push(r);
    }
  }

  if (entries.length === 0) {
    console.warn(`[promoteSiteToProduction] No KV entries found for siteId="${siteId}" in staging`);
    return 0;
  }

  await bulkPutKV(kv.prod, entries, siteId);
  console.log(`[promoteSiteToProduction] Copied ${entries.length} KV entries from staging to production for siteId="${siteId}"`);
  return entries.length;
}
```

- [ ] **Step 4: Update patchSiteConfigDomain (line 733)**

```typescript
async function patchSiteConfigDomain(siteId: string, customDomain: string): Promise<void> {
  const configKey = `site-config:${siteId}`;
  const kv = getKvNamespaces(siteId);

  for (const ns of [kv.prod, kv.staging]) {
    try {
      const raw = await getKVEntry(ns, configKey, siteId);
      if (!raw) continue;
      const config = JSON.parse(raw) as Record<string, unknown>;
      config.domain = customDomain;
      await putKVEntry(ns, configKey, JSON.stringify(config), siteId);
    } catch (err) {
      console.warn(`[patchSiteConfigDomain] Failed to patch KV (${ns})`, err);
    }
  }

  // ... rest (git operations) unchanged
}
```

- [ ] **Step 5: Update attachCustomDomain (line 768)**

Pass `domain` to ALL CF calls — including rollback/error paths:

**Success path:**
- `registerWorkerCustomDomain(customDomain, resolvedZoneId)` → `registerWorkerCustomDomain(customDomain, resolvedZoneId, domain)`
- `putKVEntry(KV_NAMESPACE_PROD, ...)` → `putKVEntry(getKvNamespaces(domain).prod, ..., domain)`
- `enableEmailRouting(site.zone_id)` → `enableEmailRouting(site.zone_id, domain)`
- `createEmailRoutingRule(site.zone_id, customDomain)` — `customDomain` (e.g. "financenewsbase.com") is already the second arg; `isDev1Domain` will match it against `DEV1_CUSTOM_DOMAINS`. No change needed.

**Rollback path (EC-5, ~line 854 — KV seed failure):**
- `deregisterWorkerCustomDomain(customDomain)` → `deregisterWorkerCustomDomain(customDomain, domain)`

**Rollback path (~line 820 — CF registration failure):**
- No CF calls in this path (only index rollback), so no changes needed.

- [ ] **Step 6: Update detachCustomDomain (line 919)**

- `deregisterWorkerCustomDomain(removedDomain)` → `deregisterWorkerCustomDomain(removedDomain, domain)`
- `deleteKVEntry(KV_NAMESPACE_PROD, ...)` → `deleteKVEntry(getKvNamespaces(domain).prod, ..., domain)`

- [ ] **Step 7: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): route wizard KV/domain/email calls through dual-account resolver"
```

---

### Task 7: Update actions/sync.ts and actions/domains.ts (dual-account zone listing)

**Files:**
- Modify: `services/dashboard/src/actions/sync.ts`
- Modify: `services/dashboard/src/actions/domains.ts`

These list all zones. They need to query both accounts and merge results.

- [ ] **Step 1: Update sync.ts**

In `syncDomainsFromCloudflare()`, replace:
```typescript
const cfDomains = await listDomainsWithPagesInfo();
```

With:
```typescript
// Query both accounts for zones and merge
const [assetsDomains, dev1Domains] = await Promise.all([
  listDomainsWithPagesInfo(),
  listDomainsWithPagesInfo("financenewsbase"),
]);
const seen = new Set<string>();
const cfDomains = [...assetsDomains, ...dev1Domains].filter((d) => {
  if (seen.has(d.domain)) return false;
  seen.add(d.domain);
  return true;
});
```

**Known limitation:** `getAPOStatus` makes its own fetch with `getHeaders()` which defaults to the Assets token. For Dev1 zones this will fail silently (returns `false`). This is acceptable — APO status is informational only and Dev1 is temporary. No code change needed.

- [ ] **Step 2: Update domains.ts**

Replace:
```typescript
const [zones, index] = await Promise.all([
  listZones(),
  readDashboardIndex(),
]);
```

With:
```typescript
const [assetsZones, dev1Zones, index] = await Promise.all([
  listZones(),
  listZones("financenewsbase"),
  readDashboardIndex(),
]);
const seen = new Set<string>();
const zones = [...assetsZones, ...dev1Zones].filter((z) => {
  if (seen.has(z.name)) return false;
  seen.add(z.name);
  return true;
});
```

- [ ] **Step 3: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/actions/sync.ts services/dashboard/src/actions/domains.ts
git commit -m "feat(dashboard): merge zones from both CF accounts in sync + domains listing"
```

---

### Task 8: Update api/sites/save/route.ts (DNS operations)

**Files:**
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`

The save route calls `upsertDnsTxtRecord` and `deleteDnsTxtRecord` for Facebook domain verification. These are zone-scoped but need the correct API token.

- [ ] **Step 1: Pass domain to DNS functions**

Find the section (around line 256-272) that calls DNS functions:

```typescript
if (fbVerification) {
  await upsertDnsTxtRecord(
    site.zone_id,
    domain,
    `facebook-domain-verification=${fbVerification}`,
    domain,  // ← add: account routing
  );
} else if (fbVerification === null || fbVerification === "") {
  await deleteDnsTxtRecord(
    site.zone_id,
    domain,
    "facebook-domain-verification=",
    domain,  // ← add: account routing
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/sites/save/route.ts
git commit -m "feat(dashboard): pass domain to DNS operations for dual-account token routing"
```

---

### Task 9: Add Dev1 env vars to .env.local and CloudGrid

**Files:**
- Modify: `services/dashboard/.env.local`

- [ ] **Step 1: Add Dev1 env vars to .env.local**

Add the Dev1 credentials. The Dev1 API token is the old one that was in `.env.local` before the migration. You'll need to provide it:

```
# Dev1 legacy account (for financenewsbase + coolnews-atl until zone transfer)
DEV1_CLOUDFLARE_API_TOKEN=<dev1-api-token-here>
DEV1_R2_ACCESS_KEY_ID=<dev1-r2-access-key>
DEV1_R2_SECRET_ACCESS_KEY=<dev1-r2-secret-key>
```

- [ ] **Step 2: Set CloudGrid secrets**

```bash
cloudgrid secrets set sites-platform-e297 DEV1_CLOUDFLARE_API_TOKEN=<dev1-api-token>
cloudgrid secrets set sites-platform-e297 DEV1_R2_ACCESS_KEY_ID=<dev1-r2-access-key>
cloudgrid secrets set sites-platform-e297 DEV1_R2_SECRET_ACCESS_KEY=<dev1-r2-secret-key>
```

- [ ] **Step 3: Commit**

No commit needed — `.env.local` is gitignored.

---

### Task 10: Update sync-kv.yml for dual-account seeding

**Files:**
- Modify: (in network repo) `.github/workflows/sync-kv.yml`

The `sync-kv.yml` workflow needs to seed Dev1 KV for Dev1 sites and Assets KV for everything else. The simplest approach: add conditional env vars in the "Sync to KV" step.

- [ ] **Step 1: Add Dev1 secrets to network repo**

```bash
gh secret set DEV1_CLOUDFLARE_ACCOUNT_ID --repo atomicfuse/atomic-labs-network --body "953511f6356ff606d84ac89bba3eff50"
gh secret set DEV1_CLOUDFLARE_API_TOKEN --repo atomicfuse/atomic-labs-network --body "<dev1-api-token>"
gh secret set DEV1_KV_NAMESPACE_ID_PROD --repo atomicfuse/atomic-labs-network --body "a69cb2c59507482ca5e6d114babdd098"
gh secret set DEV1_KV_NAMESPACE_ID_STAGING --repo atomicfuse/atomic-labs-network --body "4673c82cdd7f41d49e93d938fb1c6848"
```

- [ ] **Step 2: Update the sync step to detect Dev1 sites**

In the "Sync ${{ matrix.site }} to KV" step, add conditional account routing before the `pnpm seed:kv` call:

```yaml
      - name: Sync ${{ matrix.site }} to KV
        working-directory: platform/packages/site-worker
        env:
          NETWORK_DATA_PATH: ${{ github.workspace }}
          R2_BUCKET: atl-assets-prod
          KV_REMOTE: "true"
          R2_REMOTE: "true"
        run: |
          SITE="${{ matrix.site }}"

          # Dev1 legacy sites use Dev1 account credentials
          DEV1_SITES="financenewsbase coolnews-atl"
          if echo "$DEV1_SITES" | grep -qw "$SITE"; then
            echo "→ Dev1 site detected: using Dev1 credentials"
            export CLOUDFLARE_API_TOKEN="${{ secrets.DEV1_CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.DEV1_CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              export KV_NAMESPACE_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_PROD }}"
            else
              export KV_NAMESPACE_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_STAGING }}"
            fi
          else
            export CLOUDFLARE_API_TOKEN="${{ secrets.CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              export KV_NAMESPACE_ID="${{ secrets.KV_NAMESPACE_ID_PROD }}"
            else
              export KV_NAMESPACE_ID="${{ secrets.KV_NAMESPACE_ID_STAGING }}"
            fi
          fi

          # Derive hostnames from dashboard-index.yaml
          HOSTS="$(python3 -c "
          import yaml, sys
          with open('$GITHUB_WORKSPACE/dashboard-index.yaml') as f: data = yaml.safe_load(f)
          for s in data.get('sites', []):
              if s.get('domain') == '$SITE':
                  hs = [s['domain']]
                  if s.get('custom_domain'): hs.append(s['custom_domain'])
                  if s.get('pages_subdomain'): hs.append(s['pages_subdomain'] + '.pages.dev')
                  print(' '.join(hs))
                  break
          ")"
          echo "Hostnames for $SITE: $HOSTS"
          pnpm seed:kv "$SITE" $HOSTS
```

Also update the "Verify article-index in KV" step with the same conditional:

```yaml
      - name: Verify article-index in KV
        working-directory: platform/packages/site-worker
        run: |
          SITE="${{ matrix.site }}"

          DEV1_SITES="financenewsbase coolnews-atl"
          if echo "$DEV1_SITES" | grep -qw "$SITE"; then
            export CLOUDFLARE_API_TOKEN="${{ secrets.DEV1_CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.DEV1_CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              NS_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_PROD }}"
            else
              NS_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_STAGING }}"
            fi
          else
            export CLOUDFLARE_API_TOKEN="${{ secrets.CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              NS_ID="${{ secrets.KV_NAMESPACE_ID_PROD }}"
            else
              NS_ID="${{ secrets.KV_NAMESPACE_ID_STAGING }}"
            fi
          fi

          # ... rest of verification unchanged
```

And the "On-failure" step:

```yaml
      - name: On-failure — record sync-status + notify
        if: failure()
        working-directory: platform/packages/site-worker
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          SITE="${{ matrix.site }}"

          DEV1_SITES="financenewsbase coolnews-atl"
          if echo "$DEV1_SITES" | grep -qw "$SITE"; then
            export CLOUDFLARE_API_TOKEN="${{ secrets.DEV1_CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.DEV1_CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              NS_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_PROD }}"
            else
              NS_ID="${{ secrets.DEV1_KV_NAMESPACE_ID_STAGING }}"
            fi
          else
            export CLOUDFLARE_API_TOKEN="${{ secrets.CLOUDFLARE_API_TOKEN }}"
            export CLOUDFLARE_ACCOUNT_ID="${{ secrets.CLOUDFLARE_ACCOUNT_ID }}"
            if [[ "${{ github.ref_name }}" == "main" ]]; then
              NS_ID="${{ secrets.KV_NAMESPACE_ID_PROD }}"
            else
              NS_ID="${{ secrets.KV_NAMESPACE_ID_STAGING }}"
            fi
          fi

          FAIL_PAYLOAD=$(jq -nc --arg sha "$GITHUB_SHA" --arg at "$(date -u +%FT%TZ)" \
                         '{gitSha: $sha, committedAt: $at, syncedAt: $at, ok: false, error: "CI sync failed"}')
          npx wrangler kv key put "sync-status:$SITE" "$FAIL_PAYLOAD" \
            --namespace-id="$NS_ID" --remote || true

          if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
            curl -sf -X POST "$SLACK_WEBHOOK_URL" \
              -H 'Content-Type: application/json' \
              -d "{\"text\":\"KV sync failed for site: $SITE (branch: ${{ github.ref_name }}, sha: ${GITHUB_SHA:0:7})\"}" \
              || true
          fi
```

- [ ] **Step 3: Commit the workflow changes**

This is in the network repo:

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git add .github/workflows/sync-kv.yml
git commit -m "feat(ci): dual-account KV seeding for Dev1 legacy sites"
```

---

### Task 11: Final typecheck and manual smoke test

- [ ] **Step 1: Full typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`
Expected: All packages pass

- [ ] **Step 2: Verify the dashboard starts**

Run: `cd services/dashboard && pnpm dev`
Expected: Starts without errors, no crashes on missing env vars (Dev1 vars are only accessed when a Dev1 domain is requested)

- [ ] **Step 3: Commit and push all platform changes**

```bash
git add \
  services/dashboard/src/lib/constants.ts \
  services/dashboard/src/lib/cloudflare.ts \
  services/dashboard/src/lib/email-routing.ts \
  services/dashboard/src/lib/r2-upload.ts \
  services/dashboard/src/actions/sites.ts \
  services/dashboard/src/actions/wizard.ts \
  services/dashboard/src/actions/sync.ts \
  services/dashboard/src/actions/domains.ts \
  services/dashboard/src/app/api/sites/save/route.ts \
  services/dashboard/src/app/api/email-routing/\[domain\]/route.ts
git status  # verify only expected files staged, no secrets
git commit -m "feat(dashboard): dual-account Cloudflare routing for Dev1 legacy sites

Route CF API calls to Dev1 account for financenewsbase and coolnews-atl.
All other sites use Assets @ AtomicLabs. Temporary until zone transfer.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin michal-dev
```
