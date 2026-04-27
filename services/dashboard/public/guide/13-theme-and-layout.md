# Theme & Layout

## Overview

Layout v2 introduces a magazine-style design with a hero grid, must-reads band, paginated article feed, and sticky sidebar. Each site can customise brand colours, fonts, and layout knobs through its **Theme** tab (Site Settings > Theme) or inherit org-wide defaults (Settings > Defaults).

## Theme Variants

Currently one variant is enabled:

| Variant | Status | Description |
|---------|--------|-------------|
| **modern** | Enabled | Clean, minimal design with bold typography |
| editorial | Planned | Magazine-style layout with rich media support |
| bold | Planned | High-contrast, image-heavy with strong CTAs |
| classic | Planned | Traditional blog layout, content-first approach |

## Two-Colour Model

Every site uses two colours:

- **Primary** (`theme.colors.primary`) — header bar, navigation background, dark sections (Must Reads, Article Hero).
- **Accent** (`theme.colors.accent`) — call-to-action buttons, newsletter band, date highlights, hover effects.

Defaults: primary `#1a1a2e`, accent `#f4c542`. Set org-wide in Settings > Defaults, or per-site in Theme tab.

## Font Registry

Sites pick from a curated set of Google Fonts. Each font is loaded on demand via the Google Fonts CSS API.

Available fonts: Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Nunito, Merriweather, Lora, Playfair Display, Pacifico.

Fonts are split into heading and body slots:

- **Heading font** (`theme.fonts.heading`) — used for article titles, section headings, the logo text fallback.
- **Body font** (`theme.fonts.body`) — used for article body text and general UI copy.

## Layout Knobs

These control the magazine layout structure and are set under the `layout` key in site.yaml (or org.yaml for defaults):

| Knob | Key | Default | Notes |
|------|-----|---------|-------|
| Hero grid | `layout.hero.enabled` | `true` | Toggle the hero image grid on the homepage |
| Hero count | `layout.hero.count` | `4` | Number of hero cards (3 or 4) |
| Must Reads | `layout.must_reads.enabled` | `true` | Toggle the dark Must Reads band |
| Must Reads count | `layout.must_reads.count` | `5` | 1 large + N-1 small cards |
| Sidebar topics | `layout.sidebar_topics.auto` | `true` | Auto-select from brief topics |
| Sidebar topics list | `layout.sidebar_topics.explicit` | `[]` | Manual topic list when auto is off |
| Page size | `layout.load_more.page_size` | `10` | Articles per "Load More" batch |

## Featured Frontmatter

Articles can be pinned to hero or must-read slots via YAML frontmatter:

```yaml
---
title: My Article
featured: hero
---
```

Valid values: `hero`, `must-read`, or an array like `[hero, must-read]`.

When there aren't enough articles with `featured` frontmatter, `selectFeatured()` auto-fills from the most recent articles. This means the layout always looks full even on a fresh site with no manually-featured content.

## Enabling Layout v2 on Existing Sites

New sites created via the wizard automatically get `layout_v2: true`. For existing sites:

1. Open the site's staging branch `sites/<domain>/site.yaml`
2. Add under `theme:`:
   ```yaml
   theme:
     layout_v2: true
     colors:
       primary: "#1a1a2e"
       accent: "#f4c542"
   ```
3. Commit and push. The sync-kv workflow will update CONFIG_KV.
4. Preview via the Worker Preview button in the dashboard.
5. When satisfied, publish staging to production.

## Config Inheritance

Theme colours, fonts, and layout knobs follow the standard 5-layer inheritance:

```
org.yaml > groups > overrides/config > site.yaml
```

Org defaults are set in Settings > Defaults. Per-site values always win.

## Troubleshooting

**Layout looks like the old design**
- Check `theme.layout_v2` is `true` in the site's config (CONFIG_KV).
- Run `pnpm seed:kv <siteId>` to re-seed if needed.

**Colours don't appear**
- Verify `theme.colors.primary` and `theme.colors.accent` are valid hex values.
- Check browser DevTools for CSS custom property `--color-primary` and `--color-accent`.

**Fonts not loading**
- The font must be in the font registry. Custom Google Fonts outside the registry are not supported yet.
- Check the Network tab for failed requests to `fonts.googleapis.com`.

**Hero grid shows fewer articles than expected**
- `selectFeatured()` needs at least N published articles to fill the grid. Check the article count.
- Articles with `status: draft` are excluded from the index.
