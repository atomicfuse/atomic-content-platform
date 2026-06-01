# Custom Domain Routing — Design Spec

**Date:** 2026-04-28
**Branch:** `feat/custom-domain-worker`
**Status:** Approved

## Problem

The dashboard's "Attach Domain" panel shows "No available domains" despite Cloudflare zones existing in the account. Two root causes:

1. **Silent error swallowing** — `getAvailableZones()` failures (API errors, missing env vars) are caught and return `[]` with no feedback.
2. **Over-aggressive filtering** — `getAvailableZones()` filters out zones matching any site's `domain` field. Since `syncDomainsFromCloudflare()` creates placeholder entries for every zone, all zones get excluded.

Beyond the bug, attaching a domain today only writes to `dashboard-index.yaml` and shows a "redeploy required" banner. The operator must manually run `pnpm deploy:production` to register the route on Cloudflare, and wait for CI `sync-kv.yml` to seed the KV hostname entry. This is error-prone and slow.

## Solution

Make `attachCustomDomain` / `detachCustomDomain` fully automated: dashboard writes to dashboard-index, registers/deregisters the Workers Custom Domain via Cloudflare API, and seeds/deletes the KV hostname entry — all in one action. No manual redeploy.

## Architecture

### Approach: Dashboard calls Cloudflare APIs directly

The dashboard already holds `CLOUDFLARE_API_TOKEN` and calls `listZones()`, email routing APIs, etc. Extending `cloudflare.ts` with Workers Custom Domains and KV APIs is a natural fit. The flow stays synchronous — the user gets immediate feedback.

Alternatives considered:
- **GitHub Actions dispatch** — async, 30-60s+ delay, harder error surfacing. Rejected.
- **Hybrid (dashboard seeds KV, CI registers route)** — split responsibility, domain isn't live until deploy. Rejected.

## Detailed Design

### 1. Bug Fix: `getAvailableZones()` filtering

**Current (broken):**
```typescript
const usedAsSite = new Set(index.sites.map((s) => s.domain));
const usedCustomDomains = new Set(
  index.sites.map((s) => s.custom_domain).filter(Boolean),
);
return zones.filter((z) => !usedAsSite.has(z.name) && !usedCustomDomains.has(z.name));
```

**Fixed:**
```typescript
const usedCustomDomains = new Set(
  index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
);
return zones.filter((z) => !usedCustomDomains.has(z.name));
```

Drop the `usedAsSite` filter entirely. The `attachCustomDomain()` dupe-merge logic already handles zones that match an existing site domain.

**Trade-off acknowledged:** This means a zone whose name coincidentally matches a site's internal identifier (e.g., zone `coolnews-atl.com` with site `domain: coolnews-atl`) would appear as available. In practice, site identifiers (e.g., `coolnews-atl`) are not valid domain names and never match zone names (e.g., `coolnews.dev`). The dupe-merge code in `attachCustomDomain` remains as a safety net for any edge case where they do overlap.

### 2. Bug Fix: Error visibility in `AttachDomainPanel`

Add `error` state. When `getAvailableZones()` rejects, display the error message in the UI instead of silently showing an empty dropdown.

```
Before: .catch(() => setZones([]))
After:  .catch((err) => setError(err instanceof Error ? err.message : "Failed to load domains"))
```

### 3. New Cloudflare API functions (`cloudflare.ts`)

#### Workers Custom Domains

```typescript
registerWorkerCustomDomain(hostname: string, zoneId: string): Promise<{ id: string }>
```
- `PUT /accounts/{account_id}/workers/domains`
- Body: `{ zone_id: zoneId, hostname, service: WORKER_NAME_PROD, environment: "production" }`
- Cloudflare auto-manages the DNS A/AAAA record.

```typescript
deregisterWorkerCustomDomain(hostname: string): Promise<void>
```
- `GET /accounts/{account_id}/workers/domains?hostname={hostname}&service={WORKER_NAME_PROD}` — use the `hostname` query parameter for server-side filtering (avoids client-side pagination).
- If no match returned, treat as no-op (domain already removed).
- If match found, `DELETE /accounts/{account_id}/workers/domains/{domain_id}`.

