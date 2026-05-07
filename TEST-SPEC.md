# Test Specification — Atomic Content Platform

**Date:** 2026-05-07
**Branch:** michal-v2
**Total:** 380 tests | 15 test files | 0 failures

---

## Summary

| Package | Test Files | Tests | Status |
|---------|-----------|-------|--------|
| site-worker | 9 | 213 | ALL PASS |
| dashboard | 6 | 167 | ALL PASS |
| **Total** | **15** | **380** | **ALL PASS** |

---

## Bug Fixes Verified

### Bug #1 — Wizard Bundle Creation (committed: d6daaac)

**Problem:** `createBundle()` in `wizard.ts` only accepted HTTP 201, silently returning `null` on HTTP 200. Additionally, `createSiteAndBuildStaging()` silently continued without a bundle when creation failed.

**Root Cause:** `if (res.status === 201)` instead of `if (res.ok)`.

**Fix:**
1. Changed status check to `if (res.ok)` to accept both 200 and 201.
2. Added `throw new Error(...)` when bundle creation returns null.

**File:** `services/dashboard/src/actions/wizard.ts`

### Bug #2 — Google Analytics Tag / PixelLoader (uncommitted)

**Problem:** PixelLoader.astro loaded gtag.js multiple times when both GA4 and Google Ads tags were present, violating Google's official spec. KV also had stale data from the wrong branch.

**Root Cause:** Separate `<script>` blocks for GA4 and Google Ads each loaded gtag.js independently.

**Fix:**
1. Collect all gtag-based IDs into a single array; load gtag.js ONCE with the primary ID.
2. Single `gtag('config', ...)` call per property ID.
3. Re-seeded KV from the correct `staging/financerooms` branch.

**File:** `packages/site-worker/src/components/PixelLoader.astro`

---

## Dashboard Tests (167 tests, 6 files)

### File: `src/actions/__tests__/wizard-bundle.test.ts` (11 tests)

Suite: **Wizard -- Bundle Creation (bug fix verification)**

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Bundle creation succeeds with HTTP 201 -- bundleId is set | `stagingUrl` + `siteFolder` returned; POST to `/api/bundles` with category_ids containing verticalId + child IDs | PASS |
| 2 | Bundle creation succeeds with HTTP 200 -- was broken before fix | Same as #1; verifies the 200 status code path (THE BUG) | PASS |
| 3 | 409 duplicate name triggers retry with ' (2)' suffix | Two fetch calls; second payload has `name: "Test Site (2)"` | PASS |
| 4 | Aggregator returns 500 -- error is thrown (not swallowed) | Throws `"Failed to create content bundle"`; no GitHub ops attempted | PASS |
| 5 | Aggregator returns 400 -- error is thrown with message | Throws `"Failed to create content bundle"` | PASS |
| 6 | Network error during bundle creation -- error is thrown | fetch rejects with ECONNREFUSED; throws `"Failed to create content bundle"` | PASS |
| 7 | 409 on both original and retry -- error is thrown | Both attempts return 409; throws `"Failed to create content bundle"` | PASS |
| 8 | Existing bundleId set -- no POST, only GET to fetch rules | GET to `/api/bundles/existing-bundle-1`; no POST | PASS |
| 9 | No verticalId -- bundle creation skipped, site still created | `mockFetch` not called; `stagingUrl` still returned | PASS |
| 10 | verticalId set but no categories -- bundle creation skipped | `mockFetch` not called; `stagingUrl` still returned | PASS |
| 11 | POST payload has correct structure (name, rules, active) | Payload matches `{ name, description, active: true, rules: { category_ids: [verticalId, ...childIds], tag_ids } }` | PASS |

