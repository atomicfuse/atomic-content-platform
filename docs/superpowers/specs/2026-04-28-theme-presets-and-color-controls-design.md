# Theme Presets & Expanded Color Controls

**Date:** 2026-04-28
**Status:** Approved

## Problem

1. Dashboard Theme tab shows site-level defaults, not resolved inherited colors (group colors invisible)
2. No presets — users must manually pick every color
3. No granular text color control for individual elements

## Solution

### 1. Show Inherited Colors

The Theme tab loads from the resolved config API (`/api/sites/site-config`) which returns `{ config, inheritance }`. The tab reads `config.theme.colors` which already contains the merged result from the inheritance chain (org → groups → overrides → site). All color pickers pre-fill with the effective resolved value.

This fixes the issue where coolnews-atl shows `#1a1a2e` in the dashboard when the actual resolved color is `#E50914` from the entertainment group.

### 2. Six Theme Presets

Preset selector appears at the top of the Theme tab. Each preset populates all 20 color fields.

| Preset | Primary | Accent | Background | Secondary | Text | Muted |
|--------|---------|--------|------------|-----------|------|-------|
| Classic News | #1a1a2e | #f4c542 | #ffffff | #1a1a2e | #1a1a2e | #6b7280 |
| Bold Dark | #E50914 | #B81D24 | #141414 | #1a1a2e | #ffffff | #8C8C8C |
| Ocean Editorial | #0f4c81 | #10b981 | #f8fafc | #0f172a | #0f172a | #64748b |
| Warm Magazine | #7c2d12 | #ea580c | #fffbeb | #1c1917 | #1c1917 | #78716c |
| Elegant Slate | #334155 | #6366f1 | #ffffff | #1e293b | #1e293b | #94a3b8 |
| Midnight Purple | #581c87 | #a855f7 | #0f0720 | #1e1038 | #f0e6ff | #a78bfa |

Plus "Custom" (no preset applied, manual control).

Behavior:
- Clicking a preset fills ALL color fields below with preset values
- User can then tweak any individual color
- Tweaking any color auto-switches the preset indicator to "Custom"

### 3. Color Groups — Compact + Collapsible Advanced

#### Always visible (11 pickers)

**Brand Colors (2):**
- `primary` — Main color (header / nav)
- `accent` — Accent color (CTA / newsletter)

**Section Backgrounds (3):**
- `background` — Page background
- `footer_bg` — Footer background (falls back to `secondary`)
- `must_reads_bg` — Must Reads background (falls back to `secondary`)

**Text Colors (6):**
- `text` — Headings & body text
- `muted` — Dates, meta text
- `primary` (reused) — Links color (same as primary)
- `border` — Border color
- `surface` — Card/surface background
- `secondary` — Dark sections fallback

#### Behind "Show advanced text colors" toggle (9 pickers)

**On dark overlays (3):**
- `hero_title` — Hero card title (default: `#ffffff`)
- `must_reads_title` — Must Reads card title (default: `#ffffff`)
- `article_hero_title` — Article hero title (default: `#ffffff`)

**Feed cards (3):**
- `feed_title` — Feed card title (default: inherits `text`)
- `feed_desc` — Feed card description (default: inherits `text`)
- `feed_date` — Feed card date (default: inherits `muted`)

**Article page (3):**
- `prose_heading` — Prose h2/h3 headings (default: inherits `text`)
- `prose_body` — Prose paragraph text (default: inherits `text`)
- `category_header_text` — Category list header text (default: `#ffffff`)

### 4. CSS Variable Mapping

New CSS custom properties added to `theme.css` `@layer theme-defaults` block. Each component updated to use its specific variable with a fallback chain:

```css
@layer theme-defaults {
  :root {
    /* ...existing color vars... */
    --color-hero_title: #ffffff;
    --color-must_reads_title: #ffffff;
    --color-article_hero_title: #ffffff;
    --color-feed_title: var(--color-text, #1a1a2e);
    --color-feed_desc: var(--color-text, #1a1a2e);
    --color-feed_date: var(--color-muted, #6b7280);
    --color-prose_heading: var(--color-text, #1a1a2e);
    --color-prose_body: var(--color-text, #1a1a2e);
    --color-category_header_text: #ffffff;
  }
}
```

BaseLayout.astro already loops over all `theme.colors` keys and emits `--color-<key>` CSS vars — no changes needed there.

### 5. Preset Data Structure

Each preset is a plain object with all color keys:

```typescript
interface ThemePreset {
  id: string;
  name: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
    secondary: string;
    text: string;
    muted: string;
    surface: string;
    border: string;
    footer_bg: string;
    must_reads_bg: string;
    hero_title: string;
    must_reads_title: string;
    article_hero_title: string;
    feed_title: string;
    feed_desc: string;
    feed_date: string;
    prose_heading: string;
    prose_body: string;
    category_header_text: string;
  };
}
```

Presets are defined as a const array in the dashboard component — no backend storage needed.

### 6. Save Flow

Save writes all color keys to `theme.colors` in site.yaml via the existing `/api/sites/save` endpoint with `configUpdates.theme_colors`. The save route already does `theme.colors = configUpdates.theme_colors` which replaces the entire colors object.

After saving, the user re-seeds KV to see changes on the live site (same workflow as today).

## Files Touched

### Dashboard (`services/dashboard/`)
- `src/components/site-detail/SiteThemeTab.tsx` — rewrite with presets, expanded color groups, resolved config loading

### Worker (`packages/site-worker/`)
- `src/themes/modern/styles/theme.css` — add 9 new CSS var defaults in `@layer theme-defaults`
- `src/themes/modern/components/HeroCard.astro` — use `var(--color-hero_title, #fff)`
- `src/themes/modern/components/MustReadHeroCard.astro` — use `var(--color-must_reads_title, #fff)`
- `src/themes/modern/components/ThumbCard.astro` — use `var(--color-must_reads_title, #fff)`
- `src/themes/modern/components/FeedCard.astro` — use `--color-feed_title`, `--color-feed_desc`, `--color-feed_date`
- `src/themes/modern/components/ArticleHero.astro` — use `var(--color-article_hero_title, #fff)`
- `src/themes/modern/components/CategoryList.astro` — use `var(--color-category_header_text, #fff)`
- `src/themes/modern/styles/theme.css` — `.prose h2/h3` use `--color-prose_heading`, `.prose p` use `--color-prose_body`

## Non-Goals

- Live preview in the dashboard (future)
- Auto-seed KV on save (future — currently manual)
- Dark mode toggle on the live site (colors are set per-site, not per-visitor)