```typescript
listWorkerCustomDomains(): Promise<WorkerCustomDomain[]>
```
- `GET /accounts/{account_id}/workers/domains?service={WORKER_NAME_PROD}`
- Handles pagination (same pattern as `listZones` — loop while results === page size).
- Returns all registered custom domains for the production worker. Used by Settings > Domains page for drift detection (nice-to-have).

#### KV Direct Write

```typescript
putKVEntry(namespaceId: string, key: string, value: string): Promise<void>
```
- `PUT /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}`
- Body is the raw value string.

```typescript
deleteKVEntry(namespaceId: string, key: string): Promise<void>
```
- `DELETE /accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}`

### 4. Centralized constants

New or appended to `src/lib/constants.ts`:

```typescript
export const WORKER_NAME_PROD = "atomic-site-worker";
export const KV_NAMESPACE_PROD = "a69cb2c59507482ca5e6d114babdd098";
export const KV_NAMESPACE_STAGING = "4673c82cdd7f41d49e93d938fb1c6848";
```

These values are already in `wrangler.toml` and `emit-env-configs.ts`. Centralizing avoids magic strings.

### 5. Updated `attachCustomDomain(domain, customDomain, zoneId)`

Signature changes: adds `zoneId` parameter (the dropdown already has it).

**Key data mapping:** The `domain` parameter is the dashboard-index `domain` field (the site identifier / network-repo folder name, e.g., `coolnews-atl`). The `customDomain` parameter is the Cloudflare zone hostname (e.g., `coolnews.dev`). The KV entry maps `site:<customDomain>` → `{ siteId: domain }` — matching exactly what `seed-kv.ts` writes.

**Dupe-merge logic retained:** The existing code that finds a dashboard-index entry with `domain === customDomain`, absorbs its `zone_id`, and deletes the duplicate entry — this stays. With the `usedAsSite` filter removed from `getAvailableZones()`, zones that match synced placeholder entries can now be selected, making this merge path reachable.

**Zone status pre-check:** Before registering, verify the zone is `active` (not `pending`). If pending, return a clear error: "Domain DNS is not yet delegated to Cloudflare. Complete DNS setup first." This avoids an opaque CF API error.

**Orchestration:**

```
Step 1: Write custom_domain + zone_id to dashboard-index.yaml, set status → "Live"
        Set worker_pending_dns → false
Step 2: Register custom domain on CF worker via API
Step 3: Seed KV entry: site:<customDomain> → JSON.stringify({ siteId: domain }) in prod KV namespace
Step 4: Best-effort email routing setup (existing, unchanged)
Return: { success: true }
```

**Rollback on failure:**
- Step 1 fails → abort, surface error.
- Step 2 fails → roll back step 1 (clear custom_domain from index, revert status), surface CF error.
- Step 3 fails → log warning, do NOT roll back. KV will be seeded on next sync-kv CI run. Surface warning to user.

**Redeploy hint removed.** Return type changes from `{ redeployRequired: true }` to `{ success: true }`.

### 6. Updated `detachCustomDomain(domain)`

**Orchestration:**

```
Step 1: Read current custom_domain + zone_id from dashboard-index
Step 2: Clear custom_domain in dashboard-index.yaml, set status → "Ready", worker_pending_dns → true
Step 3: Deregister custom domain from CF worker via API
Step 4: Delete KV entry: site:<customDomain> from prod KV namespace
Return: { success: true }
```

**Critical ordering:** The dashboard-index write (Step 2) happens BEFORE CF/KV cleanup (Steps 3-4). This ensures that if Steps 3-4 fail, the index is already correct (no custom domain). The orphaned CF route and KV entry are harmless and self-healing: `emit-env-configs` on the next build will not register a domain absent from the index; stale KV entries point to valid config and become unreachable once the CF route is removed.

