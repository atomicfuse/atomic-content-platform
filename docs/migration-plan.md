# Migration Plan — Cloudflare Pages → Astro 6 + Cloudflare Workers + KV

**Date:** 2026-04-23
**Read first:** `docs/migration-audit.md` (what exists) and `docs/migration-gap-analysis.md` (what's missing).
**Target spec:** `docs/plans/content-network-guide.md`.

## Guiding principles

1. **Run old and new side-by-side.** Both existing Pages projects (`coolnews-atl`, `scienceworld`) keep serving traffic until the new Worker is verified. No big-bang.
2. **One pilot first.** The second site only moves after the first is stable for at least one full publish cycle.
3. **Every phase is deployable and reversible.** Each phase ends in a working state. Rollback never requires restoring code from memory — it's a documented command.
4. **Measure before and after.** Phase 0 captures the baseline; each subsequent phase adds a measurement so we know whether the migration actually fixed the bottleneck.
5. **Source of truth stays on GitHub.** KV is a runtime mirror of the network repo; the dashboard keeps writing YAML; no dashboard rewrites are part of this migration.
6. **Schema translation lives in one place — the CI sync script.** Don't split/restructure YAML on the dashboard side. The writer from GitHub → KV is the only translator.
7. **Fail closed on site resolution.** If middleware can't resolve a hostname, return 404 — never fall through to a default.

---

## Pilot selection

**Pick `scienceworld`.**

Rationale:
- `scienceworld` is Staging (per `dashboard-index.yaml:40-58`), not Live. Cutover risk is zero — no user traffic, no ad revenue dependency.
- No custom domain attached yet (`custom_domain: null`) — the cutover is a DNS addition, not a replacement.
- `coolnews-atl` is Live with `coolnews.dev` traffic and ads — moving it second gives us a known-good Worker before we touch revenue.

If user prefers starting on `coolnews-atl` (e.g. to prove the migration against a real traffic pattern), the plan structure is unchanged — only the pilot/second labels swap. This is Open Q #7.

---

## Phase map

| Phase | Goal | Reversible? | Touches prod traffic? |
|-------|------|-------------|-----------------------|
| 0 | Measure baselines | Yes | No |
| 1 | Scaffold new Astro 6 + Workers app alongside existing | Yes | No |
| 2 | Port `modern` theme + one page into new app (static, no KV) | Yes | No |
| 3 | Introduce KV + middleware; runtime site resolution | Yes | No |
| 4 | Server Islands for ads & pixels | Yes | No |
| 5 | GitHub → KV sync CI (staging KV first) | Yes | No |
| 6 | DNS cutover — pilot (`scienceworld`) | Yes (DNS revert) | Yes — pilot |
| 7 | Migrate second site (`coolnews-atl`) | Yes (DNS revert) | Yes — live |
| 8 | Decommission old Pages projects | Partial — Pages project recreation is cheap | No |

Each phase below lists: **Goal · Tasks · Verification · Rollback · Complexity**.

---

## Phase 0 — Baseline measurement

**Goal.** Have numbers we can compare against after cutover. Without this, "faster" is anecdotal.

**Tasks.**
- [ ] Record full-build time for each site on a clean CI run (from workflow trigger to Pages activation). Capture from `.github/workflows/deploy.yml` run logs.
- [ ] Record deployed artefact size per site (`du -sh dist` in the build step — add a logging line; revertible change).
- [ ] Record article count per site on each staging branch (`ls sites/<site>/articles | wc -l`).
- [ ] Record "time from config merge to live" for a trivial change (e.g. flip one `ads_config.interstitial` key in `org.yaml`) — measured on both sites in aggregate.
- [ ] Capture Cloudflare Pages deployment history screenshot (for rollback reference).

**Verification.** Numbers written into a new `docs/migration-baselines.md` (simple markdown table). No code changed.

**Rollback.** N/A — measurement only.

**Complexity.** Low. Under a day.

---

## Phase 1 — Scaffold the new Astro 6 + Workers app, side-by-side

**Goal.** A new workspace package that builds and runs on `workerd` locally, responds with a hard-coded "hello" page. Nothing from the existing site-builder is touched.

**Tasks.**
- [ ] Create `packages/site-worker/` (new Turborepo package, name `@atomic-platform/site-worker`). Keep the existing `packages/site-builder/` completely untouched.
- [ ] `pnpm add astro@^6 @astrojs/cloudflare@^13 @astrojs/sitemap tailwindcss@^4 @tailwindcss/vite` (confirm latest stable at scaffold time).
- [ ] `astro.config.mjs`: `adapter: cloudflare({ mode: 'directory' })` (or `advanced` depending on v13 defaults), `output: 'server'`.
- [ ] Create `wrangler.toml` in `packages/site-worker/`:
  - `name = "atomic-site-worker-staging"`
  - `main = "./dist/_worker.js/index.js"` (or whatever the adapter emits)
  - `compatibility_date` = today
  - `[[kv_namespaces]] binding = "CONFIG_KV"` — leave placeholder IDs to be filled via `wrangler kv namespace create` in Phase 3.
  - Don't define production bindings yet.
- [ ] Add a single placeholder page `src/pages/index.astro` that renders "Atomic Site Worker — hello, {host}" using `Astro.request.headers.get('host')`.
- [ ] Add `pnpm dev` script that runs `astro dev` in workerd mode (via `--adapter` or `wrangler dev` — confirm per adapter docs at scaffold time).
- [ ] Commit to a feature branch (NOT `michal-dev`, NOT `main`).

**Verification.**
- `cd packages/site-worker && pnpm dev` serves locally on a port.
- `curl -H "Host: scienceworld.local" http://localhost:<port>/` renders the placeholder including the host value.
- `pnpm --filter @atomic-platform/site-worker build` succeeds (emits the Worker bundle into `dist/`).
- `wrangler dev` (standalone) also serves it.
- Existing `packages/site-builder` still builds (`SITE_DOMAIN=coolnews.dev pnpm --filter @atomic-platform/site-builder build` succeeds).

**Rollback.** Delete `packages/site-worker/`. Nothing else touched.

**Complexity.** Medium. The Astro 6 + adapter + workerd combination at this boundary is new — expect friction around `wrangler dev` bindings vs Astro's dev server. Allocate 1-2 days.

---

## Phase 2 — Port `modern` theme + homepage/article into the new app (still static, still filesystem)

**Goal.** The new app renders the homepage and an article page using the same `modern` theme and the same markdown article files, reading config from the filesystem exactly like the old builder does. No KV yet. This proves the stack before adding runtime indirection.

**Tasks.**
- [ ] Copy `packages/site-builder/themes/modern/` → `packages/site-worker/src/themes/modern/` (or keep shared in a common package — decide once, don't refactor twice).
- [ ] Port `BaseLayout.astro`, `ArticleLayout.astro`, `PageLayout.astro`, `src/pages/index.astro`, `src/pages/[slug]/index.astro`, `src/components/SEOHead.astro`, `src/components/InlineTracking.astro`.
  - **Do not** port `public/ad-loader.js` yet — ads are Phase 4.
  - **Do not** port `window.__ATL_CONFIG__` injection — the KV version replaces it in Phase 4.
- [ ] Wire Astro content collections to read markdown from `NETWORK_DATA_PATH/sites/<SITE_DOMAIN>/articles/` via a filesystem loader (same pattern as today's `src/content.config.ts`).
- [ ] Keep using env vars `SITE_DOMAIN` + `NETWORK_DATA_PATH` for now — same as today.
- [ ] Mark `src/pages/index.astro` and `src/pages/[slug]/index.astro` `export const prerender = false;` so they render per-request via the Worker (even though we're still reading from filesystem — the goal is to prove the request path works).
- [ ] Add a reusable `resolveConfigForSite()` that wraps the existing `scripts/resolve-config.ts` (import from `packages/site-builder`). **Don't rewrite the resolver yet.**

**Verification.**
- `SITE_DOMAIN=scienceworld NETWORK_DATA_PATH=$PWD/../../../atomic-labs-network pnpm --filter @atomic-platform/site-worker dev` renders homepage + one article page correctly with modern theme CSS.
- Visual diff vs existing staging Pages deployment (pilot site) — spot-check 5 pages; note any regressions.
- `pnpm --filter @atomic-platform/site-worker build` produces a Worker bundle.
- `wrangler dev` serves the built bundle; curl test same as §1.

**Rollback.** `packages/site-worker` still deletable. No network repo changes, no CF account changes.

**Complexity.** Medium-high. The Astro-6 content-collection + Cloudflare-Workers-SSR combination has gotchas (Node APIs not available in workerd, filesystem reads require build-time prerender or injected data). Expect some rework. Allocate 2-3 days.

> **Decision point at end of Phase 2:** does the porting confirm it's sane to share theme + layouts as a workspace package (`packages/site-theme-modern` pulled into both old and new)? Or do we accept temporary code duplication until old is removed? Default: accept duplication — avoids risky refactor during migration. Revisit only if duplication causes real bugs.

---

## Phase 3 — KV + middleware; runtime site resolution

**Goal.** The Worker no longer reads from `NETWORK_DATA_PATH` for configs. A single deployed Worker serves both hostnames by looking up `site:<hostname>` in KV.

**Tasks.**
- [ ] Create two KV namespaces via `wrangler kv namespace create`:
  - `CONFIG_KV_STAGING` (used by the Worker deployed via `wrangler dev` and the staging Worker deployment).
  - `CONFIG_KV` (production — don't bind yet; no prod Worker exists).
- [ ] Define the KV key schema v1 (document in `docs/kv-schema.md`, committed in the same PR):
  - `site:<hostname>` → `{ siteId, canonicalHostname }` (thin redirect record — keeps keys manageable if a site has multiple hostnames)
  - `site-config:<siteId>` → the resolved config object (single write per site per change — matches what the resolver produces today)
  - `article-index:<siteId>` → `Array<{ slug, publishDate, title, type }>` for homepage + category listing
  - `article:<siteId>:<slug>` → article body + frontmatter
  - `sync-status:<siteId>` → `{ gitSha, committedAt, syncedAt, ok }` (debugging + rollback)
  - Reserved: `site-config-prev:<siteId>` for rollback (Phase 5 writes this).
- [ ] Manually seed staging KV for `scienceworld` using a one-shot script (`scripts/seed-kv.ts` in `site-worker/`) that reads the network repo and writes to `CONFIG_KV_STAGING`. This is the **manual** precursor to the Phase 5 CI sync. Keep it; it stays useful for local dev.
- [ ] Write `src/middleware.ts`:
  - Extract `context.url.hostname`.
  - Lookup `site:<hostname>` in `CONFIG_KV`.
  - If null → return 404 (fail closed).
  - Otherwise put `{ siteId, canonicalHostname }` into `context.locals.site`.
- [ ] Change layouts/pages to read config from `Astro.locals.site` + KV lookups, not from the filesystem. Pages query `article-index:<siteId>` for the homepage and `article:<siteId>:<slug>` for detail pages.
- [ ] Update `wrangler.toml` with the real KV namespace IDs for staging bindings.

**Verification.**
- Manually seed KV for `scienceworld`:
  ```
  wrangler kv key put --namespace-id=<staging> "site:scienceworld.pages.dev" '{"siteId":"scienceworld",...}'
  # + site-config:scienceworld, + article-index:scienceworld, + article:scienceworld:<slug> for at least 2 articles
  ```
- Deploy the Worker to a staging URL: `wrangler deploy --env staging`.
- `curl -H "Host: scienceworld.pages.dev" https://<staging-worker-url>/` → renders homepage with scienceworld content.
- `curl -H "Host: notasite.com" https://<staging-worker-url>/` → 404 (fail-closed verification).
- Seed a second fake site (e.g. `hello-kv.local`) in KV → same worker serves different content. **This is the multi-tenant proof.**

**Rollback.** Worker deploy is a separate CF resource — `wrangler rollback` restores prior Worker version. KV state isn't touched by rollback; the seed script is idempotent.

**Complexity.** High. First time exercising KV lookups in the request path; expect to iterate on error handling, missing-key cases, and types.

---

## Phase 4 — Server Islands for ads and pixels

**Goal.** Ad placement and tracking pixels render per request via `server:defer`, not baked into the HTML shell. Config changes propagate without rebuild *and* without HTML-shell purge.

**Tasks.**
- [ ] Create `src/components/AdSlot.astro` (Server Island):
  - Props: `{ position: "header" | "inline" | "sidebar" | "sticky-bottom" | ... }`.
  - Reads `monetization` config from `Astro.locals.site` (which the middleware loaded from KV).
  - Emits the same DOM structure as today's ad-loader targets (so existing ad creative slots keep working).
  - Includes the existing dismiss-X behaviour for `sticky-bottom` using the same `sessionStorage._atl_sticky_dismissed` flag (copy logic from `packages/site-builder/public/ad-loader.js`).
- [ ] Create `src/components/PixelLoader.astro` (Server Island):
  - Reads `tracking.ga4`, `tracking.gtm`, `tracking.facebook_pixel`, `tracking.custom[]` from `Astro.locals.site`.
  - Emits GA4/GTM init snippets + pixel tags inline.
- [ ] Replace anchor-divs + `window.__ATL_CONFIG__` in layouts with `<AdSlot position="..." server:defer />` and `<PixelLoader server:defer />`.
- [ ] Retire the build-time `InlineTracking.astro` for the new app (keep in `site-builder` for now — the old app is still serving prod).
- [ ] Support per-page-type monetization: in the resolved config, the schema that goes into KV maps `ads_config.ad_placements[*].pages` → per-page-type layout objects (`layouts.article`, `layouts.category`, `layouts.homepage`). **The mapping happens in the Phase 5 CI writer**, not in the Worker.
- [ ] Add `/ad-callback` and `/pixel-fragment/<siteId>` routes if the ad-tech SDKs require same-origin script sources (verify with current ad-network docs).

**Verification.**
- Deploy staging Worker with ads island enabled.
- Change a value in `CONFIG_KV_STAGING` (e.g. `wrangler kv put site-config:scienceworld '<json with header:false>'`).
- Curl the homepage twice with a 1s gap; second response reflects the new config **without** redeploying the Worker and **without** purging HTML (Cloudflare HTML shell cache should still be fresh).
- Confirm `Cache-Status: HIT` on the shell for a subsequent page load; confirm the ad fragment returns per-request.
- Visual diff sticky-bottom dismiss behaviour: click × → `sessionStorage._atl_sticky_dismissed = '1'` → next page load hides slot (same behaviour as today).
- GA4 + GTM beacons fire correctly (use network tab or `console.log` in `analytics_debug` mode).

**Rollback.** Revert the Worker deploy (`wrangler rollback`). KV values unchanged.

**Complexity.** High. Ad-tech integrations are brittle; visual/runtime regressions are easy to miss without manual check against the current live site.

---

## Phase 5 — GitHub → KV sync CI (staging KV first)

**Goal.** A merge to the network repo propagates to KV automatically; no manual `wrangler kv` for day-to-day ops.

**Tasks.**
- [ ] New workflow `atomic-labs-network/.github/workflows/sync-kv.yml` (separate from existing `deploy.yml` — the two live side-by-side during migration).
- [ ] Triggers: same path filters as `deploy.yml` (`sites/**`, `org.yaml`, `groups/**`, `overrides/**`, `network.yaml`, `monetization/**`).
- [ ] Reuses the `detect` job logic from `deploy.yml` — identical affected-site list. Factor shared bash into a reusable action or bash lib.
- [ ] Per affected site:
  - Checkout network data + platform code (same as current `deploy.yml`).
  - Run `scripts/resolve-config.ts` for `<site>` against the current working tree to produce the resolved config JSON.
  - Run a new `packages/site-worker/scripts/yaml-to-kv.ts` that:
    - Reads the resolved config.
    - Maps YAML schema → KV key schema (incl. per-page-type monetization split, see §Phase 4).
    - Reads article markdown + frontmatter, emits `article:<siteId>:<slug>` values.
    - Computes the `article-index:<siteId>`.
    - Writes `site-config-prev:<siteId>` = current `site-config:<siteId>` value (for rollback).
    - Writes new values via `wrangler kv bulk put --namespace-id=...` (single bulk op per site; atomicity per-site, not global).
    - Writes `sync-status:<siteId>` = `{ gitSha, committedAt, syncedAt, ok: true }`.
  - On any failure: writes `sync-status:<siteId>.ok = false` with error message, exits non-zero (workflow shows red).
- [ ] **HTML-shell purge classification.** For each changed file, determine whether the change affects the HTML shell (template switch, new page type, new legal page) or only server-island data (ads, pixels, article text, article ordering):
  - Shell changes → after KV write, call `https://api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache { hosts: ['<hostname>'] }`.
  - Island-only changes → no purge.
- [ ] Run against `CONFIG_KV_STAGING` only for the first week. Production KV wiring is part of Phase 6.
- [ ] Manual rollback runbook in `docs/runbooks/rollback-kv.md`:
  - `wrangler kv bulk get` for current → `wrangler kv bulk put` with prev values from `site-config-prev:` keys.
  - Or: revert the offending network repo commit → the sync re-runs automatically.

**Verification.**
- Push a trivial `sites/scienceworld/site.yaml` change on a dev branch → CI syncs to staging KV within ~30s.
- Inspect `sync-status:scienceworld` via `wrangler kv key get` — `ok: true`, gitSha matches.
- Revert the commit → CI re-runs; new `sync-status` sha matches the revert.
- Inject a deliberate failure (bad YAML) → CI exits red; `sync-status:scienceworld.ok = false`; previous KV values intact.

**Rollback.** Disable the workflow (rename file or gate with `if: false`) — doesn't affect running Worker because Worker reads KV, not CI output.

**Complexity.** High. The yaml→KV mapper is net-new code with real correctness requirements (must not silently drop fields). Write unit tests first (TDD per Atomic Labs dev standards).

---

## Phase 6 — DNS cutover (pilot: `scienceworld`)

**Goal.** `scienceworld`'s hostname resolves to the new Worker. Old Pages project stays up as fallback.

**Prereq:** Phases 1-5 green. `CONFIG_KV_STAGING` has full `scienceworld` data. Production KV (`CONFIG_KV`) seeded by running the Phase 5 workflow with `env: production`.

**Tasks.**
- [ ] Create production Worker: `wrangler deploy --env production` — binds to `CONFIG_KV`.
- [ ] Set up a pre-cutover hostname (e.g. `scienceworld-worker.yournetwork.dev`) pointing to the new Worker. Seed `site:scienceworld-worker.yournetwork.dev` in `CONFIG_KV` pointing to `scienceworld` siteId. Verify against that hostname for 24h.
- [ ] **DNS switch:** Change the CNAME / CF route for `<scienceworld's actual hostname>` to the new Worker. Be explicit: in Cloudflare, this is a Worker **route** pattern (`<hostname>/*` → Worker). Old Pages project stays attached to its `.pages.dev` subdomain, so it's still reachable for comparison.
- [ ] Update `dashboard-index.yaml` for `scienceworld` to add `worker: atomic-site-worker` (new field, non-breaking — dashboard readers ignore unknown fields).
- [ ] Monitor for 48h: 5xx rate, p95 latency, KV read errors, ad impressions (if any traffic exists).

**Verification.**
- Curl `<scienceworld hostname>` → served by Worker (check `cf-worker` header).
- Edit `ads_config` in network repo → CI syncs → visible in next request without rebuild.
- Compare article rendering visually against old Pages `.pages.dev` URL — identical.

**Rollback.** Revert the Worker route in Cloudflare — hostname resolves to the old Pages project again. Time-to-rollback: ~30 seconds (DNS propagation inside CF is fast).

**Complexity.** Medium. DNS is low-code but high-consequence; mitigated by pilot being a Staging site with no users.

---

## Phase 7 — Migrate second site (`coolnews-atl`, Live with custom domain)

**Goal.** `coolnews.dev` resolves to the new Worker.

**Tasks.**
- [ ] Same as Phase 6 but for `coolnews-atl`.
- [ ] Seed `CONFIG_KV` with `site:coolnews.dev` + `site:coolnews-atl.pages.dev` (both hostnames should route to `coolnews-atl` siteId).
- [ ] Off-peak cutover window (overnight EST — pick based on `GA4` traffic patterns).
- [ ] Communicate the window to anyone watching ad revenue dashboards.

**Verification.**
- Curl `coolnews.dev` → Worker-served. Header checks, visual diff, dismiss-X behaviour, ads rendering parity.
- First 60 minutes: monitor ad impression rate vs previous 24h baseline (expect ±10% is noise; larger delta → investigate or rollback).
- First 48 hours: revenue parity check via ad-network dashboards.

**Rollback.** Same as Phase 6.

**Complexity.** Medium. Same shape as Phase 6, higher stakes because live traffic + ads.

---

## Phase 8 — Decommission old Pages projects

**Goal.** Remove the two Pages projects and retire the old `packages/site-builder`.

**Prereq:** Both sites served by Worker for ≥ 2 weeks with stable revenue.

**Tasks.**
- [ ] Disable the `atomic-labs-network/.github/workflows/deploy.yml` workflow (rename or delete).
- [ ] Delete Cloudflare Pages projects `coolnews-atl` and `scienceworld` via `wrangler pages project delete` (or dashboard).
- [ ] Remove `packages/site-builder/` from the platform monorepo.
- [ ] Update platform `CLAUDE.md`:
  - "Layout — Platform Repo" — remove `site-builder/`, add `site-worker/`.
  - "Tech Stack" — change "Astro 6 (static)" to "Astro 6 + `@astrojs/cloudflare` (SSR on Workers)".
  - "Common Commands" — remove per-site build invocation; document `wrangler dev` for local Worker.
  - "Known Landmines" — remove stale items (e.g. `.build-trigger`) and add the new ones (KV eventual consistency, fail-closed middleware, purge classification).
- [ ] Archive `atomic-labs-network/.github/workflows/deploy.yml` history in the repo (leave the file with a big `# DEPRECATED — see sync-kv.yml` header for one release cycle, then delete).
- [ ] Clean up `dashboard-index.yaml` fields that are no longer used (`pages_project`, `pages_subdomain` if no longer referenced).

**Verification.**
- `pnpm typecheck` across the monorepo.
- Redeploy Worker and verify both sites still serve.
- No CI references `deploy.yml` or the `site-builder` package.

**Rollback.** The entire Pages setup is recreatable from Git history — if catastrophic failure in Week 3, `git revert` the deletion commit and re-run `deploy.yml`. Pages projects would need manual recreation in the dashboard (names + bindings), but the code + CI come back with the revert.

**Complexity.** Low-medium. Mostly deletion — but do it behind a dedicated PR with careful review.

---

## Cross-phase: observability

Add these before Phase 6:
- Log KV read errors + missing keys (Worker logs, visible via `wrangler tail`).
- Log middleware resolution time per request.
- Worker Analytics Engine (or equivalent) for p50/p95 latency per hostname.
- Synthetic health check every 5 minutes per hostname (any Cloudflare-external monitor works — Pingdom, uptimerobot, or a GitHub-actions cron that curls).

---

# Phase 4 — Open Questions (from user ground rules)

Before implementation starts, these need user decisions or data. Numbered for reference.

## Q1. Build-time baseline numbers

**Need:** Full build time per site on CI + total artefact size + "config-change to live" for a trivial org-level flip.

**Why it matters:** Phase 0 needs this to prove migration success. The audit could not extract this from the codebase — these are runtime measurements only available via `deploy.yml` logs and Cloudflare Pages dashboard.

**How to answer:** Run one `workflow_dispatch` of `deploy.yml` with `force_all: true` and copy the timing from the logs. Also note current article count per site on the staging branches.

## Q2. Where should article content live post-migration?

The target-architecture guide (`docs/plans/content-network-guide.md`) says "Content flows into your content source (D1, Sanity, Contentful, markdown, etc.)" without deciding. This blocks Phase 3 and Phase 5 details.

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **A. Markdown-in-repo → synced to KV** (article: KV keys) | Matches current authoring model; dashboard + content-pipeline unchanged; full history in Git | KV value size limit 25 MB — fine for individual articles; listing growth = bigger `article-index:` keys (split if needed) |
| **B. Markdown-in-repo → synced to R2** (articles as objects, served via Worker) | R2 is cheaper for bulk content; no KV size worry | More moving parts; bypasses KV's edge-local speed |
| **C. Articles in D1** (SQLite on Cloudflare) | Queryable (tags, categories, search); no per-site key explosion | Migrates away from "markdown in Git" authoring — rewires content-pipeline commit path; big scope creep |
| **D. Keep articles in the old per-site Pages build, only migrate configs to Workers** | Smallest change; preserves pagefind | Doesn't actually solve the rebuild bottleneck for article edits, only config edits |

**Recommendation:** **Option A for Phase 1** (pilot + first site). If article count in any site crosses ~5000, revisit and consider R2 (Option B) or D1 (Option C). Option D defeats the purpose.

**Need from user:** confirm Option A for now, or propose a different one.

## Q3. Pages project configuration — is anything custom?

There's no `wrangler.toml` for the existing Pages projects. Any non-default build settings (env vars, headers, redirects, functions) live in the Cloudflare dashboard only.

**Need:** run `wrangler pages project get coolnews-atl` and `wrangler pages project get scienceworld` (or inspect the dashboard) and share any env vars / redirects / `_headers` / `_redirects` files that are set. Without this, the cutover might miss a configuration detail.

**What could be there:** custom headers (security / CORS), redirects (old URL schemes), Pages Functions (unlikely given the static build, but possible), env vars for the build.

## Q4. Cloudflare account access + cost

- Who owns the Cloudflare account (which email / which Worker Paid plan)?
- Is the plan Workers Paid ($5/mo/account baseline — required for Cron Triggers, higher request quotas, KV writes above free tier)? The migration needs Workers Paid for any non-trivial KV write volume.
- Worker requests at current traffic: cheap (~1M/mo free). KV reads: 100K/day free, beyond that $0.50 per million. Worth confirming.

## Q5. Staging / preview story

Today, each Pages project has its own `staging/<domain>` branch producing a `staging-<site>.<project>.pages.dev` preview. Under Workers:

- **Option i:** One staging Worker (`atomic-site-worker-staging`) bound to `CONFIG_KV_STAGING`. All staging branches' content is served here, distinguished by hostname. **Simpler, recommended.**
- **Option ii:** Per-site preview Workers. More closely mirrors today but multiplies ops.

**Need from user:** confirm Option i.

## Q6. SEO / analytics continuity

- **Canonical URLs** — `BaseLayout.astro` today emits `canonicalUrl` via `SEOHead`. Under Workers, canonical is still derived from `Astro.locals.site.canonicalHostname`. Confirm redirect strategy for any pre-existing canonicals using the `.pages.dev` hostnames — should they 301 to the custom domain? (Today they wouldn't — separate Pages project.)
- **Sitemap** — `@astrojs/sitemap` runs at build today. Under Workers with on-demand rendering, sitemap becomes a Worker route (`/sitemap.xml`) reading from `article-index:<siteId>`. Design for it in Phase 3.
- **GA4 + GTM continuity** — pixels move from build-time inline to Server Island. Functionally identical, but the code path changes. Verify in Phase 4 that measurement IDs are unchanged so historical data stays continuous.

**Need from user:** any ranking / SEO constraints we should protect (top-traffic URLs, external backlinks to preserve)? If yes, document them before Phase 7 (Live cutover).

## Q7. Pilot site choice

Plan assumes `scienceworld` pilot, `coolnews-atl` second. User can swap if there's a preference — no structural change.

## Q8. Dashboard "force rebuild" button

Today, the dashboard has (or will have) a "force rebuild" affordance that touches `sites/<site>/.build-trigger`. Under Workers, the equivalent is a **cache purge** for the site's hostname, not a rebuild. Dashboard UX needs a pointer change:

- Rename the button (e.g. "Purge edge cache").
- Rewire the action to POST to `api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache`.

Deferred to a follow-up session — not part of the migration itself, but must be done before users notice the button lying.

## Q9. Locked-in monetization SDKs

`public/ad-loader.js` talks to specific ad networks (Taboola/adsense-like identifiers implied by group names `taboola.yaml`, `adsense-default.yaml`). Server Island must either:
- Emit the same inline snippets the ad networks require, OR
- Some ad SDKs require `<script src="...network-sdk.js">` on first-paint — putting that inside a `server:defer` island means it's not in the critical HTML. Verify each network's SDK placement requirements.

**Need from user:** confirm the ad networks in use. If any require pre-DOM-ready SDK loading, consider hybrid — leave SDK loader in `BaseLayout` (same place as today), only put per-slot rendering inside the Server Island.

---

## Total effort estimate

Ordering, not absolute schedule:

- **Phases 0-1:** week 1 (quick)
- **Phase 2:** week 2 (Astro 6 + Workers friction dominates)
- **Phase 3-4:** weeks 3-4 (real engineering; test KV + Server Islands)
- **Phase 5:** week 5 (CI sync — TDD it)
- **Phase 6 (pilot cutover):** week 6 (short window, long soak)
- **Phase 7 (second site):** week 7-8 (soak + monitor)
- **Phase 8 (decom):** week 9+

Estimate assumes the open questions above are answered upfront and no blocker surfaces during Phase 2's Astro-6-on-Workers experiment. If that phase reveals deep incompatibility (e.g. a content-collection feature that doesn't work in SSR), the plan is revisable without losing earlier phases.

---

## What this plan explicitly does NOT do

- Rewrite the dashboard.
- Rewrite the content-pipeline.
- Change the network repo authoring model (YAML + markdown in Git).
- Introduce a CMS.
- Redesign the 5-layer config inheritance.
- Consolidate the two repos.
- Build a second theme (template router is scaffolded for future, not built out).
- Migrate search away from Pagefind (deferred — see gap analysis #19).

Each of these is a separate, valuable follow-up. None of them is required to fix the rebuild bottleneck.

---

## Resolved open questions (2026-04-23)

User answered all 9 open questions above on 2026-04-23. Answers frozen here so the plan stays readable without cross-referencing chat.

| Q | Answer | Plan impact |
|---|--------|-------------|
| Q1 baselines | `coolnews-atl` deploy = **52 s**; `scienceworld` not yet measured | Captured in `docs/migration-baselines.md`; Phase 0 partially complete |
| Q2 article storage | **Option A — markdown-in-repo synced to KV** | Phase 3 + Phase 5 proceed with `article:<siteId>:<slug>` + `article-index:<siteId>` key schema |
| Q3 Pages custom settings | **None** (confirmed via `wrangler pages download config`) | Phase 6/7 cutover simplified — no custom headers / redirects / env vars to mirror |
| Q4 CF account | Dev/test on `dev1@atomiclabs.io` (account id `953511f6356ff606d84ac89bba3eff50`), Workers Paid. Production migration on a different account later. | Phase 1-7 execute on Dev1 account; Phase 8 adds a parallel cutover procedure for the prod-account rollout |
| Q5 staging | **Option i** — single `atomic-site-worker-staging` Worker bound to `CONFIG_KV_STAGING`, hostnames distinguish sites | Phase 3 creates exactly one staging Worker; Phase 5's CI writes to one staging namespace |
| Q6 SEO continuity | No constraints; pick best defaults | Canonical: custom domain when available, else `.pages.dev`; sitemap route at `/sitemap.xml`; GA4/GTM IDs preserved via KV `pixels.*` fields |
| Q7 pilot | `scienceworld` first, `coolnews-atl` second — confirmed | No plan change |
| Q8 force-rebuild button | Rewire to cache purge (confirmed) | Added as a follow-up backlog item; not part of migration scope but dashboard team will own it |
| Q9 ad SDK placement | **Full Server Islands** — mock ads only today; revisit when real networks integrate | Phase 4 implements clean Server Islands; `docs/future-decisions.md` documents the re-open trigger |

### Additional decision — theme sharing (raised by user alongside answers)

> "the porting confirm it's sane to share theme + layouts as a workspace package (`packages/site-theme-modern` pulled into both old and new)"

**Accepted.** Phase 2 extracts `themes/modern/` + shared layouts into `packages/site-theme-modern`, with the extraction itself sequenced to minimise risk to the live build (see `docs/audit-logs/2026-04-23-1630-migration-phase-0-and-1-scaffold.md` Decision 1). Fallback plan: if Astro 5 vs 6 component surfaces prove incompatible, revert to duplication — logged in `docs/future-decisions.md`.

---

## Decision log (populated during execution)

Record actual decisions per phase (when they diverge from the plan) as new headings, following the dev-audit-trail decision-entry template.

### 2026-04-23 — Phase 0 + Phase 1 session (audit log: `audit-logs/2026-04-23-1630-migration-phase-0-and-1-scaffold.md`)

- **Theme extraction deferred to Phase 2.** Phase 1 scaffolds with a single placeholder page; theme extraction is its own reviewable step to protect the live `site-builder` build path.
- **Phase 1 placeholder renders hostname from request headers** (not a hard-coded string) — costs nothing, validates workerd request-header access on day 1.
- **Phase 1 `wrangler.toml` omits KV bindings** — added in Phase 3 when real namespaces exist.
- **Branch not pushed this session** — system default policy; user can push when ready to review.
