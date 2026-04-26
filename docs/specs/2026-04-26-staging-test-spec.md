# Test Spec — site-worker staging readiness

**Date:** 2026-04-26
**Goal:** Verify the migration's seven moving parts work, individually and together, before binding the production Worker to a real revenue domain.

## What this spec covers — and what it doesn't

**In scope:**
1. **Pure-function unit tests** — config resolver, KV key builders, asset URL rewriter, frontmatter splitter. Fast, deterministic, run on every PR.
2. **Build-stability test** — verifies the `astro build` + post-build env-config emitter produces the expected outputs with the right KV ids.
3. **Live integration tests** — HTTP smoke tests against the deployed staging Worker (cache headers, multi-tenant resolution, asset paths, Server Island endpoints).
4. **Cross-system audit script** — one-shot diagnostic that talks to both GitHub APIs and the Cloudflare API to confirm KV namespaces exist, Workers are deployed, secrets are set, and the network repo's CI workflow is green.
5. **Dashboard ↔ Worker types** — extends `DashboardSiteEntry` so the dashboard can read the new worker-related fields from `dashboard-index.yaml` and surface them in the UI.

**Explicitly out of scope** (deferred — separate sessions):
- Browser-driven dashboard E2E (dashboard runs on CloudGrid; Playwright/Chromium against it is its own infrastructure step).
- Real-traffic load testing of the Worker. KV / Workers free-tier limits are well above what staging traffic generates; production needs its own load plan.
- Tests for the legacy `packages/site-builder` and the Pages `deploy.yml` flow. They keep working as-is until Phase 8.
- Tests for the dashboard's "force rebuild" → cache-purge rewiring (in backlog; depends on Phase 8).

## Test pyramid

```
                      ┌────────────────────────────────┐
                      │  Cross-system audit (manual)   │  ← run before cutover
                      │  tests/audit-environment.ts    │
                      └────────────────────────────────┘
                  ┌────────────────────────────────────────┐
                  │  Live integration (live Worker, slow)  │  ← run before deploy or on-demand
                  │  tests/integration/staging.test.ts     │
                  └────────────────────────────────────────┘
              ┌────────────────────────────────────────────────┐
              │  Build stability (deterministic, medium)        │  ← run on PR
              │  tests/build/env-configs.test.ts                │
              └────────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────────────────┐
        │  Unit tests (pure functions, fast)                       │  ← run on every save
        │  src/lib/__tests__/*.test.ts  scripts/__tests__/*.test.ts│
        └──────────────────────────────────────────────────────────┘
```

## Per-tier specifications

### Unit tests (`pnpm --filter @atomic-platform/site-worker test`)

Vitest, in-process, no network. Runs in <2 s.

**`src/lib/__tests__/kv-schema.test.ts`**
- `siteLookupKey('coolnews.dev')` → `'site:coolnews.dev'`
- `siteConfigKey('coolnews-atl')` → `'site-config:coolnews-atl'`
- `articleKey('coolnews-atl', 'foo')` → `'article:coolnews-atl:foo'`
- `sharedPageKey('coolnews-atl', 'about')` → `'shared-page:coolnews-atl:about'`
- All key builders are pure (no side effects), idempotent, and total functions.