### File: `src/components/settings/__tests__/ad-loader.test.ts` (29 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | T29 -- fluid width container | sets width:100% and minHeight+maxHeight when width=0 | PASS |
| 2 | T29 -- fluid width container | sets width:100% for fluid-width mobile sizes | PASS |
| 3 | T30 -- fixed size containers | sets min+max width and min+max height for standard sizes | PASS |
| 4 | T30 -- fixed size containers | uses default 300x250 when no sizes provided | PASS |
| 5 | T30 -- fixed size containers | prefers desktop sizes on desktop viewport | PASS |
| 6 | T30 -- fixed size containers | falls back to mobile when desktop is empty | PASS |
| 7 | T42 -- Mixed fixed + fluid | fixed placement has min+max width/height | PASS |
| 8 | T42 -- Mixed fixed + fluid | fluid placement has width:100% and min+max height | PASS |
| 9 | fluid height (Wx0) | sets min+max width but no height constraints when height=0 | PASS |
| 10 | edge: [0,0] entry | uses width:100% and no height constraints for [0,0] | PASS |
| 11 | E09 -- Fluid on sidebar | fluid width fills container (width:100%) with height constraint | PASS |
| 12 | overflow constraint | always sets overflow:hidden on fixed slots | PASS |
| 13 | overflow constraint | always sets overflow:hidden on fluid slots | PASS |
| 14 | overflow constraint | always sets overflow:hidden with default sizes | PASS |
| 15 | device targeting -- viewport skip | skips desktop-only placement on mobile viewport | PASS |
| 16 | device targeting -- viewport skip | renders desktop-only placement on desktop viewport | PASS |
| 17 | device targeting -- viewport skip | skips mobile-only placement on desktop viewport | PASS |
| 18 | device targeting -- viewport skip | renders mobile-only placement on mobile viewport | PASS |
| 19 | device targeting -- viewport skip | renders 'all' device placement on desktop viewport | PASS |
| 20 | device targeting -- viewport skip | renders 'all' device placement on mobile viewport | PASS |
| 21 | device targeting -- viewport skip | sticky-bottom mobile-anchor: skipped on desktop | PASS |
| 22 | device targeting -- viewport skip | sidebar-sticky: skipped on mobile | PASS |
| 23 | viewport-aware size selection | uses mobile sizes on mobile viewport | PASS |
| 24 | viewport-aware size selection | uses desktop sizes on desktop viewport | PASS |
| 25 | viewport-aware size selection | falls back to desktop on mobile when no mobile sizes | PASS |
| 26 | viewport-aware size selection | falls back to mobile on desktop when no desktop sizes | PASS |
| 27 | viewport-aware size selection | falls back to desktop on mobile when mobile is empty array | PASS |
| 28 | viewport-aware size selection > sticky-bottom bug | desktop viewport: fluid x 120 with maxHeight constraint | PASS |
| 29 | viewport-aware size selection > sticky-bottom bug | mobile viewport: 300x250 with size constraints | PASS |

### File: `src/components/settings/__tests__/ad-size-config.test.ts` (36 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | createDefaultSizeConfig | returns 16:9 ratio, null ranges, empty customSizes | PASS |
| 2 | sizeTuplesToConfig | converts number[][] to AdSizeConfig with default ratio and empty range | PASS |
| 3 | sizeTuplesToConfig | returns default config for undefined input | PASS |
| 4 | sizeTuplesToConfig | returns default config for empty array | PASS |
| 5 | configToSizeTuples | converts customSizes to number[][] | PASS |
| 6 | configToSizeTuples | keeps fluid-width entries (width=0, height>0) | PASS |
| 7 | configToSizeTuples | keeps fluid-height entries (width>0, height=0) | PASS |
| 8 | configToSizeTuples | filters out fully-zero entries (width=0, height=0) | PASS |
| 9 | configToSizeTuples | returns empty array for empty customSizes | PASS |
| 10 | formatConfigSizes | formats customSizes as 'WxH, WxH' string | PASS |
| 11 | formatConfigSizes | returns empty string for no valid sizes | PASS |
| 12 | formatConfigSizes | skips fully-zero entries | PASS |
| 13 | formatConfigSizes | handles single size | PASS |
| 14 | formatConfigSizes | formats fluid-width as 'fluidxH' | PASS |
| 15 | formatConfigSizes | formats fluid-height as 'Wxfluid' | PASS |
| 16 | formatConfigSizes | formats mixed sizes with fluid entries | PASS |
| 17 | validateSizeConfig | returns empty errors for valid config with sizes | PASS |
| 18 | validateSizeConfig | valid for fluid-width size (width=0, height>0) | PASS |
| 19 | validateSizeConfig | valid for fluid-height size (width>0, height=0) | PASS |
| 20 | validateSizeConfig | errors when maxWidth < minWidth | PASS |
| 21 | validateSizeConfig | errors when maxHeight < minHeight | PASS |
| 22 | validateSizeConfig | errors when no valid custom sizes exist | PASS |
| 23 | validateSizeConfig | errors when only fully-zero sizes exist (both dimensions 0) | PASS |
| 24 | validateSizeConfig | no range error when only one bound is set | PASS |
| 25 | validateSizeConfig | no range error when max equals min | PASS |
| 26 | validateSizeConfig | errors when ratio x < 1 | PASS |
| 27 | validateSizeConfig | errors when ratio y < 1 | PASS |
| 28 | validateSizeConfig | can have multiple errors simultaneously | PASS |
| 29 | validatePlacementConfigs | returns true for valid placements | PASS |
| 30 | validatePlacementConfigs | returns true for fluid-width placement | PASS |
| 31 | validatePlacementConfigs | returns false when active desktop panel has no custom sizes | PASS |
| 32 | validatePlacementConfigs | ignores disabled desktop panel (device=mobile) | PASS |
| 33 | validatePlacementConfigs | ignores disabled mobile panel (device=desktop) | PASS |
| 34 | round-trip | preserves data through round-trip | PASS |
| 35 | round-trip | preserves fluid-width sizes through round-trip | PASS |
| 36 | round-trip | preserves fluid-height sizes through round-trip | PASS |

