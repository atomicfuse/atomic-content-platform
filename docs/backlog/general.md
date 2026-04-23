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
- [ ] **Build config:** Verify the adapter-auto-bound `SESSION` KV binding doesn't conflict with our Phase-3 `CONFIG_KV` binding name. Adapter's `SESSION` is for Astro Sessions feature (unused). Safe to leave inert, but document it so the next engineer doesn't think it was accidentally added.
- [ ] **Phase 2 prereq:** Extract `packages/site-builder/themes/modern/` + shared layouts into `packages/site-theme-modern` as a new workspace package. Sequence per `docs/audit-logs/2026-04-23-1630-*.md` Decision 1 — new package first, site-builder re-imports second (verify legacy build still green), site-worker imports third.
