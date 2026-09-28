# Grid template: design direction

**Design read:** a content-dense news feed (dazzr.com/topic/news style) for scanning readers on phone and desktop, in a calm, utilitarian card language: cool page background, white cards, one accent, no decoration. Dials: variance 3, motion 4, density 6. The cards and the photos inside them carry the page. Chrome stays quiet.

Reference measured from dazzr (2026-09-28): page max 1630px, 12px grid gap, 12px card radius, image radius = card radius minus 3px, 16px source favicon, card headline 1.1rem/700/1.2, intro 1rem at reduced opacity, hover shadow `0 4px 16px rgb(0 0 0/.08)`, `#F1F4F8` page, `#281848` text, `#6C35BB` accent.

## Tokens and constraints (hard rules)
- Use only the `--g-*` tokens in `grid.css` (they map to `theme.colors` via `--color-*`, with fallbacks). No raw hex in component rules. Shadows are tinted from `--g-text` with `color-mix()`, never pure black.
- Every selector is `.g-*` or `body.g-body …`. grid.css loads only through GridLayout, so modern pages are never touched.
- No new fonts: headings use `theme.fonts.heading` (h1-h6 rule in the layout), body uses `theme.fonts.body`.
- One radius system: cards `--g-radius` 12px, images `--g-radius-img` 9px, interactive pills and search `--g-radius-pill`.

## Type scale
| Role | Size | Weight / leading |
|---|---|---|
| Card headline | `clamp(1rem, .95rem + .25vw, 1.15rem)` | 700 / 1.25, clamped to 3 lines |
| Card intro | 1rem (0.95rem compact) | 400 / 1.45, clamped to 2 lines, opacity .7 |
| Source line | .85rem | 500 / 1.2, `--g-muted` |
| Story H1 | `clamp(1.75rem, 1.2rem + 2.4vw, 2.75rem)` | 700 / 1.15, `text-wrap: balance`, inside a 760px story column |
| Summary H2 | `clamp(1.3rem, 1.1rem + .9vw, 1.7rem)` | 700 / 1.25 |
| Summary H3 | `clamp(1.1rem, 1rem + .45vw, 1.3rem)` | 700 / 1.3 |
| Story body | 1.0625rem | 400 / 1.65, max 68ch |

## Spacing
4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Grid gap `--g-gap` 12px at all widths (dense feed). Page gutter `--g-gutter` = `clamp(12px, 2vw, 24px)`. Main padding 16px top, 48px bottom. Grid columns `auto-fill, minmax(min(280px, 100%), 1fr)`: 1 column at 390px, 4 at 1280px, 5 at the 1630px cap.

## Card anatomy
- Card: `--g-card-bg`, 1px `--g-card-border`, 12px radius, `overflow: hidden`, full row height.
- Media: inset 8px on top and sides (image floats inside the card, dazzr style), `aspect-ratio: var(--g-img-ratio)` (4/3 default) reserved before load (CLS 0), 9px radius, `--g-border` placeholder fill.
- Body: padding 10px 12px 14px, 8px row gap.
- Source line: 16px favicon (3px radius) or a 16px accent letter tile, 6px gap, .85rem site name, ellipsis on overflow.
- Headline: 3-line clamp. Intro: 2-line clamp.
- Hover: tinted shadow `0 6px 24px` over .3s ease-out (no layout change). Press: `translateY(1px)`. Pinned: accent border.
- Ad tiles: same radius, max 300px high, never wider than a card cell.

## Header anatomy (Task 10)
Logo row (logo left, max `--logo-height`), then a full-width search field (`--g-search-bg`, pill radius, 44px min height, visible label for screen readers), then a pill row of topics: 44px min touch height, 8px gaps, `--g-pill-*` colours, active pill uses `--g-pill-active-bg/text`. On mobile the pill row scrolls horizontally (`overflow-x: auto`, `scroll-snap-type: x proximity`, hidden scrollbar, edge fade); the page itself never scrolls sideways.

## Motion
Cards enter with a 0.8s `cubic-bezier(.22,1,.36,1)` (`--g-ease`) fade-in-up of 16px. Stagger is 60ms per card via the inline `--g-i` index (callers reset `--g-i` per appended batch so infinite-scroll pages don't wait). Only `opacity` and `transform` animate. Under `prefers-reduced-motion: reduce` all entrance animation and the press transform are disabled and cards render at full opacity.

## Focus and accessibility
- `:focus-visible` = 2px solid `--g-accent` ring, 2px offset. On the card link the ring is inset (`outline-offset: -2px`) so `overflow: hidden` can't clip it.
- Contrast on default tokens (white `--g-card-bg`): headline `#281848` 15.9:1, `--g-muted` `#6b6680` 5.5:1, intro at opacity .7 6.0:1 (opacity .6 gave 4.4:1 and failed AA, so .7 is the floor), accent `#6c35bb` 7.3:1. Sites overriding colours must keep text on `--g-card-bg` at 4.5:1 or higher.
- Touch targets 44px minimum, all tap targets 8px apart. Images need `alt`; the favicon is decorative (`alt=""`).
- Body `min-height: 100dvh` (100vh fallback). No horizontal page scroll at 390px.
