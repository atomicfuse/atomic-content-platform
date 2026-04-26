# General Backlog

## Sticky Ad Dismiss — Follow-ups

- [ ] Dismiss analytics dashboard — `atl:sticky-dismissed` event is emitted; surface dismissal rate in the dashboard
- [ ] Animation on dismiss — fade/slide instead of instant `display: none`
- [ ] Frequency capping — "show again tomorrow" after N dismissals
- [ ] Fix pre-existing esbuild error in `InlineTracking.astro` ("Unterminated string literal" during Vite dependency scanning)

## Niche Targeting — Follow-ups (Phase 2+)

- [ ] Bundle lifecycle hooks — deactivate bundle when site is deactivated (`PUT /api/bundles/:id { active: false }`), hard-delete on site delete (`DELETE /api/bundles/:id?hard=true`), rename bundle when site is renamed (`PUT /api/bundles/:id { name: newName }`)
- [ ] Edit niche targeting on existing sites — add Niche/Bundle tab to site detail page (`/sites/[domain]`) for editing vertical, categories, tags, and viewing/updating the associated bundle
- [ ] Migration script — create bundles for existing sites that have `vertical_id` but no `bundle_id` (iterate `dashboard-index.yaml`, call `POST /api/bundles` for each)
- [ ] Content agent integration (Phase 3) — update content agent to fetch by `bundle_id` instead of `vertical_id`: `GET /api/content?bundle_id=X&enriched=true&status=active`
- [ ] Ad-tech IAB metadata pipeline (Phase 4) — surface `iab_vertical_code` and `iab_category_codes` from site.yaml into ads.txt generation, sellers.json, Google Publisher Tags (GPT) ad units, Prebid.js category targeting, and Amazon TAM
- [ ] Vertical change confirmation dialog — when operator changes vertical in niche targeting and categories are already selected, show confirmation before clearing (deferred from D4 decision)

## Astro 6 + Cloudflare Workers Migration — Follow-ups

Planning deliverables: `docs/migration-audit.md`, `docs/migration-gap-analysis.md`, `docs/migration-plan.md`. Session: `docs/sessions/2026-04-23-migration-audit.md`. Audit: `docs/audit-logs/2026-04-23-1530-migration-astro-workers-audit.md`.

- [x] ~~**Tech debt:** Upgrade `packages/site-builder` Astro `^5.7.0` → `6.x`~~ **Superseded 2026-04-23:** plan now creates a new `packages/site-worker` on Astro 6 instead of upgrading the legacy builder in place. Legacy builder stays on 5.7 until retired in Phase 8.
- [x] ~~**Tech debt:** Fix `CLAUDE.md:264` drift — Tech Stack section says "Astro 6"; actual pin is 5.7~~ **Fixed 2026-04-23** (`9d96832` + this commit): Tech Stack section now describes both site-builder (5.7, legacy) and site-worker (6.1, migration target).
- [ ] **Missing tests:** No integration tests yet for per-site Worker output — add smoke tests once the pilot (`scienceworld`) is serving via Worker (Phase 3+)
- [ ] **Missing error handling:** Phase 5 CI sync script needs idempotency proof + rollback runbook (`docs/runbooks/rollback-kv.md`) before it runs against production KV
- [x] ~~**Documentation:** `docs/plans/content-network-guide.md` is currently untracked in git~~ **Fixed 2026-04-23** in prev commit — committed alongside the three migration-planning docs.
- [ ] **Performance:** Capture full Phase 0 baselines — coolnews-atl=52s captured; pending: scienceworld deploy time, `du -sh dist` per site, and "config-change-to-live" latency for a trivial org.yaml flip. Required before Phase 6 cutover to prove migration success
- [ ] **Edge case:** `InlineTracking.astro` esbuild "Unterminated string literal" warning during Vite dep-scan (already open from sticky-ad session) — reconfirm it's safe to port into `packages/site-worker` in Phase 2
- [ ] **Edge case:** Design a KV-era replacement for the `.build-trigger` file-touch force-rebuild mechanism. Under Workers the equivalent is a cache purge call. Rewire the dashboard "force rebuild" button (if exposed) accordingly
- [x] ~~**Open question (user):** Decide article storage post-migration~~ **Answered 2026-04-23:** Option A — markdown-in-repo synced to KV.
- [x] ~~**Open question (user):** Share `wrangler pages project get` output~~ **Answered 2026-04-23:** ran `wrangler pages download config` in session — both projects have no custom settings.
- [x] ~~**Open question (user):** Confirm Cloudflare account owner + plan~~ **Answered 2026-04-23:** dev testing on `dev1@atomiclabs.io` (Workers Paid), production migration to a different account later.
- [x] ~~**Open question (user):** Confirm ad networks in use and their SDK placement requirements~~ **Answered 2026-04-23:** ad-loader.js is mock-only today → full Server Islands approach, revisit trigger captured in `docs/future-decisions.md`.

### Phase-1 scaffold follow-ups (added 2026-04-23)