### File: `src/lib/__tests__/config-normalizers.test.ts` (35 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | T31 -- Old string-format migration | converts string sizes to tuples and hydrates config | PASS |
| 2 | T32 -- Single string size migration | converts single string size | PASS |
| 3 | T33 -- Empty sizes migration | undefined sizes produce empty config | PASS |
| 4 | T33 -- Empty sizes migration | empty array sizes produce empty config | PASS |
| 5 | T34 -- Tuple format round-trip | tuple-format sizes pass through unchanged | PASS |
| 6 | fluid size migration | tuple [0, 250] hydrates as fluid-width | PASS |
| 7 | fluid size migration | string '0x250' parses as fluid-width tuple | PASS |
| 8 | fluid size migration | string '300x0' parses as fluid-height tuple | PASS |
| 9 | fluid size migration | string '0x0' is filtered out as invalid | PASS |
| 10 | E08 -- Old string 0x250 migration | fluid string size migrates correctly | PASS |
| 11 | device field normalization | normalizes 'devices' to 'device' | PASS |
| 12 | device field normalization | defaults to 'all' when no device field | PASS |
| 13 | persisted AdSizeConfig hydration | uses persisted desktopSizeConfig over migration | PASS |
| 14 | normalizeAdsConfig defaults | returns defaults for undefined input | PASS |
| 15 | normalizeAdsConfig defaults | returns defaults for empty object | PASS |
| 16 | interstitial config (I01) | returns default interstitial config when not present | PASS |
| 17 | interstitial config (I02) | returns default interstitial config for empty ads_config | PASS |
| 18 | interstitial config (I03) | normalizes full interstitial config from YAML | PASS |
| 19 | interstitial config (I04) | fills defaults for partial trigger config | PASS |
| 20 | interstitial config (I05) | fills defaults for missing trigger and frequency objects | PASS |
| 21 | interstitial config (I06) | defaults page_types to ['all'] when missing | PASS |
| 22 | interstitial config (I07) | preserves exit_intent trigger type | PASS |
| 23 | interstitial config (I08) | preserves once_per_day frequency type | PASS |
| 24 | interstitial config (I09) | preserves custom max_per_session value | PASS |
| 25 | interstitial config (I10) | preserves category-only page_types | PASS |
| 26 | interstitial config (I11) | preserves delay_seconds value | PASS |
| 27 | interstitial config (I12) | interstitial false with config still normalizes config | PASS |
| 28 | interstitial config (I13) | preserves multiple page_types | PASS |
| 29 | interstitial config (I14) | non-array page_types falls back to ['all'] | PASS |
| 30 | interstitial config (I15) | interstitial_config is independent of ad_placements | PASS |
| 31 | interstitial config (I16) | defaults close_delay_seconds to 3 when missing | PASS |
| 32 | interstitial config (I17) | preserves explicit close_delay_seconds value | PASS |
| 33 | interstitial config (I18) | preserves close_delay_seconds of 0 | PASS |
| 34 | interstitial config (I19) | defaults script_inline to empty string when missing | PASS |
| 35 | interstitial config (I20) | preserves script_inline value | PASS |

### File: `src/components/settings/__tests__/AdsConfigForm.test.tsx` (23 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | T01 -- Both size panels | renders Desktop Sizes and Mobile Sizes labels | PASS |
| 2 | T05/T06 -- New placement defaults | add placement triggers onChange with default configs | PASS |
| 3 | T21 -- Device Desktop | mobile panel is disabled when device is desktop | PASS |
| 4 | T22 -- Device Mobile | desktop panel is disabled when device is mobile | PASS |
| 5 | T23 -- Device All | neither panel is disabled when device is all | PASS |
| 6 | T28 -- Fluid size persistence | configToSizeTuples preserves [0, 250] in placement | PASS |
| 7 | T35 -- Output tuple format | converts multiple custom sizes to tuples | PASS |
| 8 | T36 -- Ratio and range | only customSizes contribute to output | PASS |
| 9 | T38 -- Size order preserved | maintains order through round-trip | PASS |
| 10 | sticky-bottom dismissible | shows dismiss checkbox for sticky-bottom position | PASS |
| 11 | sticky-bottom dismissible | does not show dismiss checkbox for non-sticky positions | PASS |
| 12 | placement CRUD | shows empty state when no placements | PASS |
| 13 | placement CRUD | remove button triggers onChange without that placement | PASS |
| 14 | fluid sizes in placement | renders fluid-width size in desktop panel | PASS |
| 15 | fluid sizes in placement | renders fluid-height size in mobile panel | PASS |
| 16 | E05 -- Device toggle | mobile config is retained when device switches to desktop | PASS |
| 17 | interstitial config (I-UI01) | does not show config panel when interstitial is off | PASS |
| 18 | interstitial config (I-UI02) | shows config panel when interstitial is toggled on | PASS |
| 19 | interstitial config (I-UI03) | shows Script URL input when interstitial is on | PASS |
| 20 | interstitial config (I-UI04) | shows trigger dropdown with Time Delay selected | PASS |
| 21 | interstitial config (I-UI05) | shows page type buttons | PASS |
| 22 | interstitial config (I-UI06) | toggling interstitial on triggers onChange with interstitial=true | PASS |
| 23 | interstitial config (I-UI07) | toggling interstitial off triggers onChange with interstitial=false | PASS |

