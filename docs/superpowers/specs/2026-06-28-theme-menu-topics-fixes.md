# Spec: Theme button contrast, menu-item size control, robust topics taxonomy

**Date:** 2026-06-28
**Status:** Awaiting approval
**Audit log:** `docs/audit-logs/2026-06-28-0849-theme-menu-topics-fixes.md`
**Branch:** `asaf-new` (all three issues, one branch — user decision)

## Goal
Fix three production issues: (1) invisible white-on-white Read More / Subscribe buttons in some presets, (2) add a navigation menu-item font-size control, and (3) make topic categories/tags resolve reliably (no raw IDs), stop empty/partial taxonomy from breaking aggregator fetches, and stop AI re-propose from dropping categories.

---

## Issue #1 — Button contrast (chosen: auto-contrast text + fix presets)

### Goal
Buttons that use a theme color as background must always have readable text, regardless of the chosen color.

### Approach
1. **Auto-contrast foreground.** Add a pure helper `readableTextColor(hex): "#ffffff" | "#111111"` (WCAG relative-luminance threshold) in `packages/site-worker/src/lib/contrast.ts`. In `BaseLayout.astro`, where `theme.colors` is available as JS values, compute and inject `--color-secondary-fg` (and `--color-accent-fg`) CSS variables alongside the existing color vars.
2. **Components consume the fg var.** Replace hardcoded `color: #fff` with `color: var(--color-secondary-fg, #fff)` in: `LoadMoreButton.astro`, `NewsletterBox.astro` (.atl-newsletter-submit), `HeroCard.astro`, `ThumbCard.astro`, `FollowUs.astro`. (Code block `.prose pre` keeps its light text but is protected by step 3.)
3. **Fix preset secondary.** Change `secondary: "#ffffff"` → a theme-appropriate dark value in the 4 presets (Mint Finance, Tokyo Night, Aurora, Pink Glow) in `themePresets.ts`. Rationale: `secondary` is the "dark section" color (also used for code-block backgrounds); white there is semantically wrong even with auto-contrast.

### Data flow
`theme.colors.{secondary,accent}` → BaseLayout computes `*-fg` → injected `:root` CSS vars → component CSS.