- [ ] **Tooling:** Upgrade `wrangler` CLI 4.77.0 → 4.84.1 (removes the compat-date fallback warning on `wrangler dev`; not blocking).
- [ ] **Build config:** Set `site:` in `packages/site-worker/astro.config.mjs` when a canonical URL per site is known — resolves the "Sitemap integration requires `site`" warning at build. Likely done in Phase 3 alongside middleware.
- [x] ~~**Build config:** Verify the adapter-auto-bound `SESSION` KV binding doesn't conflict with our Phase-3 `CONFIG_KV` binding name.~~ **Resolved 2026-04-23:** different binding names, no conflict; SESSION stays auto-provisioned and inert.
- [x] ~~**Phase 2 prereq:** Extract `packages/site-builder/themes/modern/` + shared layouts into `packages/site-theme-modern` as a new workspace package.~~ **Superseded 2026-04-23 Decision 1:** duplicated into site-worker instead (Astro 5.7/6.1 compat risk). Post-Phase-8 dedup is the new plan — see backlog item below.

### Phase-2/3/4 follow-ups (added 2026-04-23)

- [ ] **Tech debt (Phase 2):** Post-Phase-8, deduplicate `themes/modern/` + layouts between site-builder (removed by then) and site-worker. Trivial once only one package remains.
- [ ] **Missing tests:** Integration tests for the Worker request path — smoke-level curls against `wrangler dev --remote` + seed fixtures. Covers: middleware fail-closed 404, KV read → render, Server Island response content, purge classification.
- [ ] **Tech debt:** Remove `@cloudflare/workers-types` from `packages/site-worker/package.json` devDependencies — `wrangler types` superseded it; dropped from tsconfig types[], but still installed. Saves a dep.
- [ ] **Config fidelity (Phase 3):** Today's `scripts/seed-kv.ts` only does 2-layer merge (org + site). For Phase 6/7 cutover, the full 5-layer resolver (org → groups → overrides/config → site, with per-field merge modes) needs to run at sync time. Either (a) adapt site-builder's `scripts/resolve-config.ts` to run in the seed path, or (b) build a `@atomic-platform/kv-sync` package that holds the single source of the resolver consumed by both seed-kv.ts and sync-kv.yml.
- [ ] **Visual QA (Phase 4):** Populate `ad_placements` in `org.yaml` / `groups/*.yaml` so AdSlot emits real mock ad markup. Today placements is `[]` → islands render but produce no slot content. Good for proving the pipeline, not for visual QA.
- [ ] **Observability:** Wire Worker Analytics Engine (or basic structured logging) for the staging Worker so p95 latency + KV read counts are visible before Phase 6.
- [ ] **Search:** `pagefind` isn't ported to site-worker — deferred until it's needed (see `docs/future-decisions.md`).
- [ ] **Shared legal pages:** `/about`, `/privacy`, `/terms`, etc. aren't ported to site-worker. Add routes that read the corresponding content from KV (seeded from `shared-pages/` + `overrides/<site_id>/`).

### Phase-5 follow-ups (added 2026-04-23)

- [ ] **Operator action required:** Merge `atomic-labs-network/feat/sync-kv-workflow` to main + set the 5 required secrets (see commit `2429148` message) before the workflow will actually run.
- [ ] **Phase 6 prereq:** Verify first CI run writes `sync-status:<siteId>.ok = true` in staging KV. Document the first successful run's sha in `docs/migration-baselines.md`.
- [ ] **Edge case:** `sync-kv.yml`'s `pages_subdomain.pages.dev` fallback relies on dashboard-index.yaml having that field. Test with a site that has `pages_subdomain: null` to confirm the workflow doesn't crash on missing hostname.

### Production hot-fix follow-ups (added 2026-04-26)

- [ ] **Bug:** `packages/site-worker/scripts/seed-kv.ts` writes `gitSha: "manual-seed"` literally; should read `process.env.GITHUB_SHA` (only fall back to "manual-seed" when unset). Sync-status records currently lie about which commit produced them.
- [ ] **Pre-existing data bug:** `sites/muvizz.com/articles/best-sci-fi-movies-2026.md` fails Astro content-collection schema validation on every `deploy.yml` run. Either fix the frontmatter or delete the directory (it has no Pages project per `dashboard-index.yaml` so it's already orphaned).
- [ ] **CI inefficiency:** `deploy.yml` `detect` job iterates every `sites/*` dir even on a `staging/<X>` push that should only target site `<X>`. This causes muvizz.com to be matrix-built on every run, producing a false-failure verdict. Filter by branch name (or by changed paths) to scope correctly.
- [ ] **Tech debt:** `deploy.yml` installs `wrangler@^4` globally in every job. Faster: cache the install or build a small CI image. Not urgent — install is ~5 s.
- [ ] **Documentation:** the wrangler resolution gotcha (pnpm per-package bin layout breaks implicit `npx wrangler` from a sibling workspace package) is captured in `deploy.yml`'s comment at the install step. Consider promoting to `CLAUDE.md` "Known Landmines" if any other workflow ever needs to invoke a CLI installed in a different workspace package.

### Phase-6/7/8 follow-ups (added 2026-04-23)

- [ ] **Runbook execution:** Execute `docs/runbooks/phase-6-dns-cutover-pilot.md` (scienceworld, low-risk).
- [ ] **Runbook execution:** Execute `docs/runbooks/phase-7-dns-cutover-coolnews-atl.md` (coolnews.dev, live + revenue monitoring).
- [ ] **Runbook execution:** Execute `docs/runbooks/phase-8-decommission.md` after ≥ 14 days stable on Worker.
- [ ] **Dashboard UX:** "Force rebuild" button — today writes to `.build-trigger`. After Phase 8, rewire to call `https://api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache`. Capture the zone IDs from dashboard-index.yaml. (Moved from earlier backlog; operator confirmed.)