### File: `src/components/settings/__tests__/SizeConfigPanel.test.tsx` (33 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | T02 -- Panel labels | renders the given label | PASS |
| 2 | T02 -- Panel labels | renders a different label | PASS |
| 3 | T03 -- All sub-fields | renders Aspect Ratio section | PASS |
| 4 | T03 -- All sub-fields | renders Size Range section with all 4 labels | PASS |
| 5 | T03 -- All sub-fields | renders Custom Sizes section with add button | PASS |
| 6 | T03 -- All sub-fields | renders Rendered Sizes preview for non-empty sizes | PASS |
| 7 | T03 -- All sub-fields | does not render preview when no valid sizes | PASS |
| 8 | T05 -- Default ratio values | shows 16:9 as default ratio | PASS |
| 9 | T06 -- Default range and sizes | all range fields are empty for default config | PASS |
| 10 | T07 -- Ratio X editing | calls onChange with updated ratio x | PASS |
| 11 | T08 -- Ratio Y editing | calls onChange with updated ratio y | PASS |
| 12 | T09 -- Ratio validation | shows error when ratio x < 1 | PASS |
| 13 | T09 -- Ratio validation | shows error when ratio y < 1 | PASS |
| 14 | T10 -- Min Width | calls onChange with updated range minWidth | PASS |
| 15 | T11 -- Max Width | shows error when maxWidth < minWidth | PASS |
| 16 | T12 -- Dynamic range constraint | error appears when minWidth exceeds existing maxWidth | PASS |
| 17 | T13 -- Max Height | shows error when maxHeight < minHeight | PASS |
| 18 | T14 -- Range optional | no errors when all range fields are empty | PASS |
| 19 | T15 -- Add custom size row | clicking + Add fires onChange with new empty row | PASS |
| 20 | T16 -- Valid custom size preview | shows size in rendered preview | PASS |
| 21 | T17 -- Multiple custom sizes | shows all sizes comma-separated | PASS |
| 22 | T18 -- Remove custom size | fires onChange with filtered customSizes when X clicked | PASS |
| 23 | T19 -- Error when no sizes | shows validation error when customSizes is empty | PASS |
| 24 | T24 -- Fluid width valid | width=0 with height>0 is valid | PASS |
| 25 | T25 -- Fluid width preview | shows fluidx250 for fluid-width entry | PASS |
| 26 | T26 -- Mixed sizes preview | shows both fixed and fluid entries | PASS |
| 27 | T27 -- Both dimensions empty | shows error when only 0x0 entries exist | PASS |
| 28 | disabled panel | does not show validation errors when disabled | PASS |
| 29 | disabled panel | inputs are disabled when panel is disabled | PASS |
| 30 | fluid height | width>0 height=0 shows Wxfluid preview | PASS |
| 31 | fluid height | height=0 is valid as long as width>0 | PASS |
| 32 | E06 -- All fluid sizes valid | all fluid-width entries are valid | PASS |
| 33 | E07 -- Order preserved | renders in exact order | PASS |

---

## Site Worker Tests (213 tests, 9 files)

