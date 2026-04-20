# Audit Log: Dismissable Sticky Ad Close Button

**Session type:** Feature implementation
**Date:** 2026-04-20
**Branch:** `michal-dev`
**Spec:** `docs/specs/2026-04-20-sticky-ad-close-button-spec.md`
**Triggered by:** Spec — allow visitors to dismiss sticky-bottom ad via accessible X button with session-scoped persistence

---

## Pre-flight Checks

- [x] `pnpm typecheck` — PASS (0 errors, 5/5 tasks, FULL TURBO)
- [ ] `npm run lint` — N/A (no lint script)

## Changes

### 1. `packages/shared-types/src/ads.ts`
- Added `dismissible?: boolean` to `AdPlacement` interface
- tsc: PASS

### 2. `packages/site-builder/public/ad-loader.js`
- Replaced sticky-bottom branch with sessionStorage gate + X button injection
- sessionStorage key: `_atl_sticky_dismissed`
- Close button: `<button type="button" class="ad-close-btn" aria-label="Close advertisement">×</button>`
- Dispatches `atl:sticky-dismissed` custom event on dismiss
- tsc: N/A (vanilla JS)

### 3. Astro layouts (ArticleLayout, PageLayout, ArticlePreviewLayout)
- Added `.ad-close-btn` CSS (32×32 hit target, absolute top-right, rounded, z-index 101)
- Added `.ad-close-btn:focus-visible` outline for keyboard accessibility
- tsc: PASS

### 4. `services/dashboard/src/components/settings/AdsConfigForm.tsx`
- Added `dismissible?: boolean` to local `AdPlacement` interface
- Added conditional checkbox "Allow visitors to dismiss this ad (×)" — only renders when `position === 'sticky-bottom'`
- Default checked when `placement.dismissible` is undefined
- tsc: PASS

### 5. `services/dashboard/src/components/shared/PlacementPreview.tsx`
- Added mock × glyph at top-right of sticky-bottom preview box when `dismissible !== false`
- Made container `relative` to support absolute positioning of the glyph
- tsc: PASS

### 6. `packages/site-builder/scripts/resolve-config.ts` (bug fix from code review)
- `normaliseAdPlacements` was returning `{ id, position, sizes, device }` — dropping `dismissible`
- Fixed to pass through `dismissible` when present in the raw YAML
- Without this fix, `dismissible: false` in site config would be silently ignored at build time
- tsc: PASS

### 7. `services/dashboard/src/components/settings/AdsConfigForm.tsx` — inline preview alignment
- Replaced generic `PreviewSlot` for sticky-bottom with explicit rendering that shows × glyph
- Aligns inline preview (in form) with shared `PlacementPreview.tsx` behavior
- tsc: PASS

### 8. Test suite: `packages/site-builder/scripts/__tests__/dismissible-sticky-ad.test.ts`
- 15 tests covering config resolution (T1–T5) and ad-loader runtime (T6–T15)
- Installed `jsdom` + `@types/jsdom` as devDeps for JSDOM-based runtime tests
- Created fixture files: `dismissible-group.yaml`, `sticky-no-dismissible-group.yaml`, 2 site dirs
- Regression verification: reverted resolve-config fix → 3 tests fail (T1, T2, T5); restored → all pass

## Post-change Verification

- [x] `pnpm typecheck` — PASS (5/5 tasks, 0 errors, exit code 0)
- [x] Dev server functional test — site-builder started on :4321 with `coolnews-atl`
  - Article page renders `data-slot="sticky-bottom"` anchor ✓
  - `ad-loader.js` contains close button injection code (`ad-close-btn`: 1 match) ✓
  - CSS for `.ad-close-btn` present in rendered page (2 matches: rule + focus-visible) ✓
  - `__ATL_CONFIG__` contains sticky-bottom placement ✓
  - Pre-existing esbuild error in `InlineTracking.astro` unrelated to these changes ✓
- [x] `pnpm test` — PASS (101 tests, 6 files, 0 failures)
  - 15 new dismissible tests (T1–T15) all pass ✓
  - 86 pre-existing tests unaffected ✓
  - Regression verified: reverting resolve-config fix → T1, T2, T5 fail correctly ✓
