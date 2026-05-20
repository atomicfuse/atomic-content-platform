# Theme polish + homepage redesign

**Date:** 2026-05-20
**Branch:** `asaf-new`
**Status:** Design — pending user review before implementation plan

## Background

After yesterday's theme-config work (colors, fonts, logo upload, font picker, etc.), four bugs surfaced and the homepage feels unstructured compared to peer sites like BuzzSoaps:

**Bugs**
1. A large `theme.logo_height` (e.g., wineoceans uses 96) overflows the fixed-height nav bar.
2. The footer logo is always broken — the image 404s regardless of what's uploaded.
3. The footer shows `site_name` under the logo even when no tagline is set (and no text is wanted).
4. Menu item hover color has no dedicated setting; it silently borrows `accent`.

**Homepage structure**
1. "What's New?" is a never-ending vertical list. It should be a small grid of the newest few articles.
2. There is no "More on {site_name}" section — all overflow articles fall into the "What's New" list.
3. The sidebar's "More" widget duplicates content that already appears in the feed and adds visual noise.

This spec covers both — the bugs and the homepage restructure — because they share the same code paths in `packages/site-worker/src/themes/modern/` and the same dashboard panel in `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`.

## Goals / non-goals

**Goals**

- Logo size in `site.yaml` actually controls the rendered nav, up to a sensible cap, without breaking layout.
- Footer logo works end-to-end (upload → save → seed → render).
- Footer never shows the site name under a logo.
- Menu hover color is a real configurable theme color.
- Homepage has a defined four-section structure: Hero, What's New (grid), Must Reads, More on {site_name} (with Show More).
- All new layout knobs are editable from the dashboard, matching the existing pattern.

**Non-goals**