### File: `scripts/__tests__/resolve.test.ts` (62 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | deepMerge | scalar values: later wins | PASS |
| 2 | deepMerge | arrays REPLACE -- they do not concatenate | PASS |
| 3 | deepMerge | deep merges nested objects | PASS |
| 4 | deepMerge | null in `b` does NOT erase a value in `a` | PASS |
| 5 | deepMerge | undefined in `b` does NOT erase a value in `a` | PASS |
| 6 | deepMerge | returns `b` when `a` is non-object (scalar -> object replacement) | PASS |
| 7 | deepMerge | handles deeply nested override chains (org -> group -> site) | PASS |
| 8 | deepMerge | **4-layer tracking: org -> group(null) -> override(ga4) -> site(ga4) -- site wins** | PASS |
| 9 | deepMerge | **3-layer tracking: org -> group(null) -> override(ga4) -- override wins when site has no tracking** | PASS |
| 10 | deepMerge | **null in site tracking.ga4 does NOT erase override ga4** | PASS |
| 11 | deepMerge | **each site gets its own GA4 tag from its own layer chain** | PASS |
| 12 | splitFrontmatter | parses standard frontmatter | PASS |
| 13 | splitFrontmatter | returns empty front + full body when no delimiters | PASS |
| 14 | splitFrontmatter | returns empty front when only opening delimiter (malformed) | PASS |
| 15 | splitFrontmatter | handles CRLF line endings | PASS |
| 16 | splitFrontmatter | handles empty body after frontmatter | PASS |
| 17 | rewriteAssetUrls | rewrites src= references | PASS |
| 18 | rewriteAssetUrls | rewrites src= with single quotes | PASS |
| 19 | rewriteAssetUrls | rewrites href= references | PASS |
| 20 | rewriteAssetUrls | rewrites markdown-style (/assets/x.png) parens | PASS |
| 21 | rewriteAssetUrls | does NOT rewrite absolute URLs containing /assets/ | PASS |
| 22 | rewriteAssetUrls | preserves query strings on asset URLs | PASS |
| 23 | rewriteAssetUrls | rewrites multiple references in a single pass | PASS |
| 24 | rewriteAssetUrls | is idempotent -- second call is a no-op | PASS |
| 25 | rewriteFrontmatterUrl | rewrites a /assets/... URL | PASS |
| 26 | rewriteFrontmatterUrl | returns absolute URLs unchanged | PASS |
| 27 | rewriteFrontmatterUrl | returns undefined for undefined input | PASS |
| 28 | rewriteFrontmatterUrl | returns empty-string input unchanged | PASS |
| 29 | rewriteFrontmatterUrl | does NOT rewrite paths that merely contain /assets/ | PASS |
| 30 | selectMatchingOverrides | matches by sites list | PASS |
| 31 | selectMatchingOverrides | matches by groups intersection | PASS |
| 32 | selectMatchingOverrides | does NOT match overrides with no targets | PASS |
| 33 | selectMatchingOverrides | does NOT match overrides targeting different sites | PASS |
| 34 | selectMatchingOverrides | site OR group match (UNION not intersection) | PASS |
| 35 | selectMatchingOverrides | sorts by priority ascending (lowest first = applied first) | PASS |
| 36 | selectMatchingOverrides | handles missing targets / sites / groups gracefully | PASS |
| 37 | stripModeKeys | removes _mode from objects recursively | PASS |
| 38 | stripModeKeys | removes _values directives (ads_txt _mode: add) | PASS |
| 39 | stripModeKeys | preserves arrays untouched | PASS |
| 40 | stripModeKeys | preserves scalars untouched | PASS |
| 41 | stripOverrideMetaFields | strips override-only meta keys | PASS |
| 42 | stripOverrideMetaFields | preserves config when no meta fields present | PASS |
| 43 | mergeScriptLayers | appends new script IDs across layers | PASS |
| 44 | mergeScriptLayers | same ID in later layer replaces earlier entry | PASS |
| 45 | mergeScriptLayers | skips layers without scripts | PASS |
| 46 | mergeScriptLayers | empty array in a layer does NOT wipe inherited scripts | PASS |
| 47 | mergeScriptLayers | merges across all three positions independently | PASS |
| 48 | mergeScriptLayers | returns empty arrays when no layers have scripts | PASS |
| 49 | mergeScriptLayers | handles org -> group -> override -> site (4-layer chain) | PASS |
| 50 | mergeScriptLayers | replace mode: last layer discards inherited | PASS |
| 51 | mergeAdPlacementLayers | add mode (default): appends site placements to inherited | PASS |
| 52 | mergeAdPlacementLayers | add mode: duplicate IDs result in both entries | PASS |
| 53 | mergeAdPlacementLayers | merge_placements mode: same ID replaced, new appended | PASS |
| 54 | mergeAdPlacementLayers | replace mode: only site placements remain | PASS |
| 55 | mergeAdPlacementLayers | handles empty site placements with add mode | PASS |
| 56 | layout merge | site layout deep-merges over org | PASS |
| 57 | layout merge | group layer overrides org but is overridden by site | PASS |
| 58 | layout merge | null in site does not erase org layout | PASS |
| 59 | resolveSharedPageVars | replaces all known {{key}} tokens | PASS |
| 60 | resolveSharedPageVars | replaces multiple occurrences of the same variable | PASS |
| 61 | resolveSharedPageVars | leaves unresolved tokens as-is (tolerant) | PASS |
| 62 | resolveSharedPageVars | returns unchanged HTML when vars is empty | PASS |

Tests **#8-11** (bold) are new -- added to verify the GA4 tracking bug fix.

### File: `scripts/__tests__/resolve-layout.test.ts` (5 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | resolveLayout | returns defaults when input is undefined | PASS |
| 2 | resolveLayout | overrides only the fields supplied; the rest stay default | PASS |
| 3 | resolveLayout | clamps must_reads.count to a sane minimum | PASS |
| 4 | resolveLayout | clamps page_size to a sane minimum | PASS |
| 5 | resolveLayout | coerces hero.count to 3 or 4 only | PASS |