**Error handling:**
- Step 2 fails → abort, surface error. Nothing was changed yet.
- Step 3 fails (not found on CF) → warn, continue. Domain may already be gone.
- Step 4 fails → warn, continue. Stale KV entry is harmless (points to valid config, unreachable without route).

### 7. UI changes (`AttachDomainPanel.tsx`)

1. **Error state** — red banner when `getAvailableZones()` fails, showing actual error.
2. **Pass `zoneId`** — dropdown selection passes both domain and zoneId to `attachCustomDomain`.
3. **Remove redeploy banner** — delete `REDEPLOY_CMD` constant and the entire yellow hint section.
4. **Toast messages** — "Domain connected — live in ~60 seconds" (CF DNS propagation + KV eventual consistency).

### 8. Environment setup

**`cloudgrid.yaml`** — add to dashboard secrets comment:
```yaml
# Secrets: ..., CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
```

**CloudGrid production** — must be set:
```bash
cloudgrid secrets set atomic-content-platform CLOUDFLARE_API_TOKEN=<token>
cloudgrid secrets set atomic-content-platform CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50
```

**API token scopes required:**
- Zone: Zone: Read
- Zone: DNS: Edit (existing — email routing)
- Account: Workers Scripts: Edit (new — custom domain registration)
- Account: Workers KV Storage: Edit (new — direct KV writes)

## Staging vs Production

This feature is **production-only** by design. Rationale:

- **Staging worker** (`atomic-site-worker-staging`) has `routes = []` — it runs on `*.workers.dev` only (Landmine #20). Custom domain registration targets the production worker name and environment.
- **Staging KV** is not seeded by the dashboard. The staging hostname lookup uses `?_atl_site=` override (preview flow), never hostname-based resolution. Writing to staging KV is unnecessary.
- **`KV_NAMESPACE_STAGING`** is included in constants for potential future use (e.g., a "preview on custom domain" feature) but is not used by attach/detach.

## What is NOT changing

- **`emit-env-configs.ts` / `load-routes.ts`** — build-time route registration stays as safety net. Registering an already-registered domain is idempotent on CF.
- **`seed-kv.ts` / `sync-kv.yml`** — CI still seeds KV on commits. Dashboard writes the same entry at attach-time; CI overwrites with same value (harmless).
- **`middleware.ts`** — hostname → KV lookup already works, no changes.
- **`preview-override.ts`** — staging preview flow unaffected.
- **`syncDomainsFromCloudflare()`** — still creates placeholder entries for new zones. The filter fix makes this benign (placeholders no longer block zone selection).

## Files touched

| File | Change |
|------|--------|
| `services/dashboard/src/lib/cloudflare.ts` | Add 5 API functions (register/deregister custom domain, list custom domains, put/delete KV entry) |
| `services/dashboard/src/actions/wizard.ts` | Rewrite `attachCustomDomain` (add zoneId param, orchestrate CF + KV), rewrite `detachCustomDomain` (orchestrate CF + KV), fix `getAvailableZones` filter |
| `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx` | Add error state, pass zoneId, remove redeploy banner, update toasts |
| `services/dashboard/src/lib/constants.ts` | Add `WORKER_NAME_PROD`, `KV_NAMESPACE_PROD`, `KV_NAMESPACE_STAGING` |
| `cloudgrid.yaml` | Document `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` in secrets comment |
| `CLAUDE.md` | Update Key Environment Variables table — `CLOUDFLARE_API_TOKEN` is no longer "CI only", now also used by dashboard |

## Testing

- **Manual:** Attach a domain via the UI → verify it appears on `https://dash.cloudflare.com` Workers > Custom Domains, and `site:<hostname>` exists in prod KV.
- **Detach:** Disconnect → verify route removed from CF, KV entry deleted.
- **Error cases:** Invalid token → error shown in UI. Zone with pending status → CF API may reject, error surfaced.
- **Idempotency:** Attach same domain twice → second call is a no-op on CF side.
