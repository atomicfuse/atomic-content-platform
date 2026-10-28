# Plan — Site Config tab save gaps

Spec: `docs/superpowers/specs/2026-10-28-site-config-tab-save-gaps.md`

### Task 1: Pure helpers
Files:
- Create: `services/dashboard/src/lib/site-config-updates.ts`
- Create test: `services/dashboard/src/lib/__tests__/site-config-updates.test.ts`

- [ ] Write failing tests for `collectChangedSections()` and `applyAdsTxtAndLegal()`
- [ ] Run — confirm they fail
- [ ] Implement
- [ ] Run — confirm they pass

### Task 2: Save route writes ads_txt + legal
Files:
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`

- [ ] Call `applyAdsTxtAndLegal(existing, configUpdates)` beside the `scripts`/`ads_config` blocks; add the two fields to the body type
- [ ] Covered by Task 1 tests (logic lives in the helper); typecheck

### Task 3: Config tab sends them
Files:
- Modify: `services/dashboard/src/components/site-detail/SiteConfigTab.tsx`

- [ ] Replace the four hand-written comparisons with `collectChangedSections()`; snapshot `ads_txt`/`legal` on load and after a successful save

### Task 4: Hide Theme in site mode
Files:
- Modify: `services/dashboard/src/components/config/UnifiedConfigForm.tsx`
- Create test: `services/dashboard/src/components/config/__tests__/UnifiedConfigForm.site-sections.test.tsx`

- [ ] Failing test: site mode has no "Theme" header; group mode does; site mode shows "ads.txt" and "Legal"
- [ ] Implement `mode !== "site"` guard
- [ ] Test passes

### Task 5: QA
- [ ] `pnpm typecheck` (dashboard)
- [ ] Full dashboard suite → `docs/test-results/2026-10-28-site-config-tab-save-gaps.txt`, with the before/after count
- [ ] Hand over for Asaf's local test. No commit until he approves.

### Task 6 (approved): rebuild modal — stop the false "failed", drop duplicate work
Facts (checked in `sync-kv.yml`, 2026-10-28):
- A `main` push writes **production** KV only. Changes under `org.yaml`, `groups/` and `overrides/config/` re-sync every published site. `RebuildConfirmModal` is used only after org, group and override saves, so production is always already covered.
- **Staging** KV is refreshed only by pushes to `staging/<domain>`. The modal's per-site staging pushes are needed. The problem is that they all run in one request: 71 sites took about 3 minutes, past the ~60 s gateway limit (landmine #38), so the browser saw "failed" while the server finished anyway.

Files:
- Create: `services/dashboard/src/lib/rebuild-batches.ts` — `syncInBatches(domains, batchSize, send, onProgress)`: sequential batches, sums ok/failed, keeps going after a failed batch.
- Create test: `services/dashboard/src/lib/__tests__/rebuild-batches.test.ts`
- Modify: `services/dashboard/src/components/shared/RebuildConfirmModal.tsx`

- [ ] Failing tests: batch splitting (71 → 15 batches of ≤5), progress callback, totals, a failed batch counted and the run continues
- [ ] Implement helper; tests pass
- [ ] Modal: staging sync via `syncInBatches` (5 sites per request) with "Syncing staging… 25/71" on the button. Remove the production stage and checkbox; replace them with "Live sites update automatically from this commit". Final toast reports any failures honestly.