### File: `scripts/__tests__/featured-frontmatter.test.ts` (5 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | parseFeatured | returns undefined when missing | PASS |
| 2 | parseFeatured | accepts a single string | PASS |
| 3 | parseFeatured | accepts an array | PASS |
| 4 | parseFeatured | strips unknown values silently | PASS |
| 5 | parseFeatured | returns undefined for empty array (treat as not-featured) | PASS |

### File: `src/lib/__tests__/featured.test.ts` (5 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | selectFeatured | uses tagged hero articles first, in input order | PASS |
| 2 | selectFeatured | fills remaining slots from non-featured articles | PASS |
| 3 | selectFeatured | does not duplicate when fallback overlaps with tagged | PASS |
| 4 | selectFeatured | excludes already-used slugs from must-reads fallback | PASS |
| 5 | selectFeatured | returns fewer items if the pool is smaller than count | PASS |

### File: `src/lib/__tests__/preview-override.test.ts` (21 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | isPreviewableHost | allows workers.dev subdomains | PASS |
| 2 | isPreviewableHost | allows localhost | PASS |
| 3 | isPreviewableHost | rejects production custom domains | PASS |
| 4 | isPreviewableHost | rejects .pages.dev (legacy Pages) | PASS |
| 5 | isPreviewableHost | rejects subdomain look-alikes | PASS |
| 6 | parseCookie | extracts a single cookie | PASS |
| 7 | parseCookie | extracts from a multi-cookie header | PASS |
| 8 | parseCookie | returns null when cookie not present | PASS |
| 9 | parseCookie | returns null on empty / missing header | PASS |
| 10 | parseCookie | handles URL-encoded values | PASS |
| 11 | parseCookie | does not match name as a prefix | PASS |
| 12 | resolvePreview | returns null on non-previewable hosts | PASS |
| 13 | resolvePreview | honours ?_atl_site=<id> on workers.dev | PASS |
| 14 | resolvePreview | does NOT fall back to cookie (mechanism removed) | PASS |
| 15 | resolvePreview | ?_atl_site=clear emits a deletion cookie + no override | PASS |
| 16 | resolvePreview | rejects malformed siteIds (injection guard) | PASS |
| 17 | resolvePreview | localhost is also previewable | PASS |
| 18 | generatePreviewScript | produces script tag with siteId embedded | PASS |
| 19 | generatePreviewScript | escapes single quotes in siteId | PASS |
| 20 | generatePreviewScript | escapes backslashes in siteId | PASS |
| 21 | generatePreviewScript | sets _atl_site param via click handler | PASS |

### File: `src/lib/__tests__/articles-api.test.ts` (4 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | sliceForPage | page 1 returns first initialCount items (page_size * 2) | PASS |
| 2 | sliceForPage | page 2 returns items page_size after the initial batch | PASS |
| 3 | sliceForPage | page beyond end returns empty | PASS |
| 4 | sliceForPage | page < 1 clamps to 1 | PASS |

### File: `src/lib/__tests__/inline-ads.test.ts` (12 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | injectInlineAds | inserts a slot after the Nth paragraph | PASS |
| 2 | injectInlineAds | emits size attributes that mock-ad-fill.js reads | PASS |
| 3 | injectInlineAds | handles multiple after-paragraph placements | PASS |
| 4 | injectInlineAds | skips placements with non-after-paragraph positions | PASS |
| 5 | injectInlineAds | returns input unchanged when placements is empty | PASS |
| 6 | injectInlineAds | returns input unchanged when N > paragraph count | PASS |
| 7 | injectInlineAds | preserves existing markup attributes inside paragraphs | PASS |
| 8 | injectInlineAds | escapes attributes in id / position | PASS |
| 9 | injectInlineAds | handles uppercase </P> tags | PASS |
| 10 | injectInlineAds | does not match after-paragraph-0 or negative N | PASS |
| 11 | injectInlineAds | multiple placements at SAME N both inject after same paragraph | PASS |
| 12 | injectInlineAds | escapes JSON quotes in size attributes | PASS |

### File: `src/lib/__tests__/kv-schema.test.ts` (9 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | kv-schema key builders | siteLookupKey prefixes hostname with `site:` | PASS |
| 2 | kv-schema key builders | siteLookupKey is case-preserving | PASS |
| 3 | kv-schema key builders | siteConfigKey + siteConfigPrevKey share siteId tail | PASS |
| 4 | kv-schema key builders | articleIndexKey uses canonical prefix | PASS |
| 5 | kv-schema key builders | articleKey nests siteId + slug | PASS |
| 6 | kv-schema key builders | sharedPageKey nests siteId + page slug | PASS |
| 7 | kv-schema key builders | syncStatusKey uses canonical prefix | PASS |
| 8 | kv-schema key builders | all key builders are pure (same output for same input) | PASS |
| 9 | kv-schema key builders | keys never contain spaces (KV keys must be URL-safe) | PASS |