### Edge cases
- Missing/invalid hex → helper returns `#ffffff` (safe default; matches today's behavior).
- Existing live sites: auto-contrast applies at render time (no re-seed needed for the fg fix). Preset changes only affect newly created / re-seeded sites.

### Out of scope
- Full theming overhaul; per-button color overrides.

---

## Issue #2 — Menu item font-size control (additive, mirrors `logo_height`)

### Goal
Per-site control of nav menu item font size so items don't look tiny next to a large logo.

### Components / files
- `packages/shared-types/src/config.ts`: `ThemeConfig.menu_item_font_size?: number`; `ResolvedThemeConfig.menu_item_font_size: number`.
- `packages/site-worker/src/layouts/BaseLayout.astro`: runtime default (`14`), inject `--menu-item-font-size`.
- `packages/site-worker/src/themes/modern/styles/theme.css`: default `--menu-item-font-size: 0.875rem`.
- `packages/site-worker/src/themes/modern/components/Header.astro`: `.nav-link` + `.drawer-link` `font-size: var(--menu-item-font-size, 0.875rem)`.
- `services/dashboard/src/components/site-detail/SiteThemeTab.tsx` + `wizard/StepTheme.tsx`: slider (range 10–24, default 14) next to logo sizing.
- `services/dashboard/src/app/api/sites/save/route.ts`: persist `theme_menu_item_font_size`.

### KV schema evolution (3 mandatory steps)
1. Runtime default in BaseLayout. 2. Seed default (deepMerge carries theme; add to resolved default). 3. Re-seed live sites (post-deploy step).

### Out of scope
- Per-breakpoint font sizes; nav spacing/weight controls.

---

## Issue #3 — Robust topics taxonomy (chosen: fetch-all + persist names + guard + lazy migration)

### Root causes (verified)
- `getTags()` caps at 2000 of 9437 tags → later-alphabet tags show as raw IDs and never reach the AI.
- `/api/categories` route requests `page_size=500` of 524 → tail categories drop; grows worse.
- In the user's env `getAllCategories()` returned `[]` → all categories show as raw IDs + AI told "no categories available". **Exact env trigger TBD — reproduce locally first.**
- No guard/robustness: empty taxonomy silently degrades to raw IDs + dropped categories.

### Scalability constraint (drives the design) — reconciled with official API doc (2026-06-28)
The tag taxonomy grows continuously (9,437 today → ~15k in a week → unbounded). Confirmed against the aggregator API reference:
- **`page_size` max = 100** (documented). The dashboard's "fetch all categories" path requests `page_size=500`, which **violates the max** — likely the empty-categories root cause (see below). All taxonomy fetches MUST paginate at `page_size ≤ 100`.
- **No id→name resolution:** no `GET /api/tags/:id` or `GET /api/categories/:id` (only PUT/DELETE); no `?ids=` param. A name can only be obtained by finding the id in a list response. With max-100 paging, resolving a topic's tag ids by scanning = up to ~95 sequential requests (and growing). Impractical at scale → motivates an aggregator `?ids=` resolver (see "Aggregator change").
- **Usage sort is official:** `/api/tags?sort=usage_count&order=desc&include_usage=true`.
Therefore the design must NOT depend on fetching the full tag list for normal operation. Categories are bounded (524 = 36 tier-1 + 488 children) so paginated fetch-all is fine for them; **tags are bounded only via persisted names + usage-ranked top-N**.

### Approach
1. **Reproduce the empty-categories failure locally** (`cloudgrid dev`, hit `/api/categories`). **Leading cause (doc-grounded):** the "fetch all" route requests `page_size=500` > documented max 100 → `400 validation_error` → route returns `[]`. Confirm, then fix by paginating at `page_size ≤ 100`. (Fix is the same even if the cap isn't currently enforced.)
2. **Categories — paginate to completion at `page_size=100` (bounded).** `getAllCategories()` loops `page=1..total_pages` (covers 524 + growth). Compliant with the documented max; also mitigates any large-response failure.
3. **Tags — bounded, NOT fetch-all:**
   - **AI proposal candidate list:** fetch **top-N tags by `usage_count` desc** (`getTopTags(limit≈800)`), not the whole taxonomy. Prompt size is constant regardless of total tag count. Niche tags are still addable via the existing name `searchTags`.
   - **Display:** rely on **persisted names** (below). No full-taxonomy fetch on modal open. Remove the `useTags()` fetch-all dependency for resolution.
4. **Persist names (denormalize, backward-compatible).** Add optional `category_names?: Record<string,string>` and `tag_names?: Record<string,string>` to the `filter` variant of `TopicV2Source` in **both** `packages/shared-types/src/config.ts` and `services/dashboard/src/types/dashboard.ts`. `category_ids`/`tag_ids` stay the source of truth for the aggregator (content-pipeline unchanged). When a category/tag is selected (search result, top-N list, or AI proposal — name known), store its name. Display resolves: stored name → in-memory lists already loaded (categories + top-N tags + search results) → id (last resort).
5. **Guard re-propose.** Disable "Re-propose with AI" until categories AND the top-N tag list have loaded; surface a visible warning if the taxonomy failed to load instead of silently proposing tags-only.
6. **Legacy backfill via `?ids=` (approved aggregator change).** Existing topics have ids but no names. Resolve them with the new aggregator `?ids=` batch endpoint (one request per topic for cats + tags) — see handoff spec `docs/superpowers/specs/2026-06-28-aggregator-ids-resolution-handoff.md`. Build the dashboard resolver to use `?ids=` with a graceful fallback so we ship before the aggregator deploys; topics self-heal (persist names) on next view/save.

### Data flow
Aggregator → `/api/{categories,tags}` route → `reference-data` (paginated) → `useReferenceData` hooks → `TopicEditModal` (display + AI payload + name persistence) → topic `source` saved to site config.

### Error handling
- Route fetch failure → empty list → modal shows a "taxonomy failed to load — try again" banner; re-propose disabled.
- AI returns unknown IDs → already dropped + logged in `propose-filter.ts` (keep).

### Edge cases
- 0 categories selected after proposal → keep current behavior but log; never silently send empty filters that match nothing.
- Tag added via search that's also beyond the fetched set → name comes from the search result, stored.

### Out of scope
- Changing the aggregator; changing `category_ids`/`tag_ids` to object arrays; redesigning the AI proposal into a two-step category-then-tag flow.

---

## Test plan (high level — detailed in the plan doc)
- `contrast.ts` unit tests (light bg → dark text, dark bg → white text, invalid → default).
- `reference-data` pagination tests (mock fetch: multi-page exhaustion, dedup, ceiling).
- Theme resolution test for `menu_item_font_size` default + override.
- Name-persistence + display-precedence unit tests; lazy-backfill unit test.
- Re-propose guard: RTL test (button disabled until taxonomy loaded) or documented screenshots.
- UI screenshots for: a fixed white-button preset, the menu-size slider, the topic modal resolving names.

## Post-deploy verification
- Re-seed all live sites; confirm `--menu-item-font-size` and `--color-secondary-fg` present in rendered `:root`.
- Open a topic in production; confirm categories + tags resolve to names; run a scheduled fetch and confirm articles return.
