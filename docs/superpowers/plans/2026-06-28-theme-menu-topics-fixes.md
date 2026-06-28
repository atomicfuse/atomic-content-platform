# Plan: Theme button contrast, menu-item size, robust topics taxonomy

**Date:** 2026-06-28
**Status:** Awaiting approval
**Spec:** `docs/superpowers/specs/2026-06-28-theme-menu-topics-fixes.md`
**Branch:** `asaf-new`
**Scope:** Large (multi-package; shared-types, site-worker, dashboard, content-pipeline)

> TDD per task: write failing test → confirm failure → implement → confirm pass. Run `tsc --noEmit` after every file change. No commit/deploy until Asaf tests locally and approves.

---

## Phase A — Issue #3 repro (do first; informs the rest of #3)

### Task A1: Reproduce empty-categories failure locally
- [ ] Run `cloudgrid dev`; hit `/api/categories` and `/api/tags` from the dashboard; inspect what `getAllCategories()` returns.
- [ ] Confirm the trigger (env fallback / large-response 500 / stale cache). Record in audit log.
- [ ] If the cause differs from spec hypotheses, pause and adjust the plan.

---

## Phase B — Issue #3 implementation

### Task B1: Bounded, scalable fetch for tags + categories
Files: `services/dashboard/src/lib/reference-data.ts`
Test: `services/dashboard/src/lib/__tests__/reference-data.test.ts`
- [ ] Test: `getAllCategories()` paginates `page=1..total_pages` at **page_size=100** (documented max) and returns all items.
- [ ] Test: new `getTopTags(limit)` requests `sort=usage_count&order=desc&include_usage=true` at page_size≤100 and returns ≤limit tags (mock fetch); does NOT fetch the whole taxonomy.
- [ ] Implement: shared `fetchAllPages(path, {pageSize:100})` for categories (loop on `total_pages`); `getTopTags(limit≈300, in ≤3 pages)` bounded fetch for the AI candidate list.
- [ ] Retire the unbounded `getTags()` 2000-cap path for resolution (replaced by persisted names + top-N + search). Keep `searchTags` for niche add.
- [ ] **Scalability note:** nothing on the modal-open or proposal hot path scales with total tag count after this task.

### Task B2: Categories route — page_size compliance + `ids` passthrough
Files: `services/dashboard/src/app/api/categories/route.ts`, `services/dashboard/src/app/api/tags/route.ts`
- [ ] Stop requesting `page_size=500` (exceeds documented max 100). Forward `page`/`page_size` and let `getAllCategories` loop (keep the route a thin proxy).
- [ ] Forward an `ids` query param to the aggregator (enables resolution once the aggregator ships `?ids=`).
- [ ] Keep error path returning a consistent shape; log upstream status (catch the 400 that was silently becoming `[]`).
- [ ] Test: never requests page_size>100; forwards `ids`; surfaces upstream error status.

### Task B2b: `resolveByIds` resolver (uses `?ids=`, graceful fallback)
Files: `services/dashboard/src/lib/reference-data.ts`
Test: same `__tests__/reference-data.test.ts`
- [ ] `resolveCategoryNames(ids)` / `resolveTagNames(ids)` → call `/api/{categories,tags}?ids=...`, return `Record<id,name>`.
- [ ] Graceful fallback if aggregator hasn't shipped `?ids=` yet (returns all/ignores): detect over-large response and fall back to in-memory lists (categories full list + top-N tags + search); never block the modal.
- [ ] Test: resolver returns names from a mocked `?ids=` response; falls back when the response looks unfiltered.

### Task B3: Persist names on TopicV2Source (types)
Files: `packages/shared-types/src/config.ts`, `services/dashboard/src/types/dashboard.ts`
- [ ] Add optional `category_names?: Record<string,string>`, `tag_names?: Record<string,string>` to the `filter` source variant in both copies.
- [ ] Test: type-level + a small builder/normalizer test that a source round-trips with names.

### Task B4: Display precedence + name persistence in modal
Files: `services/dashboard/src/components/site-detail/TopicEditModal.tsx`
Test: `services/dashboard/src/components/site-detail/__tests__/TopicEditModal.test.tsx`
- [ ] Resolution precedence: persisted `*_names` → `resolveByIds` (`?ids=`) for any still-missing → in-memory lists (categories/top-N tags/search) → id (last resort).
- [ ] On open, if a topic has ids without persisted names, call `resolveByIds` once to fill them in the UI.
- [ ] On select (search result / top-N / AI proposal): store the name into source maps.
- [ ] On save (`handleSave`): backfill any missing names so the topic self-heals (persists names).
- [ ] Test: selecting a tag stores its name; display prefers stored name; `resolveByIds` fills an unpersisted id.

### Task B5: Guard re-propose against empty taxonomy
Files: `TopicEditModal.tsx` (+ hooks expose `loading`)
- [ ] Disable "Propose"/"Re-propose with AI" until `allCategories.length>0 && allTags.length>0`; show a "taxonomy failed to load" banner on empty after load.
- [ ] Test (RTL): button disabled while loading/empty; enabled once populated.