### File: `src/lib/__tests__/category-and-layout.test.ts` (90 tests)

| # | Suite | Test | Result |
|---|-------|------|--------|
| 1 | Category -- tag filtering | filters articles matching the slug case-insensitively | PASS |
| 2 | Category -- tag filtering | returns empty when no articles match | PASS |
| 3 | Category -- tag filtering | matches multi-word tags via slug conversion | PASS |
| 4 | Category -- tag filtering | matches tags with spaces when slug uses hyphens | PASS |
| 5 | Category -- tag filtering | does not match partial tag names | PASS |
| 6 | Category -- display name | finds exact display name from brief.topics | PASS |
| 7 | Category -- display name | finds display name case-insensitively | PASS |
| 8 | Category -- display name | title-cases slug when no matching topic | PASS |
| 9 | Category -- display name | handles single-word slugs | PASS |
| 10 | Category -- numbered pagination | computes total pages correctly | PASS |
| 11 | Category -- numbered pagination | page 1: start=0, end=12 | PASS |
| 12 | Category -- numbered pagination | last page: end clamps to total | PASS |
| 13 | Category -- numbered pagination | single page has no prev/next | PASS |
| 14 | Category -- numbered pagination | out-of-range page clamps to last | PASS |
| 15 | Load More -- sliceForPage | page 1 returns double the page_size | PASS |
| 16 | Load More -- sliceForPage | page 2 returns one page_size after initial batch | PASS |
| 17 | Load More -- sliceForPage | page 3 continues from where page 2 ended | PASS |
| 18 | Load More -- sliceForPage | fractional page numbers are floored | PASS |
| 19 | Load More -- sliceForPage | negative page clamps to 1 | PASS |
| 20 | Load More -- sliceForPage | empty input returns empty for any page | PASS |
| 21 | Load More -- sliceForPage | page_size=1 yields 2 on page 1, 1 on page 2 | PASS |
| 22 | Ad placement -- inline injection | injects after correct paragraph number | PASS |
| 23 | Ad placement -- inline injection | does not inject when no inline placements exist | PASS |
| 24 | Ad placement -- inline injection | injects multiple ads at different positions | PASS |
| 25 | Ad placement -- inline injection | preserves desktop/mobile size attributes | PASS |
| 26 | Ad placement -- inline injection | ignores positions beyond available paragraphs | PASS |
| 27 | Ad placement -- inline injection | generates anonymous id for placements without id | PASS |
| 28 | Theme -- color deep merge | site colors override org defaults | PASS |
| 29 | Theme -- color deep merge | font families override individually | PASS |
| 30 | Theme -- color deep merge | empty site theme preserves org defaults | PASS |
| 31 | Layout resolution | returns LAYOUT_DEFAULTS when undefined | PASS |
| 32 | Layout resolution | hero.count only accepts 3 or 4 | PASS |
| 33 | Layout resolution | must_reads.count clamps to >= 1 | PASS |
| 34 | Layout resolution | load_more.page_size clamps to >= 1 | PASS |
| 35 | Layout resolution | sidebar_topics.auto defaults to true | PASS |
| 36 | Layout resolution | sidebar_topics.explicit overrides default | PASS |
| 37 | Featured -- category context | hero picks tagged articles first | PASS |
| 38 | Featured -- category context | must-read excludes hero slugs | PASS |
| 39 | Featured -- category context | returns fewer when pool exhausted | PASS |
| 40 | Feed card HTML | renders article with featured image | PASS |
| 41 | Feed card HTML | renders without image when missing | PASS |
| 42 | Feed card HTML | escapes HTML in titles (XSS prevention) | PASS |
| 43 | Feed card HTML | renders multiple articles in order | PASS |
| 44 | Feed card HTML | returns empty string for empty array | PASS |
| 45 | Asset URL rewriting | rewrites /assets/ paths to R2 paths | PASS |
| 46 | Asset URL rewriting | leaves absolute URLs untouched | PASS |
| 47 | Asset URL rewriting | rewriteFrontmatterUrl prefixes /assets/ | PASS |
| 48 | Asset URL rewriting | rewriteFrontmatterUrl passes through absolute URLs | PASS |
| 49 | Asset URL rewriting | rewriteFrontmatterUrl returns undefined for undefined | PASS |
| 50 | parseFeatured -- coercion | returns undefined for null/undefined | PASS |
| 51 | parseFeatured -- coercion | parses single string value | PASS |
| 52 | parseFeatured -- coercion | parses array of valid values | PASS |
| 53 | parseFeatured -- coercion | strips invalid values silently | PASS |
| 54 | parseFeatured -- coercion | returns empty array when all invalid | PASS |
| 55 | parseFeatured -- coercion | returns undefined for empty array | PASS |
| 56 | KV keys -- category routing | article-index key is deterministic | PASS |
| 57 | KV keys -- category routing | site-config key provides config | PASS |
| 58 | KV keys -- category routing | site lookup key resolves hostname | PASS |
| 59 | KV keys -- category routing | article key nests correctly | PASS |
| 60 | mergeScriptLayers -- multi-layer | merges scripts from org + group + override via merge-by-id | PASS |
| 61 | mergeScriptLayers -- multi-layer | site-layer scripts replace override when same id | PASS |
| 62 | mergeScriptLayers -- multi-layer | empty script arrays never erase inherited entries | PASS |
| 63 | mergeScriptLayers -- multi-layer | replace mode on site layer discards all inherited | PASS |
| 64 | mergeScriptLayers -- multi-layer | layers without scripts field are silently skipped | PASS |
| 65 | resolveScriptVars -- substitution | replaces {{key}} tokens with scripts_vars values | PASS |
| 66 | resolveScriptVars -- substitution | replaces multiple occurrences of same token | PASS |
| 67 | resolveScriptVars -- substitution | throws on unresolved tokens | PASS |
| 68 | resolveScriptVars -- substitution | leaves src-only scripts untouched | PASS |
| 69 | resolveScriptVars -- substitution | resolves vars across all three positions | PASS |
| 70 | resolveScriptVars -- substitution | handles empty vars with no templates | PASS |
| 71 | mergeAdPlacementLayers -- merge | non-site layers replace inherited (last group wins) | PASS |
| 72 | mergeAdPlacementLayers -- merge | site layer defaults to add mode (appends) | PASS |
| 73 | mergeAdPlacementLayers -- merge | site replace mode discards all inherited | PASS |
| 74 | mergeAdPlacementLayers -- merge | merge_placements mode merges by id | PASS |
| 75 | mergeAdPlacementLayers -- merge | override layer replaces group placements | PASS |
| 76 | selectMatchingOverrides -- targeting | matches by site id | PASS |
| 77 | selectMatchingOverrides -- targeting | matches by group membership | PASS |
| 78 | selectMatchingOverrides -- targeting | sorts by priority ascending | PASS |
| 79 | selectMatchingOverrides -- targeting | returns empty when nothing matches | PASS |
| 80 | stripModeKeys | removes _mode from nested objects | PASS |
| 81 | stripModeKeys | removes _values from arrays-in-objects | PASS |
| 82 | stripModeKeys | preserves scripts arrays including body_start | PASS |
| 83 | stripModeKeys | is recursive through nested objects | PASS |
| 84 | Full merge -- theme 3 layers | group overrides org colors, site overrides one | PASS |
| 85 | Full merge -- theme 3 layers | override layer injects between group and site | PASS |
| 86 | Full merge -- theme 3 layers | null values do NOT erase inherited | PASS |
| 87 | Full merge -- scripts 4 layers | simulates coolnews-atl layer chain | PASS |
| 88 | Full merge -- ads 4 layers | override replaces group, site adds nothing | PASS |
| 89 | Full merge -- ads 4 layers | site in add mode appends to override result | PASS |
| 90 | stripOverrideMetaFields | removes override_id, name, priority, targets | PASS |

