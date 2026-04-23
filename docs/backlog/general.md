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

- [ ] **Tech debt:** Upgrade `packages/site-builder` Astro `^5.7.0` → `6.x` (blocks Phase 1 of migration plan)
- [ ] **Tech debt:** Fix `CLAUDE.md:264` drift — Tech Stack section says "Astro 6"; actual pin is 5.7. Update to match reality or leave pending the upgrade
- [ ] **Missing tests:** No integration tests yet for per-site Worker output — add smoke tests once the pilot (`scienceworld`) is serving via Worker
- [ ] **Missing error handling:** Phase 5 CI sync script needs idempotency proof + rollback runbook (`docs/runbooks/rollback-kv.md`) before it runs against production KV
- [ ] **Documentation:** `docs/plans/content-network-guide.md` is currently untracked in git — commit it alongside the three migration-planning docs so the target-architecture reference is versioned
- [ ] **Performance:** Capture Phase 0 baselines — per-site CI build time, artefact size (`du -sh dist`), and "config-change-to-live" latency for a trivial org.yaml flip. Required before Phase 6 cutover to prove migration success
- [ ] **Edge case:** `InlineTracking.astro` esbuild "Unterminated string literal" warning during Vite dep-scan (already open from sticky-ad session) — reconfirm it's safe to port into `packages/site-worker` in Phase 2
- [ ] **Edge case:** Design a KV-era replacement for the `.build-trigger` file-touch force-rebuild mechanism. Under Workers the equivalent is a cache purge call. Rewire the dashboard "force rebuild" button (if exposed) accordingly
- [ ] **Open question (user):** Decide article storage post-migration — markdown-in-repo synced to KV (recommended), vs R2, vs D1, vs leave in old build. Blocks Phase 3/5 detail
- [ ] **Open question (user):** Share `wrangler pages project get` output for `coolnews-atl` and `scienceworld` — any custom headers, redirects, env vars, or Pages Functions in the dashboard that must carry over
- [ ] **Open question (user):** Confirm Cloudflare account owner + plan (Workers Paid required for cron triggers + meaningful KV write volume)
- [ ] **Open question (user):** Confirm ad networks in use and their SDK placement requirements (some must load pre-DOM-ready; conflicts with full-Server-Island approach)