### Task B6: Pipeline tolerance + diagnostics
Files: `services/content-pipeline/src/agents/content-generation/agent.ts` (+ propose-filter unchanged)
- [ ] Verify extra name fields are ignored by the fetch path (no type break).
- [ ] Add a clear log when a topic resolves 0 articles distinguishing empty-filter vs no-results.
- [ ] Test: existing tests still pass; add assertion for the 0-results log branch.

---

## Phase C — Issue #1 button contrast

### Task C1: `readableTextColor` helper
Files: `packages/site-worker/src/lib/contrast.ts`
Test: `packages/site-worker/src/lib/__tests__/contrast.test.ts`
- [ ] Test: light bg → `#111111`; dark bg → `#ffffff`; invalid/missing → `#ffffff`.
- [ ] Implement WCAG relative-luminance threshold.

### Task C2: Inject `*-fg` vars + consume in components
Files: `packages/site-worker/src/layouts/BaseLayout.astro`; `LoadMoreButton.astro`, `NewsletterBox.astro`, `HeroCard.astro`, `ThumbCard.astro`, `FollowUs.astro`
- [ ] BaseLayout computes `--color-secondary-fg`, `--color-accent-fg` from `theme.colors`.
- [ ] Components: hardcoded `#fff` → `var(--color-secondary-fg, #fff)`.
- [ ] Test: BaseLayout helper output / snapshot includes the fg vars.

### Task C3: Fix preset secondary values
Files: `services/dashboard/src/components/wizard/themePresets.ts`
- [ ] Change `secondary: "#ffffff"` → theme-appropriate dark in Mint Finance, Tokyo Night, Aurora, Pink Glow.
- [ ] Test: preset invariant — no preset has near-white `secondary` (luminance guard test over all presets).

---

## Phase D — Issue #2 menu item size

### Task D1: Type + resolved default
Files: `packages/shared-types/src/config.ts`
- [ ] Add `menu_item_font_size?` (ThemeConfig) + required in `ResolvedThemeConfig`.
- [ ] Test: resolution default = 14; override respected.

### Task D2: Site-worker rendering
Files: `BaseLayout.astro`, `themes/modern/styles/theme.css`, `themes/modern/components/Header.astro`
- [ ] Runtime default + inject `--menu-item-font-size`; `.nav-link`/`.drawer-link` use it; css default.
- [ ] Test: var injected; covered by BaseLayout test.

### Task D3: Dashboard control + save
Files: `SiteThemeTab.tsx`, `wizard/StepTheme.tsx`, `api/sites/save/route.ts`
- [ ] Slider 10–24 default 14; load/save wiring; route persists `theme_menu_item_font_size`.
- [ ] Test: save handler writes `theme.menu_item_font_size`.

---

## Phase E — Verification + artifacts
- [ ] `tsc --noEmit` per package; `pnpm lint`; `pnpm build` (touched packages).
- [ ] Full test suites; save output to `docs/test-results/2026-06-28-HHMM-theme-menu-topics.txt`; state delta.
- [ ] UI screenshots → `docs/test-results/screenshots/theme-menu-topics/`: fixed white-button preset, menu-size slider, topic modal resolving names.
- [ ] Post-deploy checklist (re-seed sites; verify vars + topic resolution + article fetch).

## Done when
- All three issues fixed, tests green, artifacts saved, Asaf has tested locally and approved. Re-seed documented for deploy.

## Aggregator change (recommended — pending user decision)
Confirmed against the official API doc: **no id→name resolution** (no `GET /api/{tags,categories}/:id`; no `?ids=` param) and **`page_size` max = 100**. Together these make resolving a topic's stored tag ids by scanning cost up to ~95 sequential requests (and growing) — impractical at scale.
- **Recommended shared change:** add an `?ids=a,b,c` filter to `GET /api/tags` and `GET /api/categories` (returns the matching items). Idiomatic — `/api/content` already accepts comma-separated `category_ids`/`tag_ids`. Low cost (indexed lookup by `_id`), benefits any consumer that stores taxonomy refs.
- **If adopted:** dashboard resolves only a topic's selected ids in one request (scales to any taxonomy size); legacy backfill becomes trivial; no full-taxonomy scan anywhere. Persisted names remain as defense-in-depth (survive tag rename/delete).
- **If not:** ship self-contained (persisted names + top-N for AI). Legacy backfill must scan up to ~95 pages once per affected topic (or a one-time script doing it once globally) — works, but slow and the only non-scaling piece.
- **Phase A may surface a mandatory aggregator-side category bug** (separate from this — though the leading hypothesis is the dashboard requesting page_size>100, which is OUR fix).

## Risks
- Empty-categories root cause may be env-specific (Task A1 de-risks).
- AI tag candidate list is now bounded (top-N by usage) — scales regardless of total tag count. Resolved.
- Two `TopicV2` copies must stay in sync (shared-types + dashboard types).
