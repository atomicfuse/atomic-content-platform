# Ops Console 2 — Site Checks API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose a per-site `checks` block — Uptime · SSL · Domain-expiry (from the existing Domains Dashboard API) plus Sync (KV `sync-status`) and Tracking (config-presence) built in-house — served by content-pipeline (sync/tracking) and merged by the dashboard.

**Architecture:** No new prober, cron, or Mongo collection. The dashboard `/api/site-checks` fetches the **Domains Dashboard API** (`https://domains-dashboard-53a6.atomic.cloudgrid.io`, no auth) for uptime/SSL/domain and proxies content-pipeline `GET /site-checks` for the two ATL-specific checks. content-pipeline reads `sync-status:<id>` and `site-config:<id>` from CONFIG_KV via the Cloudflare KV REST API (new credentials added), with dual-account routing.

**Tech Stack:** TypeScript (strict), Cloudflare KV REST (mirroring dashboard `cloudflare.ts` `getKVEntry`), Vitest. Builds on Plan 1 (`lib/mongo.ts` not needed here; reuses the `/site-stats` route + dashboard proxy conventions).

**Spec:** `docs/superpowers/specs/2026-06-07-site-checks-api-design.md`
**Depends on:** Plan 1 (route + proxy conventions). The Alerts plan (Plan 4) depends on the `kv.ts` + `sync`/`tracking` readers built here.

---