**`scripts/__tests__/resolve-config.test.ts`**
- `deepMerge(a, b)` with arrays-replace semantics:
  - `deepMerge({x:1}, {x:2}) === {x:2}` (scalar replacement)
  - `deepMerge({list:[1,2]}, {list:[3]}) === {list:[3]}` (array replacement, NOT concatenation)
  - `deepMerge({a:{b:1, c:2}}, {a:{c:3, d:4}}) === {a:{b:1, c:3, d:4}}` (deep merge)
  - `deepMerge(x, undefined) === x` (undefined doesn't override)
  - `deepMerge(x, null) === x` (null doesn't override)
- `splitFrontmatter` with various edge cases:
  - normal `---\n…yaml…\n---\nbody` → splits correctly
  - missing closing `---` → returns body unchanged with empty front
  - no frontmatter at all → empty front, body = entire input
  - CRLF line endings work
- `rewriteAssetUrls(html, siteId)`:
  - `<img src="/assets/foo.png">` → `<img src="/<siteId>/assets/foo.png">`
  - `<a href="/assets/x.pdf">` → href rewritten
  - `[caption](/assets/y.jpg)` (markdown-style) → rewritten
  - `<img src="https://external.com/x.png">` → unchanged
  - `<img src="/assets/foo.png?v=1">` → query string preserved
- `rewriteFrontmatterUrl(url, siteId)`:
  - `/assets/foo` → `/<siteId>/assets/foo`
  - `https://cdn.com/x` → unchanged (absolute URLs)
  - `undefined` → undefined

### Build stability (`pnpm --filter @atomic-platform/site-worker test:build`)

Vitest, runs `astro build` + emit-env-configs in a temp dir, then asserts on outputs.

**`tests/build/env-configs.test.ts`** (the single failure-mode that broke Phase 6):
- After `pnpm build`, `dist/server/wrangler.staging.json` exists, has `name === "atomic-site-worker-staging"`, contains a KV binding `CONFIG_KV` with `id === "4673c82cdd7f41d49e93d938fb1c6848"`, and has NO `legacy_env` / `definedEnvironments` / `topLevelName` keys.
- `dist/server/wrangler.production.json` exists, `name === "atomic-site-worker"`, KV `CONFIG_KV.id === "a69cb2c59507482ca5e6d114babdd098"`.
- `dist/server/entry.mjs` exists.
- `dist/client/mock-ad-fill.js` and `dist/client/placeholder.svg` exist (bundled ad-loader + image fallback).
- Typecheck passes (`astro check && tsc --noEmit`).

This is the regression net for the Astro-adapter env-binding gap that bit us in Phase 6. If the adapter ever changes its emit shape, this test fires.

### Live integration (`pnpm --filter @atomic-platform/site-worker test:live`)

Vitest, hits `https://atomic-site-worker-staging.dev1-953.workers.dev` directly. Skipped by default in CI; runs on-demand.

Each test is one HTTP request, asserts on status + headers + body content.

| Path | Status | Cache-Control | Body assertion |
|------|--------|---------------|----------------|
| `/_ping` | 200 | `no-store` | `ok` |
| `/` | 200 | `public, max-age=30, s-maxage=60, stale-while-revalidate=600` | contains `<title>` |
| `/about` | 200 | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` | contains `<h1>About</h1>` |
| `/lobsters-feel-pain-new-research-challenges-culinary-ethics` | 200 | same as `/about` | contains the article title in `<h1>` |
| `/coolnews-atl/assets/images/lobsters-feel-pain-new-research-challenges-culinary-ethics.png` | 200 | (CF default — long cache) | content-type starts with `image/` |
| `/placeholder.svg` | 200 | (CF default) | content-type `image/svg+xml` |
| `/mock-ad-fill.js` | 200 | (CF default) | content-type `text/javascript` |
| `/_server-islands/PixelLoader?...` (extracted from `/`) | 200 (GET) | `private, no-store` | non-empty body |
| `/some-slug-that-does-not-exist` | 404 | `private, no-store` (fail-closed) | `Not found` |
| `/` with `Host: not-seeded.example` (impossible without zone, so use the `--resolve` curl pattern OR a separate seeded stub hostname `nosite.local` that maps to no site) | 404 | `private, no-store` | "No site registered for hostname" |

**Multi-tenancy live test (opt-in via env flag):**
- Capture current `site:atomic-site-worker-staging.dev1-953.workers.dev` in KV.
- Write `{ siteId: "scienceworld" }`.
- Wait 60s for KV global propagation.
- Curl `/` → assert `<title>scienceworld</title>` and asset URLs prefixed with `/scienceworld/assets/`.
- Restore the original mapping.
- Test is gated behind `TEST_MULTITENANCY=1` env to avoid disrupting the demo state on every test run.

### Cross-system audit (`tsx tests/audit-environment.ts`)

Diagnostic script — run before cutover or after a suspected-broken state. Talks to:
- **Cloudflare API** — list Workers, list KV namespaces, list KV keys, validate token.
- **GitHub API** (via `gh`) — list secrets on the network repo, check workflow run status.

Outputs a checklist of expected vs actual:

```
✓ CF account 953511f6… reachable
✓ Worker `atomic-site-worker-staging` deployed; KV CONFIG_KV → 4673c82c…
✓ Worker `atomic-site-worker` deployed; KV CONFIG_KV → a69cb2c5…
✓ KV namespace 4673c82c… (CONFIG_KV_STAGING) — 38 keys
   - 1 site-config per known site
   - 1 article-index per site
   - 5 shared-page entries per site
✓ KV namespace a69cb2c5… (CONFIG_KV) — 38 keys (same shape)
✓ Latest sync-kv.yml run on `feat/sync-kv-workflow`: success
✓ Latest deploy.yml run on `staging/coolnews-atl`: success
✓ Network repo secrets: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NAMESPACE_ID_STAGING, KV_NAMESPACE_ID_PROD, PLATFORM_REPO_TOKEN
✗ Hostname site:newsite.dev — not seeded (expected when adding a new site)
```

Exit code 0 if all required checks pass; non-zero otherwise. Suitable for a manual `wrangler tail` companion or a cron health-check.

### Dashboard ↔ Worker types

`DashboardSiteEntry` adds four optional fields (compatible with the network-repo PR #15):
- `worker?: string` — Worker name (e.g. `atomic-site-worker-staging`).
- `worker_kv_staging?: string` — staging KV namespace id.
- `worker_kv_prod?: string` — prod KV namespace id.
- `worker_pending_dns?: boolean` — true while the site has no custom domain bound to the Worker.

Type-only change for now. UI surfacing is deferred to a follow-up so this PR stays focused on tests + spec.

## CI integration

Two new workflow files — both in the **platform** repo since that's where the test code lives:

**`.github/workflows/site-worker-test.yml`** (PR + push to main):
- Trigger: changes under `packages/site-worker/**`, or this workflow file.
- Jobs:
  1. Install + typecheck.
  2. Unit tests (vitest).
  3. Build stability test (vitest, runs the actual build).
- No network access; no live Worker hits. Fast feedback.

**`.github/workflows/site-worker-live.yml`** (manual + nightly):
- Trigger: `workflow_dispatch` and `schedule` cron (e.g. nightly 03:00 UTC).
- Jobs: live integration tests against the deployed staging Worker.
- Required secret: `CLOUDFLARE_API_TOKEN` for KV writes during multi-tenancy test.

## How to run locally

```bash
cd packages/site-worker

# fast — every save during dev
pnpm test                          # unit tests only

# medium — before pushing
pnpm test:build                    # unit + build stability

# slow — before deploying
pnpm test:live                     # against deployed staging Worker

# audit — one-shot diagnostic
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm test:audit

# everything
pnpm test:all
```

## What "passing" means

For a PR to be safe to merge:
- ✅ Unit tests green
- ✅ Build stability green
- ✅ Live integration green (run manually for now; nightly cron after CI is set up)
- ✅ Audit clean

For a Phase-7 cutover to proceed:
- ✅ All of the above
- ✅ The cache-strategy runbook reviewed (`docs/runbooks/phase-7-cache-strategy.md`)
- ✅ A pre-cutover audit screenshot saved in `docs/sessions/<date>-pre-phase-7.md`

## Maintenance notes

- The KV namespace IDs are duplicated in `scripts/emit-env-configs.ts`, the build-stability test, and the audit script. There's a backlog item to centralise these into `src/lib/env-config.ts`. Until then, if the IDs change, update all three.
- The hostname tested in live integration (`atomic-site-worker-staging.dev1-953.workers.dev`) is the workers.dev URL of the staging Worker. If the Worker is renamed, update both the test code and the seeded `site:<host>` KV record.
- The legacy `pages.dev` URLs are NOT tested here. Their tests live in the network repo's `deploy.yml` itself (the deploy succeeding implies the Pages project still works). Phase 8 deletes both.