- No changes to how articles are written, scored, or scheduled.
- No changes to the article page layout (only the sidebar's "More" widget is removed there too, for consistency).
- No new theme presets. Existing presets keep working; the new `nav_link_hover` color falls back to `accent` so old configs render identically.
- No backwards-compat shims. Existing site.yaml files without the new fields just pick up defaults.

## Bug fixes

### 1. Logo overflows the nav bar

**Root cause.** [`Header.astro`](../../packages/site-worker/src/themes/modern/components/Header.astro) hardcodes `.nav-inner { height: 64px }` and renders the logo at `height: var(--logo-height, 52px)`. When `--logo-height` > ~56px the logo clips the bar. The `.nav-spacer` (which offsets the sticky header from page content) and the mobile drawer's `top: 64px` are also tied to that constant.

**Fix.**

- In `BaseLayout.astro`, after computing `logoHeight`, also compute and emit two CSS variables:
  - `--logo-height: ${Math.min(logoHeight, 104)}px` — clamp the logo to 104px so setting `logo_height: 300` does not break the bar.
  - `--nav-height: clamp(64px, ${Math.min(logoHeight, 104) + 16}px, 120px)` — nav grows with the (clamped) logo plus 8px padding top + 8px bottom, capped at 120px total.
- Together: max logo = 104px, max nav = 120px, with 16px total vertical padding. Min nav = 64px (mobile / small logos).
- In `Header.astro` change `.nav-inner { height: 64px }` → `.nav-inner { min-height: var(--nav-height); padding: 8px 1rem; }`.
- Change `.nav-spacer { height: 64px }` → `.nav-spacer { height: var(--nav-height) }`.
- Change `.mobile-drawer { top: 64px }` → `.mobile-drawer { top: var(--nav-height) }`.
- The desktop-vs-mobile breakpoint is unaffected — on phones the clamp's lower bound (64px) gives the same height as today.

### 2. Footer logo broken

**Root cause.** [`seed-kv.ts:440-446`](../../packages/site-worker/scripts/seed-kv.ts) rewrites `theme.logo` and `theme.favicon` from `/assets/foo.png` → `/<siteId>/assets/foo.png` so the request hits R2. It does **not** rewrite `theme.footer_logo`. The dashboard saves `theme.footer_logo = "/assets/logo-footer.png"` ([`save/route.ts:246`](../../services/dashboard/src/app/api/sites/save/route.ts)), and that bare path 404s on the Worker.

**Fix.** Add one line in `seed-kv.ts` next to the existing rewrites:

```ts
if (typeof theme.footer_logo === 'string') {
  theme.footer_logo = rewriteFrontmatterUrl(theme.footer_logo, siteId);
}
```

No data migration needed. The next `pnpm seed:kv` (or any save that triggers a sync) fixes every existing site.

### 3. Site name leaks under footer logo

**Root cause.** [`Footer.astro:41-43`](../../packages/site-worker/src/themes/modern/components/Footer.astro) always renders `<p class="footer-tagline">{config.site_tagline ?? config.site_name}</p>`. When there's a logo and no tagline, that "?? site_name" prints the brand name below the logo image — visually duplicated.

**Fix.** Render the tagline `<p>` only when there is no logo. With a logo, the about column shows the logo image and nothing else. Without a logo, it falls back to `<span class="footer-logo-text">{site_name}</span>` (already present) **and** suppresses the tagline `<p>` unless `site_tagline` is explicitly set. Final rules:

| Has logo | Has tagline | Render |
| --- | --- | --- |
| yes | yes | logo only (no tagline rendered — the brand image is enough) |
| yes | no | logo only |
| no | yes | site_name as text + tagline |
| no | no | site_name as text only |

Drop the `?? config.site_name` fallback in the tagline expression entirely.

### 4. Menu hover color is hardcoded

**Root cause.** [`Header.astro:175`](../../packages/site-worker/src/themes/modern/components/Header.astro) and the drawer at line 271 set `color: var(--color-accent, #f4c542)` on hover. There is no `nav_link_hover` field on `theme.colors`.

**Fix.** Add `nav_link_hover` to the `ThemeColors` type (optional). In `Header.astro`, change both hover rules to `color: var(--color-nav_link_hover, var(--color-accent, #f4c542))` so a missing field falls back to the existing behavior. Surface it in the dashboard's Advanced text colors section in `SiteThemeTab.tsx`.

## Homepage redesign

### Article allocation

The homepage assigns articles to four disjoint slots, in order:

```
visible = all visible articles, sorted newest first

1. heroArticles      = selectFeatured(visible, 'hero', hero.count, ∅, 'newest')
2. whatsNewArticles  = next whats_new.count articles, excluding hero slugs
3. taken             = heroSlugs ∪ whatsNewSlugs
4. mustReadArticles  = selectFeatured(visible, 'must-read', must_reads.count, taken, 'random')
5. moreOnArticles    = remaining = visible \ (taken ∪ mustReadSlugs), paginated
```

Each article appears in exactly one section. The "What's New" set is *the next four newest after hero* — not random, not curated. Must Reads honors any `featured: [must-read]` tags first and then **randomly** picks from the remaining pool (not the next-newest, which is the current fallback).

**Disabled sections.** Each section block has an `enabled` flag. When a section is disabled, its slot computation is skipped and those articles flow back into the pool for the next section:

- `hero.enabled: false` → hero is not rendered, `heroSlugs` is empty, all articles available downstream.
- `whats_new.enabled: false` → no What's New section rendered, the would-be 4 articles fall into the must-reads/more-on pool.
- `must_reads.enabled: false` → no Must Reads section rendered, no random pick; those articles stay in More on.
- `more_on.enabled: false` → no More on section, no Show More button. (Edge case — probably no real use, but the flag exists for symmetry.)

`selectFeatured` in [`src/lib/featured.ts`](../../packages/site-worker/src/lib/featured.ts) grows two new parameters:

1. `fallbackOrder: 'newest' | 'random'` — when `'random'`, after the tagged-articles pass, the function shuffles `articles \ used` with Fisher-Yates and takes the first `count - out.length`. Hero callers pass `'newest'` (unchanged behavior). Must-read callers pass `'random'`.
2. `seed?: string` — optional. When `fallbackOrder === 'random'` and a seed is provided, the shuffle is deterministic (Mulberry32 PRNG over FNV-1a hash of the seed). Same seed + same input → same output. When omitted, falls back to `Math.random()`.

**Why seeded.** Both the homepage SSR (`pages/index.astro`) and the `/api/articles` Load More endpoint compute the disjoint allocation independently. If they used `Math.random()`, they'd pick different must-reads, which would let an article appear in must-reads on the rendered page *and* in a "Load More" response on the same day. Passing a seed of `<siteId>:<YYYY-MM-DD>` from both endpoints guarantees they agree on the must-reads pick for the whole UTC day. The pick rotates daily.

### Pagination for "More on …"

Initial render: 8 articles (`more_on.page_size`).
Each Show More click: 4 more articles (`load_more.page_size`, default changed from 10 to 4).

Rewrite [`src/lib/articles-pagination.ts`](../../packages/site-worker/src/lib/articles-pagination.ts):

```ts
export function sliceMoreOn<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): T[] {
  if (page < 1) return [];
  if (page === 1) return moreOn.slice(0, initialSize);
  const start = initialSize + (page - 2) * loadMoreSize;
  return moreOn.slice(start, start + loadMoreSize);
}

export function hasMoreOnAfter<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): boolean {
  if (page === 1) return moreOn.length > initialSize;
  return moreOn.length > initialSize + (page - 1) * loadMoreSize;
}
```

The existing `sliceForPage` stays in place for any non-homepage callers; the homepage stops using it. (A search of the codebase will confirm whether category pages need updating too.)

The `/api/articles.ts` endpoint needs the same `moreOnArticles` filter applied before slicing, so it returns only "More on" articles, never re-shows hero/whats-new/must-read content. The endpoint receives `?page=N` and renders cards via `_render-feed-cards.ts` — that file is reused as-is (its output already matches the "More on" horizontal card style).

### Components

| File | Status | What it does |
| --- | --- | --- |
| `WhatsNewGrid.astro` | **new** | 2×2 grid of image-on-top cards (image + title + date). 4 cards, no excerpt. Heading "What's New?" |
| `WhatsNewCard.astro` | **new** | Single card used by `WhatsNewGrid` — image (16:10 or 1:1, TBD by the implementing dev based on what looks right with current article images), title (clamped 2 lines), date in muted color. |
| `MoreOnSection.astro` | **new** | Wraps the heading "More on {site_name}", the 2-column FeedCard grid, and the LoadMoreButton. |
| `FeedCard.astro` | reused | Already the right shape (thumb left, title/date/excerpt right). Used inside `MoreOnSection`. The grid container (`#article-feed-list` or renamed to `#more-on-list`) becomes a 2-col CSS grid on ≥768px, 1-col on mobile. |
| `ArticleFeed.astro` | **deleted** | No longer used on the homepage. If category pages still use it, leave it; if not, delete. Resolve during implementation. |
| `Sidebar.astro` | modified | Remove the entire `sidebar-more` section for both `home` and `article` variants. Newsletter + ads stay. |
| `Header.astro` | modified | Bug 1 + Bug 4 (nav height, nav_link_hover). |
| `Footer.astro` | modified | Bug 3 (tagline rendering rules). |
| `MustReads.astro` | unchanged | Only the upstream selection changes. |
| `LoadMoreButton.astro` | modified | Targets `#more-on-list` (or whatever id the new grid uses). DOM contract otherwise unchanged. |
| `_render-feed-cards.ts` | unchanged | Still emits FeedCard HTML; called from `/api/articles.ts`. |
| `/api/articles.ts` | modified | Compute `moreOnArticles` (the same way the homepage does), then slice using `sliceMoreOn`. |
| `index.astro` | modified | Switches to the new components and section order. |

### Homepage section order

```
Header
HeroGrid                    (hero.count cards, default 4)
AdSlot (homepage-top)
WhatsNewGrid + Sidebar      (2×2 grid + sidebar; sidebar no longer has More widget)
MustReads                   (1 hero + 4 thumbs, dark band — unchanged visually)
MoreOnSection               (2-col × 4 rows = 8, Show More button below)
Footer
AdSlot (sticky-bottom)
```

Article pages keep their existing layout. Only the sidebar change carries over.

## Config schema additions

### `shared-types/src/config.ts`

```ts
interface ThemeColors {
  // … existing fields
  nav_link_hover?: string;   // defaults to accent
}

interface Layout {
  hero: { enabled: boolean; count: number };
  must_reads: { enabled: boolean; count: number };
  whats_new: { enabled: boolean; count: number };   // new — default { enabled: true, count: 4 }
  more_on:   { enabled: boolean; page_size: number }; // new — default { enabled: true, page_size: 8 }
  load_more: { page_size: number };                 // default changes 10 → 4
  sidebar_topics: { auto: boolean; explicit: string[] };
}
```

Defaults in the resolver — when a site.yaml omits the new fields, the resolved config carries `whats_new: { enabled: true, count: 4 }`, `more_on: { enabled: true, page_size: 8 }`, `load_more.page_size: 4`. Sites that have an explicit `load_more.page_size: 10` keep that value.

### Example resolved `site.yaml`

```yaml
theme:
  colors:
    primary: "#6EC1E4"
    accent:  "#65645d"
    nav_link_hover: "#f4c542"   # optional
layout:
  hero:       { enabled: true,  count: 4 }
  must_reads: { enabled: true,  count: 5 }
  whats_new:  { enabled: true,  count: 4 }
  more_on:    { enabled: true,  page_size: 8 }
  load_more:  { page_size: 4 }
```

## Dashboard changes

### `SiteThemeTab.tsx`

- Advanced text colors section grows by one `ColorPickerField` for `nav_link_hover`. Helper text: "Menu item color on hover. Defaults to accent."
- Layout panel grows by two blocks ("What's New" and "More on …"), matching the structure of the existing Hero and Must Reads blocks (enabled toggle + count number input). For More on, the field is labelled "Initial articles" (page_size).
- The existing "Load more page size" field gets its default state changed from 10 → 4.

### `app/api/sites/save/route.ts`

The `configUpdates.layout` and `configUpdates.theme_colors` branches already pass the values through wholesale ([line 105-113](../../services/dashboard/src/app/api/sites/save/route.ts) for colors, [line 129-131](../../services/dashboard/src/app/api/sites/save/route.ts) for layout). No new explicit branches needed — `nav_link_hover` rides inside `theme_colors`, and `whats_new` / `more_on` ride inside `layout`.

### Wizard defaults

[`actions/wizard.ts`](../../services/dashboard/src/actions/wizard.ts) seeds new sites with default theme + layout. Add `nav_link_hover` (omitted by default — let it fall back to accent), `whats_new` and `more_on` blocks, and switch `load_more.page_size` default to 4.

## Migration / backfill

None required. Every change is opt-in by default-fallback:

- `nav_link_hover` missing → falls back to accent → identical to today.
- `whats_new` missing → resolver fills `{ enabled: true, count: 4 }`.
- `more_on` missing → resolver fills `{ enabled: true, page_size: 8 }`.
- `load_more.page_size` missing → resolver fills 4. Sites with an explicit 10 keep 10 (so existing wineoceans config keeps current pagination behavior unless edited).
- Footer logo R2 path fix takes effect after the next `seed-kv` run; the dashboard "Save" already triggers seed-kv via the GitHub workflow.

## Testing

- Vitest unit tests for `selectFeatured` with `fallbackOrder: 'random'` — verify tagged articles still come first, fallback pool shuffles, and `exclude` is respected.
- Unit tests for `sliceMoreOn` / `hasMoreOnAfter` — boundaries at page 1, page 2, end of list.
- Snapshot or DOM tests for `WhatsNewGrid` and `MoreOnSection` — verify card count, container ids, that LoadMoreButton renders only when there are more articles.
- Integration smoke against `wineoceans` (`pnpm dev` on site-worker, KV seeded from local network repo): logo at 96px renders without overflow; footer with a separately uploaded footer logo renders correctly; switching off `whats_new.enabled` hides the section cleanly.
- Manual visual check against the BuzzSoaps screenshots for parity on grid spacing / 2-col layout.

## Open questions

None at design time. Anything that needs a judgment call during implementation (e.g., exact card aspect ratio in `WhatsNewCard`, whether `ArticleFeed.astro` still has any callers) is called out inline above so the implementer resolves it with the code in front of them rather than guessing from this doc.
