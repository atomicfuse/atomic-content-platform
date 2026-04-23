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
