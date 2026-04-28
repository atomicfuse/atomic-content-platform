# Layout v2 & Per-Site Theme Controls — Design

**Date:** 2026-04-27
**Status:** Design approved, ready for plan
**Author:** Michal + Claude
**Touches:** `packages/site-worker`, `packages/shared-types`, `services/dashboard`, `atomic-labs-network/org.yaml`

## Goal

Replace the current "Latest Articles grid" homepage with a magazine-style layout (sticky header → hero grid → 2-col What's New + sticky sidebar → Must Reads band → More On grid → Load More → footer). Apply a matching layout to article pages (header band → 2-col body + sticky sidebar → full-width newsletter band → Related Posts → footer). Same structural layout across all sites in the network — only the brand colors and fonts vary.

Add per-site control surfaces so each site picks its own:

- Theme variant (visual shell — only `modern` exists initially; framework supports more)
- Main color (header / nav band) and Accent color (CTA / newsletter band)
- Heading and Body font (curated registry of ~12 Google Fonts)
- Layout knobs (hero count, must-reads enabled, sidebar topics, load-more page size)

These are configurable in the new-site wizard and editable later in a new "Theme" sub-tab on the site detail page. Defaults flow through the existing 5-layer config inheritance chain (`org → groups → overrides/config → site`).

## Non-goals

- Shared pages (`/about`, `/privacy`, etc.) keep their current layout. Defer to a follow-up.
- WYSIWYG drag-drop layout editor — `layout.*` toggles only.
- Per-page theming — theme is per-site, not per-page.
- Custom font upload — Google Fonts only (free-text fallback for power users still works).
- Drag-to-reorder featured articles in the dashboard — set the frontmatter flag instead.
- A/B testing of layout variants.
- Newsletter double-opt-in (current handler stays single-opt-in).

## 1 — Architecture & Theme System

### Two-tier model

| Lives in **theme variant** (code, e.g. `themes/modern/`) | Lives in **site.yaml** (data, per-site)         |
|---------------------------------------------------------|-------------------------------------------------|
| Layout structure (header style, sidebar position, hero shape) | `theme.base: modern` (which variant)      |
| Component markup (Header, ArticleHero, MustReads, …)    | `theme.colors.primary` (header / main color)    |
| Neutral palette tokens (`--bg`, `--text`, `--surface`, `--border`, `--muted`) | `theme.colors.accent` (CTA color) |
| Typography scale, spacing, radii                        | `theme.fonts.heading` / `theme.fonts.body`      |
| `theme.css`                                             | `theme.logo` / `theme.favicon`                  |

A theme variant is a *shell*. It owns layout and the neutral palette. The site picks 2 colors and 2 fonts; these flow as CSS custom properties. Adding a new variant later = drop a folder under `themes/<name>/` with its own `theme.css` + components, and register it in `themes/registry.ts`.

### Color flow at runtime

`BaseLayout.astro` already injects `theme.colors` as `--color-*` and `theme.fonts.*` as `--fontHeading` / `--fontBody`. We keep that. Variant `theme.css` reads only `--color-primary` and `--color-accent`, plus its own neutral tokens. Result: same site.yaml works on any variant; switching `theme.base` from `modern` → `editorial` re-skins without touching colors.

### Font registry

`services/dashboard/src/lib/font-registry.ts`:

```ts
export const FONT_REGISTRY = [
  { id: "inter",        family: "Inter",            category: "sans-serif", weights: [400,500,600,700] },
  { id: "poppins",      family: "Poppins",          category: "sans-serif", weights: [400,500,600,700] },
  { id: "manrope",      family: "Manrope",          category: "sans-serif", weights: [400,500,600,700] },
  { id: "dm-sans",      family: "DM Sans",          category: "sans-serif", weights: [400,500,600,700] },
  { id: "ibm-plex",     family: "IBM Plex Sans",    category: "sans-serif", weights: [400,500,600,700] },
  { id: "source-sans",  family: "Source Sans 3",    category: "sans-serif", weights: [400,500,600,700] },
  { id: "roboto",       family: "Roboto",           category: "sans-serif", weights: [400,500,600,700] },
  { id: "space-grotesk",family: "Space Grotesk",    category: "sans-serif", weights: [400,500,600,700] },
  { id: "lora",         family: "Lora",             category: "serif",      weights: [400,500,600,700] },
  { id: "merriweather", family: "Merriweather",     category: "serif",      weights: [400,700] },
  { id: "playfair",     family: "Playfair Display", category: "serif",      weights: [400,500,600,700] },
  { id: "bebas",        family: "Bebas Neue",       category: "display",    weights: [400] },
] as const;
```

Same module imported by wizard, site settings, and (for free-text validation only) site-worker. Free-text Google Font names still accepted as a fallback.

### Initial scope

Only the `modern` variant is built with the new layout. The registry has one entry. Adding `editorial` / `bold` / `classic` is a follow-up that touches only `themes/` + registry.

## 2 — Page Layouts

All new components live under `packages/site-worker/src/themes/modern/components/`. Each is a small Astro file.

### Homepage

```
┌─ <Header>                                             sticky, --color-primary bg
├─ <HeroGrid articles={featuredHero}>                   4 vertical cards, full-bleed images, white overlay text
├─ <main>
│   ├─ <section class="whats-new">                      max-w-1200, 2-col split @ ≥960px
│   │   ├─ <ArticleFeed articles={page1}>              left col — landscape thumb + title + date + 2-line snippet
│   │   └─ <Sidebar variant="home">                    right col, sticky
│   │       ├─ <AdSlot position="homepage-sidebar">
│   │       └─ <NewsletterBox variant="sidebar">       --color-accent bg, source="homepage"
│   ├─ <MustReads articles={featuredMustRead}>          full-width band, --color-secondary bg
│   │   ├─ left: 1 hero card (image + title + 3-line desc)
│   │   └─ right: 2×2 grid of small thumbs with title overlays
│   ├─ <MoreOn articles={page1}>                        2-col grid, small thumb + title + snippet
│   └─ <LoadMoreButton page=2>                          renders <a href="?page=2"> + JS upgrade
└─ <Footer>                                             dark band, full-width newsletter, social, legal
```

### Article page

```
┌─ <Header>
├─ <ArticleHero article>                                --color-primary bg band
│   ├─ left: title (white) + date (--color-accent)
│   └─ right: featured image, rounded
├─ <main>
│   ├─ <section class="article-body">                   2-col @ ≥960px
│   │   ├─ <ArticleProse>                              left, .prose styles, ends with #tags row
│   │   └─ <Sidebar variant="article">                  right col, sticky
│   │       ├─ <AdSlot position="article-sidebar">
│   │       ├─ <FollowUs>                              --color-primary heading + 4 social icon circles
│   │       └─ <CategoryList topic={t} count=4>        × N (default 2 topics from brief.topics)
│   ├─ <NewsletterBand>                                full-width --color-accent band, source="article"
│   └─ <RelatedPosts articles={related}>               2-col grid, "Related Posts" heading
└─ <Footer>
```

### Shared components

- `HeroGrid` — uses `featured: hero` slugs (auto-fallback: latest 4 visible articles). Hides if zero.
- `MustReads` — uses `featured: must-read` slugs (auto-fallback: 5 next-latest after hero). Hides if `layout.must_reads.enabled: false`.
- `Sidebar` — single component with `variant="home" | "article"` prop. CSS uses `position: sticky; top: calc(64px + 1rem)`.
- `NewsletterBox` / `NewsletterBand` — both reuse the existing `data-newsletter-form` JS handler in BaseLayout, just different layouts/sources.
- `CategoryList` — receives a topic + count, queries the article index for tagged articles, renders thumb + title list.
- `LoadMoreButton` — renders `<a href="?page=N+1" data-load-more>`. Inline script intercepts click → fetch → append.

### Card variants

Today's `ArticleCard.astro` is a single shape. The new layout has at least 4 distinct shapes. Building them as separate small components — `HeroCard.astro`, `FeedCard.astro`, `ThumbCard.astro`, `MustReadHeroCard.astro` — each ~50 lines, no shared variant CSS. The current `ArticleCard.astro` stays for backwards compat.

### Mobile

All sticky behavior disabled below 960px. Sidebar collapses to bottom of feed. Hero grid stacks 1-column. Must Reads becomes a 1-col list. Tested target range: 375px → 1440px.

### Ad slots

Two new positions: `homepage-sidebar`, `article-sidebar`. Org-level `ads_config.ad_placements` gets defaults; sites inherit, can override or remove via overrides/config layer. Existing positions (`homepage-top`, `sticky-bottom`, `in-content`) keep working.

## 3 — Schema Changes

### `site.yaml`

```yaml
domain: example.com
site_name: Example
# ...existing fields unchanged...

theme:
  base: modern                # existing — drives layout shell + neutral palette
  colors:
    primary: "#243447"        # existing — header / main band color
    accent: "#f4c542"         # existing — CTA / newsletter band color
  fonts:
    heading: "Poppins"        # existing — must be a registry id OR free-text Google Font name
    body: "Inter"             # existing
  logo: /assets/logo.png      # existing
  favicon: /assets/favicon.ico
  layout_v2: true             # NEW — gates new layout per site during rollout

# NEW — layout knobs (all optional, code-level defaults baked in)
layout:
  hero:
    enabled: true
    count: 4                  # 3 | 4 (default 4)
  must_reads:
    enabled: true
    count: 5                  # 1 hero + 4 thumbs
  sidebar_topics:
    auto: true                # if true, derive from brief.topics
    explicit: []              # else use this list
  load_more:
    page_size: 10             # initial render is page_size * 2 (=20), then +page_size per click
```

Inheritance: `layout.*` follows the 5-layer chain. Org defaults live in `org.yaml`. Adding `layout` to `ResolvedConfig` in `shared-types/src/config.ts` + `seed-kv.ts` resolver. Per-field merge mode = `merge` (deep merge).

Code-level defaults when `layout` is absent everywhere: hero enabled count=4, must_reads enabled count=5, sidebar_topics.auto=true, load_more.page_size=10.

### Article frontmatter

```markdown
---
title: TSA Delays Expected for Milwaukee Travelers
slug: tsa-delays-milwaukee
publishDate: 2026-04-25
status: published
description: ...
featuredImage: /assets/...
tags: [news, travel]
type: standard

featured: [hero]              # NEW — optional. one of: hero | must-read | both
---
```

Accepted values: `hero`, `must-read`, or array containing both. Missing/empty = not featured (auto-fallback).

`ArticleIndexEntry` gains `featured?: ("hero" | "must-read")[]`. `seed-kv.ts` reads frontmatter and writes it. No DB migration needed — old articles without the field auto-fill, identical to today.

### Dashboard surface for the new flag

Site Settings → Content → Articles list adds a "Featured" column with a 2-state badge (Hero / Must Read) and row-level edit. Clicking edits the article's frontmatter on the staging branch via the existing `commitFile` path. Out of scope for v1: drag-to-reorder.

### Org-level ad placement defaults

`org.yaml` `ads_config.ad_placements` gains:

```yaml
ads_config:
  ad_placements:
    - id: homepage-sidebar
      type: display
      size: medium-rectangle
    - id: article-sidebar
      type: display
      size: medium-rectangle
```

## 4 — Wizard & Site Settings UI

### Wizard — extend `StepTheme`

Existing `StepTheme.tsx` picks `themeBase` and uploads logo/favicon. Extend (don't add a new step):

```
┌─ Theme variant (existing)        Modern · Editorial · Bold · Classic — only Modern enabled
├─ Logo / Favicon (existing)
│
├─ Brand Colors (NEW)
│   ┌─ Main color    [color swatch] [hex input "#243447"]
│   └─ Accent color  [color swatch] [hex input "#f4c542"]
│
├─ Typography (NEW)
│   ┌─ Heading font  [dropdown: Poppins ▼]   "The quick brown fox" ← live preview
│   └─ Body font     [dropdown: Inter ▼]     "The quick brown fox" ← live preview
│
└─ Live Preview (NEW)
    Static thumbnail (~150px tall) with mock header + hero card + newsletter button,
    wired to the chosen colors + fonts.
```

- Color picker: native `<input type="color">` + adjacent text input that accepts hex, named colors, or rgb. Validated on blur.
- Font dropdown: combobox. Each option renders the family at 16px. Loads the font on hover via dynamic `<link rel="stylesheet">` injection.
- Wizard defaults pulled from `org.yaml` `default_fonts` and a new `default_colors` block (`primary: "#1a1a2e"`, `accent: "#f4c542"`).
- Save: existing `wizard.ts` server action writes site.yaml. New fields = one line each.

### Site Settings — new "Theme" sub-tab

Add **Theme** as a 6th sub-tab between Identity and Content Brief on `/sites/[domain]`. Contents:

```
─ Theme variant tile picker
─ Brand Colors    Main + Accent
─ Typography      Heading + Body
─ Logo / Favicon  moved here from Identity
─ Layout knobs    (NEW)
    Hero          [✓] enabled  Count [3 | 4]
    Must Reads    [✓] enabled
    Sidebar topics  ◉ Auto from brief.topics   ○ Pick: [chips]
    Load more     Page size [10]
─ Live Preview    same thumbnail + "Open Worker Preview" link
─ Inheritance hint
    "Theme is layered on top of org defaults."  ← per-field "Reset to org default" link
```

- Independent Save button (matches current sub-tab pattern).
- Writes via `/api/sites/save` — no new endpoint.
- `SourceBadge` on every field showing where the value comes from.
- Per-field reset writes `null`/missing to site.yaml.

### Org Settings → Defaults

Settings → Org tab UI extended with:

- Default main color (color picker)
- Default accent color (color picker)
- Default heading + body font (dropdowns)
- Default layout knobs (hero count, must-reads enabled, etc.)

These flow to every new site via inheritance. A brand-new site with no theme block in site.yaml renders perfectly using org defaults.

## 5 — Load More API & Newsletter

### Load More

Endpoint on the site-worker (not dashboard): `GET /api/articles?page=N`. Implemented as `packages/site-worker/src/pages/api/articles.ts`. Hostname → siteId resolved by existing middleware.

```ts
export async function GET({ request, locals }) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "2", 10));
  const siteId = locals.siteId;
  const config = locals.config;
  const pageSize = config.layout.load_more.page_size;
  const initialCount = pageSize * 2;        // first page rendered server-side = 20

  const all = (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), "json")) ?? [];
  const visible = all.filter(isVisibleArticle).sort(byDateDesc);

  const start = initialCount + (page - 2) * pageSize;
  const end = start + pageSize;
  const slice = visible.slice(start, end);

  return new Response(renderFeedCards(slice), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
```

**No-JS fallback:** `?page=2` on the homepage URL — `index.astro` reads `?page` and renders the offset slice instead of the initial 20. The `LoadMoreButton`'s `<a href="?page=N+1">` becomes a real navigation. SEO crawlers and reader-mode users walk the full archive.

**JS upgrade:** ~30 lines inline. Click → prevent default → fetch → append response HTML to feed container → increment N → update `<a href>` so middle-click "open in new tab" works.

**Edge cases:**
- Empty slice (past end): API returns 200 empty body; JS hides the button.
- KV miss / read error: API returns 500 with `<!-- error -->` comment; JS shows "Couldn't load more".
- Spam clicks: button disabled while fetch is in flight.

Cache headers match the homepage's existing 60s edge cache. KV eventual consistency caveat (CLAUDE.md landmine #17) applies — newly published articles take ~1 cache window to appear. Acceptable.

### Newsletter unification

`/api/subscribe` → `appendSubscriber()` → Google Sheet exists today. Today only `Footer.astro` has the form. Changes:

1. Move the subscribe-form `<script>` from inline-in-Footer to `BaseLayout.astro` so any form with `data-newsletter-form` works site-wide.
2. New `data-source` values: `homepage` (sidebar box), `article` (yellow band), `footer` (existing).
3. New shared partial `themes/modern/components/_newsletter-form.astro` (leading underscore = not a route) imported by all 3 places. Form markup identical; outer styling differs.

One source of truth, three visual containers, three source values written to the Sheet so we can see which placement converts best.

## 6 — Rollout

**Phase 1 — Schema & types (no UI change).** Add `layout.*` to `ResolvedConfig` + `seed-kv.ts` resolver + defaults. Add `featured` to `ArticleIndexEntry` + frontmatter parser. Ship to staging, verify all existing sites still resolve correctly. Risk: breaking the resolver. Mitigation: every new field optional with code-level default.

**Phase 2 — New components & layout (one site, dark-launched).** Build new Astro components against `coolnews-atl` staging only. Toggle gated by `theme.layout_v2: true` in site.yaml. Old layout untouched on every other site. Verify on staging Worker Preview.

**Phase 3 — Wizard + site-settings UI.** Ship dashboard pickers and the new Theme sub-tab. Defaults flow from `org.yaml`. New sites created from the wizard go straight to the new layout. Existing sites unchanged until someone flips the toggle.

**Phase 4 — Flip remaining sites.** For each existing site, set `theme.layout_v2: true` on staging branch, deploy, sanity-check, merge to main. After all sites migrated, remove the toggle and make the new layout the only path; delete the old templates.

**Estimated effort:** ~3 days Phase 1, ~5 days Phase 2, ~3 days Phase 3, ~1 day Phase 4 cleanup (≈12 days total).

## 7 — Testing

- **Unit (vitest, site-worker):** `resolveLayoutConfig()` defaults; `selectFeatured(articles, layout, 'hero')` fallback logic; `/api/articles` slicing math (page=1, page=N edge cases, empty slice).
- **Snapshot:** render each new component with a fixture article set, lock the markup. ~8 snapshot files.
- **End-to-end smoke (manual on Worker Preview):** wizard creates a new site → site renders correctly with chosen colors/fonts → newsletter form submits → email lands in the Google Sheet → Load More button paginates with JS on, navigates with JS off.
- **Visual check:** screenshot vs. reference designs at 1440px and 375px.

## 8 — Open questions / explicit non-goals

- Per-page caching strategies stay as today.
- Analytics on which Load More page users reach: out of scope.
- Newsletter double-opt-in: out of scope.
- A/B testing of layout variants: out of scope.

## File-touch summary

**New files:**
- `packages/site-worker/src/themes/modern/components/HeroGrid.astro`
- `packages/site-worker/src/themes/modern/components/HeroCard.astro`
- `packages/site-worker/src/themes/modern/components/ArticleFeed.astro`
- `packages/site-worker/src/themes/modern/components/FeedCard.astro`
- `packages/site-worker/src/themes/modern/components/Sidebar.astro`
- `packages/site-worker/src/themes/modern/components/MustReads.astro`
- `packages/site-worker/src/themes/modern/components/MustReadHeroCard.astro`
- `packages/site-worker/src/themes/modern/components/ThumbCard.astro`
- `packages/site-worker/src/themes/modern/components/MoreOn.astro`
- `packages/site-worker/src/themes/modern/components/LoadMoreButton.astro`
- `packages/site-worker/src/themes/modern/components/NewsletterBox.astro`
- `packages/site-worker/src/themes/modern/components/NewsletterBand.astro`
- `packages/site-worker/src/themes/modern/components/_newsletter-form.astro`
- `packages/site-worker/src/themes/modern/components/ArticleHero.astro`
- `packages/site-worker/src/themes/modern/components/FollowUs.astro`
- `packages/site-worker/src/themes/modern/components/CategoryList.astro`
- `packages/site-worker/src/themes/modern/components/RelatedPosts.astro`
- `packages/site-worker/src/themes/registry.ts`
- `packages/site-worker/src/pages/api/articles.ts`
- `packages/site-worker/src/lib/featured.ts` (selectFeatured helper)
- `services/dashboard/src/lib/font-registry.ts`
- `services/dashboard/src/components/wizard/ColorPickerField.tsx`
- `services/dashboard/src/components/wizard/FontPickerField.tsx`
- `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`
- `services/dashboard/src/components/site-detail/LayoutKnobsForm.tsx`
- `services/dashboard/public/guide/13-theme-and-layout.md`

**Modified files:**
- `packages/shared-types/src/config.ts` — add `LayoutConfig`, extend `ResolvedConfig`
- `packages/shared-types/src/article.ts` — add `featured` to `ArticleIndexEntry`
- `packages/site-worker/scripts/lib/resolve.ts` — resolve `layout.*` chain
- `packages/site-worker/scripts/seed-kv.ts` — read `featured` frontmatter
- `packages/site-worker/src/pages/index.astro` — switch to new layout when `layout_v2`
- `packages/site-worker/src/pages/[slug]/index.astro` — switch to new layout when `layout_v2`
- `packages/site-worker/src/layouts/BaseLayout.astro` — site-wide newsletter handler
- `packages/site-worker/src/themes/modern/components/Header.astro` — use `--color-primary` for bg
- `packages/site-worker/src/themes/modern/components/Footer.astro` — use shared `_newsletter-form`
- `packages/site-worker/src/themes/modern/styles/theme.css` — new tokens, no breaking changes
- `services/dashboard/src/components/wizard/StepTheme.tsx` — colors + fonts + preview
- `services/dashboard/src/app/sites/[domain]/page.tsx` — register Theme sub-tab
- `services/dashboard/src/app/settings/page.tsx` — Org Defaults additions
- `services/dashboard/src/actions/wizard.ts` — write new fields to site.yaml
- `services/dashboard/src/app/api/sites/save/route.ts` — accept new fields
- `atomic-labs-network/org.yaml` — `default_colors`, default ad placements, default `layout`