## Pre-flight notes
- Branch `michal-dev`. Failure-isolate each check: one source failing returns `unknown`/`n/a`, never blanks the others.
- **Domains Dashboard API doc:** `/Users/michal/domains-dashboard/services/web/docs/API.md`. Fields used: `latestSnapshot.health.{statusCode,responseTimeMs,checkedAt}`, `latestSnapshot.ssl.{status,expiresAt,daysLeft}`, `latestSnapshot.renewal.{expiresAt,daysLeft,autoRenew}`, `overallStatus` (`healthy|warning|critical|not_live|unknown`). Endpoints `GET /api/domains` (bulk) and `GET /api/domains/:domain` (single), no auth.
- **content-pipeline has no `CLOUDFLARE_API_TOKEN` today** (only `CLOUDFLARE_ACCOUNT_ID` in `r2-upload.ts`). Task 1 adds the KV-read credentials.
- **Dual-account:** prod on Assets account; `financenewsbase` + `coolnews.dev` on Dev1. The dashboard's `isDev1Domain`/`getKvNamespaces`/`getCredentials` live in `dashboard/src/lib/{constants,cloudflare}.ts`. **content-pipeline does NOT depend on `@atomic-platform/shared-types`** (it inlines shared types for its standalone `tsc` CloudGrid build — see `src/types.ts` header). So we **inline** a content-pipeline-local copy of the dual-account constants + helpers (mirroring how the repo already handles cross-service type sharing). Do NOT add a shared-types import to content-pipeline.
- **`block.state`** convention: every checks block carries `state: "ok" | "n/a" | "unknown"` (distinct from `ssl.status`'s upstream enum). Absent/degraded handled explicitly.

## File structure
```
services/content-pipeline/
  src/lib/cloudflare-accounts.ts      (create: content-pipeline-local DEV1 site set + KV namespace/account ids + isDev1Domain/getKvNamespaces/getAccountId — mirrors dashboard constants)
  src/lib/kv.ts                       (create: getKVEntry REST read + per-domain credentials)
  src/checks/sync.ts                  (create: readSyncStatus)
  src/checks/tracking.ts              (create: readTracking presence)
  src/checks/repo.ts                  (create: getAtlChecks(domain) + all-sites)
  src/checks/__tests__/*.test.ts
  src/agents/content-generation/index.ts   (modify: GET /site-checks[/:domain])
cloudgrid.yaml                        (modify: add CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CONFIG_KV ids to content-pipeline)
services/dashboard/
  src/lib/domains-dashboard.ts        (create: Domains Dashboard API client + mapper)
  src/app/api/site-checks/route.ts          (create: merge external + proxied ATL checks, all sites)
  src/app/api/site-checks/[domain]/route.ts (create: single site)
  src/lib/__tests__/domains-dashboard.test.ts
```

---

## Task 1: content-pipeline dual-account constants + KV reader

**Files:**
- Create: `services/content-pipeline/src/lib/cloudflare-accounts.ts`
- Create: `services/content-pipeline/src/lib/kv.ts`
- Test: `services/content-pipeline/src/checks/__tests__/kv.test.ts`

- [ ] **Step 1: Create a content-pipeline-local dual-account module** (do NOT touch shared-types; content-pipeline inlines its own copies). Copy the constant *values* from `services/dashboard/src/lib/constants.ts` + `cloudflare.ts` into `services/content-pipeline/src/lib/cloudflare-accounts.ts`: the Dev1 site-id set (`financenewsbase`, `muvizzcom`), Assets account id `4a8cfd85d617b38ce1813a552132bc86`, Dev1 account id `953511f6356ff606d84ac89bba3eff50`, CONFIG_KV prod `b258e47065274b8b8af1a0b6d6529c1d` / staging `f6c35e1fa8c841b8b193509a3a237f7f`, Dev1 KV ids. Export `isDev1Domain(domain)`, `getKvNamespaces(domain): {staging,prod}`, and a **new** `getAccountId(domain)` that returns the Dev1 account id for Dev1 domains else Assets. (Note: the dashboard's existing `getAccountId()` is zero-arg/Assets-only — we are *creating* a domain-aware one here, not reusing it. `credentialsFor` mirrors the dashboard's `getCredentials(domain)` token+account selection.)

- [ ] **Step 2: Write failing test** for `getKVEntry` parsing (mock `fetch`): returns parsed JSON on 200, `null` on 404, throws on other non-OK.
```typescript
import { describe, it, expect, vi } from "vitest";
import { getKVEntry } from "../../lib/kv.js";

it("returns null on 404", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false } as Response));
  expect(await getKVEntry("ns", "sync-status:x", { accountId: "a", token: "t" })).toBeNull();
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `kv.ts`** (mirror dashboard `cloudflare.ts:getKVEntry` + a `credentialsFor(domain)` that reads `CLOUDFLARE_API_TOKEN` + `getAccountId(domain)` from the local module; Dev1 uses `DEV1_CLOUDFLARE_API_TOKEN` if set):
```typescript
import { getAccountId, isDev1Domain } from "./cloudflare-accounts.js";

export interface KvCreds { accountId: string; token: string; }

export function credentialsFor(domain: string): KvCreds {
  const token = isDev1Domain(domain)
    ? (process.env.DEV1_CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? "")
    : (process.env.CLOUDFLARE_API_TOKEN ?? "");
  return { accountId: getAccountId(domain), token };
}

export async function getKVEntry(namespaceId: string, key: string, creds: KvCreds): Promise<unknown | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${creds.token}` }, signal: AbortSignal.timeout(5_000) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV read ${key}: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
```

- [ ] **Step 5: Run → PASS. Step 6: `cd services/content-pipeline && pnpm typecheck`. Commit**
```bash
git add services/content-pipeline/src/lib/cloudflare-accounts.ts services/content-pipeline/src/lib/kv.ts services/content-pipeline/src/checks/__tests__/kv.test.ts
git commit -m "feat(content-pipeline): local dual-account helpers + KV reader"
```

---

## Task 2: Sync check (`readSyncStatus`)

**Files:** Create `services/content-pipeline/src/checks/sync.ts`; Test `.../__tests__/sync.test.ts`.

- [ ] **Step 1: Failing test** — given a mocked `getKVEntry` returning `{ ok:false, syncedAt, gitSha, error:"x" }`, `readSyncStatus("d")` returns `{ state:"ok", ok:false, syncedAt, gitSha, error:"x" }`; on KV `null` returns `{ state:"unknown", ok:null }`; on throw returns `{ state:"unknown", error }`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:** resolve prod namespace via `getKvNamespaces(domain).prod`, read `sync-status:${domain}`, map to the block. `SyncStatus` shape = `{ gitSha, committedAt, syncedAt, ok, error? }` (from `kv-schema.ts`). Wrap in try/catch → `unknown` block on error (never throw).

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/checks/sync.ts services/content-pipeline/src/checks/__tests__/sync.test.ts
git commit -m "feat(content-pipeline): sync check from KV sync-status"
```

---

## Task 3: Tracking check (`readTracking`)

**Files:** Create `services/content-pipeline/src/checks/tracking.ts`; Test.

- [ ] **Step 1: Failing test** — given mocked resolved config `{ tracking: { ga4:"G-1", gtm:"", facebook_pixel:"123" } }`, `readTracking("d")` → `{ state:"ok", ga4:true, gtm:false, pixel:true }`; missing `tracking` → all false; KV error → `{ state:"unknown" }`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:** read `site-config:${domain}` from prod KV, presence-check `tracking.ga4`, `tracking.gtm`, `tracking.facebook_pixel` (non-empty string ⇒ true). Failure-isolated. (Resolved config is the merged org→group→override→site result — correct for presence.)

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/checks/tracking.ts services/content-pipeline/src/checks/__tests__/tracking.test.ts
git commit -m "feat(content-pipeline): tracking presence check from resolved config"
```

---

## Task 4: ATL checks repo + `GET /site-checks[/:domain]` route

**Files:** Create `services/content-pipeline/src/checks/repo.ts`; Modify `index.ts`.

- [ ] **Step 1: Failing test** for `getAtlChecks(domain)` → `{ siteDomain, sync, tracking }` (composes Tasks 2–3); `getAllAtlChecks(octokit, repo)` iterates `listActiveSites(octokit, repo)` (from `lib/site-brief.js` — **requires `(octokit, repo)` args**, see `scheduled-publisher/index.ts:355`) with bounded concurrency, each site independently isolated.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `repo.ts`.** `getAllAtlChecks(config)` builds its **own** Octokit internally via `createOctokit(config.github)` + uses `config.networkRepo` (there is no `octokit` in scope at the route call site — each handler in `index.ts` makes its own, e.g. index.ts:503). Then add routes in `handleRequest`. Parse the pathname (the existing `/scheduled-publish` route uses `new URL(...)` — do the same so a query string doesn't break the exact match):
```typescript
const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
if (req.method === "GET" && pathname === "/site-checks") { sendJson(res, 200, { status:"ok", sites: await getAllAtlChecks(config) }); return; }
if (req.method === "GET" && pathname.startsWith("/site-checks/")) {
  const d = decodeURIComponent(pathname.slice("/site-checks/".length));
  sendJson(res, 200, { status:"ok", site: await getAtlChecks(d) }); return;
}
```
> Apply the same `new URL(...).pathname` parsing to the Plan 1 `/site-stats` routes if not already done.

- [ ] **Step 4: typecheck + test → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/checks/repo.ts services/content-pipeline/src/agents/content-generation/index.ts services/content-pipeline/src/checks/__tests__/repo.test.ts
git commit -m "feat(content-pipeline): GET /site-checks (sync+tracking)"
```

---

## Task 5: Domains Dashboard client (dashboard side)

**Files:** Create `services/dashboard/src/lib/domains-dashboard.ts`; Test `.../__tests__/domains-dashboard.test.ts`.

- [ ] **Step 1: Failing test** — given a fixture `latestSnapshot` (per the API doc), `mapSnapshotToChecks(snapshot)` → `{ uptime:{state:"ok",ok:true,statusCode:200,responseTimeMs,overallStatus:"healthy",checkedAt}, ssl:{state:"ok",status:"active",daysLeft,expiresAt}, domain:{state:"ok",daysLeft,expiresAt,autoRenew} }`. Test `not_live` → `uptime.ok=false, overallStatus:"not_live"`; `latestSnapshot:null` → all three `{state:"unknown"}`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `fetchAllDomains()` (`GET /api/domains`, indexed by `domain`), `fetchDomain(domain)` (`GET /api/domains/:domain`), and the pure `mapSnapshotToChecks`. Base URL from env `DOMAINS_DASHBOARD_URL ?? "https://domains-dashboard-53a6.atomic.cloudgrid.io"`. Short timeout (5s); on fetch error/404 return `unknown` blocks.

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/dashboard/src/lib/domains-dashboard.ts services/dashboard/src/lib/__tests__/domains-dashboard.test.ts
git commit -m "feat(dashboard): Domains Dashboard API client + snapshot mapper"
```

---

## Task 6: Dashboard `/api/site-checks` merge route

**Files:** Create `services/dashboard/src/app/api/site-checks/route.ts` + `[domain]/route.ts`.

- [ ] **Step 1: Implement the all-sites route:**
  - `fetchAllDomains()` **once**, index by domain (no N calls).
  - proxy content-pipeline `GET /site-checks` (via `getAgentUrl()` fallback) for `{sync, tracking}` per site.
  - list all sites from `dashboard-index.yaml`; for each: merge `uptime/ssl/domain` from the Domains Dashboard (or `{state:"n/a"}` for staging-only sites with no `custom_domain`) with `sync/tracking` from the proxy.
  - Response: `{ sites: [{ siteDomain, checks: { uptime, ssl, domain, sync, tracking } }] }`.
  - Failure isolation: if the Domains Dashboard fetch fails entirely, the three external blocks are `{state:"unknown"}` but sync/tracking still resolve.
- `[domain]/route.ts`: single-site via `fetchDomain(domain)` + proxy `GET /site-checks/:domain`.
- Follow the same `/api/*` auth treatment as `/api/site-stats` (Plan 1 Task 11).

- [ ] **Step 2: typecheck + (light) test the merge mapping with stubbed fetches. Step 3: Commit**
```bash
git add services/dashboard/src/app/api/site-checks
git commit -m "feat(dashboard): /api/site-checks merges Domains Dashboard + ATL checks"
```

---

## Task 7: CloudGrid credentials for content-pipeline KV reads

**Files:** Modify `cloudgrid.yaml`.

- [ ] **Step 1:** Under the `content-pipeline` service, document the new secrets and add `DOMAINS_DASHBOARD_URL` env (for the dashboard service). content-pipeline needs (via `cloudgrid secrets set`): `CLOUDFLARE_API_TOKEN` (Workers KV Storage:**Read**), `CLOUDFLARE_ACCOUNT_ID` (already used by r2-upload), and `DEV1_CLOUDFLARE_API_TOKEN` **if** the token isn't valid on the Dev1 account — otherwise `financenewsbase`/`muvizzcom` sync+tracking return `unknown`. The CONFIG_KV namespace ids are local constants (no env needed). Add a comment listing these. The dashboard already has the token.

- [ ] **Step 2:** `cd services/content-pipeline && pnpm typecheck && pnpm test` and `cd services/dashboard && pnpm typecheck && pnpm test` → PASS. **Commit**
```bash
git add cloudgrid.yaml
git commit -m "chore: content-pipeline CF KV read creds + DOMAINS_DASHBOARD_URL"
```

---

## Final verification
- [ ] content-pipeline + dashboard typecheck & tests green.
- [ ] Manual smoke (optional): `curl http://localhost:5000/site-checks` returns sync/tracking per site; `curl http://localhost:3001/api/site-checks` returns merged blocks; a known-good domain shows `uptime.state="ok"`, staging-only site shows `uptime.state="n/a"`.
- [ ] Confirm scoped commits; no secrets staged.

## Notes
- This subsystem persists nothing — it's read-through. Add a short cache (5–15 min) on the dashboard route only if call volume warrants it (optional; not required for correctness).
- Plan 4 (Alerts) reuses `checks/sync.ts`, `checks/tracking.ts`, and `lib/kv.ts` — keep their signatures stable.