---

## Test Coverage by Domain

| Domain | Tests | Coverage Areas |
|--------|-------|----------------|
| Config Inheritance (5-layer resolve) | 62 | deepMerge, override targeting, script merge, ad placement merge, layout merge, shared page vars, asset URL rewriting |
| Config Normalizers | 35 | Size migration, fluid sizes, device normalization, interstitial config, ads config defaults |
| Ad Loader (runtime rendering) | 29 | Fluid/fixed containers, overflow, device targeting, viewport-aware size selection |
| Ad Size Config (form logic) | 36 | Size config creation, conversion, formatting, validation, round-trips, fluid sizes |
| Ads Config Form (React UI) | 23 | Panel rendering, device toggle, placement CRUD, fluid sizes, interstitial UI |
| Size Config Panel (React UI) | 33 | Labels, sub-fields, ratio editing/validation, range constraints, custom sizes, disabled state |
| Wizard Bundle Creation | 11 | HTTP 200/201 success, 409 retry, error propagation, existing bundle, skip conditions, payload structure |
| Category & Layout | 90 | Tag filtering, display names, pagination, load-more, inline ads, theme merge, layout resolution, featured selection, feed cards, asset URLs, KV keys, script/ad merge |
| Preview Override | 21 | Host validation, cookie parsing, preview resolution, injection guard, script generation |
| Articles API | 4 | Page slicing, boundary conditions |
| Featured Selection | 5 | Hero priority, fallback fill, deduplication, pool exhaustion |
| Featured Frontmatter | 5 | Parsing, single/array values, unknown value stripping |
| Layout Resolution | 5 | Defaults, partial override, clamping, hero count coercion |
| KV Schema | 9 | Key builders, purity, URL-safety |
| Inline Ads | 12 | Paragraph injection, multiple positions, escaping, edge cases |
