# Theme Color Presets — Expansion Plan

**Date:** 2026-06-02
**Status:** Proposal — decisions locked, awaiting build approval
**Goal:** Expand the theme picker from 6 presets to ~16 sophisticated, vertical-targeted options, including a new "gradient" tier — at minimal engineering cost.

---

## Decisions confirmed (2026-06-02)

1. **16 presets is the cap for v1.** No filter chips, no search. If we want more later, add a filter row then.
2. **Existing live sites are NOT migrated.** They keep their current `theme.colors` exactly. New presets only affect (a) new sites via wizard, (b) existing sites where the owner manually picks a new preset.
3. **Gradient fields are hidden in the manual color editor.** SiteThemeTab's `<ColorPickerField>` list explicitly excludes `*_gradient` keys. Presets are the only way to set them. Power users can still edit `site.yaml` directly.
4. **Add a "Surprise me" button.** Picks a random preset (excluding the currently selected one). Lives in the wizard step header and in SiteThemeTab — design spec below.

---

## Shipping discipline

**This plan implements code only.** No commit, push, `cloudgrid plug`, deploy, `sync-kv` trigger, or re-seed happens without Asaf's explicit approval per request. Implementation lands on `asaf-new` (or a feature branch) for local testing first. Re-seed is a deliberate post-deploy step Asaf will trigger manually.

---

## Why now

Today's 6 presets (Classic News, Bold Dark, Ocean Editorial, Warm Magazine, Elegant Slate, Midnight Purple) cluster around navy/slate. They leave whole verticals unserved: food, wellness, lifestyle, sports, entertainment, luxury, crypto. New site setup defaults to Classic News even for a wine site or sports site, then sits unchanged — most owners never customize colors after wizard completion.

Expanding presets is the highest-leverage way to make new sites feel *designed for their vertical* without asking the user to pick 25 colors by hand.

---

## Scope (why it's cheap)

The architecture is already gradient-friendly because of two existing pieces:

1. **`theme.colors` is `Record<string, string>`** (`services/dashboard/src/types/dashboard.ts:132`). No fixed shape — any new key flows through the 5-layer config merge unchanged.
2. **CSS vars are emitted generically** in `packages/site-worker/src/layouts/BaseLayout.astro:55-57`:
   ```ts
   Object.entries(theme.colors).map(([k, v]) => `--color-${k}: ${v};`)
   ```
   Add `footer_bg_gradient: "linear-gradient(...)"` and `--color-footer-bg-gradient` appears in rendered HTML automatically. The worker doesn't need to know it's a gradient — it's just a CSS value.

### Files to touch

| File | Change |
|------|--------|
| **NEW** `services/dashboard/src/components/wizard/themePresets.ts` | Extract `PRESETS` + `ColorState` + `ALL_COLOR_KEYS` + `GRADIENT_KEYS` + `detectPreset()` into a shared module. Both StepTheme and SiteThemeTab import from here. Prevents the existing key-drift (see Breakage #1). |
| `services/dashboard/src/components/wizard/StepTheme.tsx` | Import from shared module. Rewrite preset picker UI (see Picker UX spec below). Add Surprise Me button. |
| `services/dashboard/src/components/site-detail/SiteThemeTab.tsx` | Import from shared module. Filter `*_gradient` keys out of the manual editor's `<ColorPickerField>` list. Add Surprise Me button. |
| `packages/site-worker/src/themes/modern/components/Footer.astro` | `background: var(--color-footer-bg-gradient, var(--color-footer-bg));` |
| `packages/site-worker/src/themes/modern/components/MustReads.astro` | Same fallback pattern for `--color-must-reads-bg` |
| `packages/site-worker/src/themes/modern/components/HeroCard.astro` | Themeable scrim via `--color-hero-overlay-gradient` (currently hardcoded `rgba(0,0,0,0.75)` at line 37) |
| `packages/site-worker/src/themes/modern/components/MustReadHeroCard.astro` | Same as HeroCard |
| **Post-deploy (manual, Asaf-triggered):** re-seed live sites via `sync-kv.yml` `force_all: true` | Not done by this PR |

**Schema, type, resolve, seed scripts: no changes.**

### Things deliberately NOT in scope

- **Gradient picker UI** — presets only in v1. Manual color editor stays the same flat hex input. Users can't author custom gradients. If real demand surfaces later, add it then.
- **Reorganizing existing presets** — keep all 6 current ones working unchanged to avoid migration churn for live sites.
- **Theme-level gradient on `--color-background`** — page-level gradients age fast and clash with image-heavy editorial. Keep gradients on hero scrims, footers, and accent strips only.

### Breakage analysis

Audited every code path that touches `theme.colors`. Each risk has a concrete mitigation already baked into the plan.

| # | Risk | Why it's mitigated |
|---|------|-------------------|
| 1 | **`ColorState` is out of sync today.** `SiteThemeTab.tsx` has 3 keys (`nav_link`, `nav_link_hover`, `subscribe_heading`) that `StepTheme.tsx` doesn't. If we duplicate presets into both files, those 3 keys silently fall to defaults from the wizard. | Shared `themePresets.ts` module — one source of truth. The presets ship the full 28-key set; both consumers import. Fixes the pre-existing drift as a side effect. |
| 2 | **Stale KV configs lack gradient keys.** Every live site's KV blob was written before this PR exists. | CSS var fallback: `background: var(--color-footer-bg-gradient, var(--color-footer-bg))`. Missing var → CSS uses the solid. No crash, no visual change. Sidesteps landmine #38 — which is specifically about *runtime code* accessing undefined config fields; CSS vars degrade gracefully. |
| 3 | **`detectPreset()` uses `ALL_COLOR_KEYS.every(...)` equality** ([StepTheme.tsx:144-149](services/dashboard/src/components/wizard/StepTheme.tsx#L144-L149)). Adding gradient keys to this list would force *every* preset (including solid ones) to define them, or detection breaks. | Keep `ALL_COLOR_KEYS` as the solid-only match basis. `GRADIENT_KEYS` is a separate optional list. Gradient values are applied on `applyPreset()` but ignored by `detectPreset()`. Result: editing solid colors still correctly matches to / falls out of a preset. |
| 4 | **YAML round-trip of gradient strings.** YAML's `stringify()` strips quotes (landmine #40). A gradient like `linear-gradient(135deg, #1a1a2e, #0f0720)` contains commas and parens that could trip an unquoted-string parser. | Verified: the `yaml` lib quotes any string containing `,` `(` `)` `:` automatically when re-stringifying. Already used pattern (e.g. inline scripts in `site.yaml`). |
| 5 | **Inline backgrounds bypass CSS vars.** If `Footer.astro` ever sets `style="background: #fff"` inline, gradients won't apply. | Audit confirms current Footer/MustReads/HeroCard/MustReadHeroCard all use CSS classes referencing `var(--color-*)`. No inline backgrounds. |
| 6 | **Existing presets disappearing or being renamed.** Would orphan sites that have `themePreset: "classic"` stored. | All 6 existing presets kept verbatim with same IDs (`classic`, `bold`, `ocean`, `warm`, `slate`, `midnight`). Additive only. |
| 7 | **Manual editor showing gradient keys.** A `<input type="color">` rendered for `footer_bg_gradient: "linear-gradient(...)"` would crash or silently corrupt the value. | SiteThemeTab editor explicitly filters `GRADIENT_KEYS` out of the rendered field list. |
| 8 | **Config overrides merging with new gradient keys.** Per-site `overrides/config/*.yaml` deep-merge into `theme.colors`. | Deep merge on a string-keyed map adds new keys without colliding. Tested mentally against `resolve.ts` merge logic. |
| 9 | **Old browsers + multi-stop gradients.** Three-stop linear-gradients are CSS3 — universal support since 2013. Conic gradients (not used in v1 presets) would need a fallback. | All proposed gradients are 2–3 stop linear or radial — universally supported. |
| 10 | **The `themePreset` field on a new gradient preset.** New IDs (`aurora`, `sunset_strip`, `art_deco_brass`, etc.) get written to `site.yaml`. Older site-worker deploys that haven't shipped the gradient component changes would still render correctly (they'd use the solid colors from the preset). | Backwards-compatible by construction. |

**Verdict:** safe to ship behind normal staging verification. No data migration, no destructive operation, no schema change.

### Estimate

**~½ day** end-to-end:
- 1 hour: 4 component CSS lines
- 2 hours: write the preset map (color choices below are done)
- 30 min: grouping/labels in picker UI
- 30 min: re-seed + staging verification
- 1 hour: visual QA across hero/footer/must-reads on staging worker

---

## The presets

16 total, grouped into 4 tiers. Each preset specifies the full ~25-color map; only the most expressive 4–6 fields are shown here for readability. **Bold = new.** Italic = existing, unchanged.

Color choices are anchored on validated palettes from the UI/UX color database where applicable (editorial pink, luxury gold, fintech crypto, food orange, wellness lavender) and tuned for the editorial/news context of this platform — i.e. emphasis on reading legibility, hero image scrims, and a single accent that doesn't fight photography.

### Tier 1 — Editorial Light (5)

Designed for daily-read sites. Cool, high-legibility, restrained accents.

| Name | Primary | Accent | Bg | Footer Bg | Vibe / Vertical |
|------|---------|--------|----|-----------|--------------|
| *Classic News* | `#1a1a2e` | `#f4c542` | `#ffffff` | `#1a1a2e` | Navy + gold — current default |
| **Newsprint** | `#0a0a0a` | `#c8102e` | `#faf7f2` | `#0a0a0a` | Single-red broadsheet on warm paper; one bold accent against pure black ink — strongest "real newspaper" reading of the set |
| **Editorial Black** | `#18181b` | `#ec4899` | `#fafafa` | `#18181b` | Magazine-grade neutral with a single magenta — culture, longform, opinion. Sourced from the validated `#18181B / #EC4899` editorial palette. |
| *Ocean Editorial* | `#0f4c81` | `#10b981` | `#f8fafc` | `#0f172a` | Blue + teal editorial |
| *Elegant Slate* | `#334155` | `#6366f1` | `#ffffff` | `#1e293b` | Soft slate + indigo |

### Tier 2 — Lifestyle & Vertical Light (5)

Each anchored on a vertical-correct hue family. None reuse the same accent.

| Name | Primary | Accent | Bg | Footer Bg | Vibe / Vertical |
|------|---------|--------|----|-----------|--------------|
| *Warm Magazine* | `#7c2d12` | `#ea580c` | `#fffbeb` | `#1c1917` | Warm cream/orange |
| **Botanical** | `#1f3d2b` | `#7a9a6a` | `#f7f5ee` | `#1f3d2b` | Forest + sage on bone — wellness, food, sustainability. Greens are split-complementary (deep + muted) so the accent never shouts. |
| **Mocha** | `#3d2817` | `#a06b3a` | `#f4ede4` | `#2a1810` | Espresso + caramel on oat — coffee, food, recipes. Warmer than Terracotta, less editorial than Warm Magazine. |
| **Coastal Air** | `#1e3a5f` | `#06b6d4` | `#f4f7f9` | `#0c1f33` | Deep navy + cyan on cool white — travel, leisure. Lighter and more aerated than Ocean Editorial. |
| **Rose Garden** | `#831843` | `#ec4899` | `#fff7f9` | `#581c3b` | Deep rose + bright pink on blush — fashion, beauty. Tonal monochrome (analogous pink-magenta) reads as intentional, not "girly default." |

### Tier 3 — Premium & Technical (3)

Restrained, high-contrast, professional. Distinct from Tier 1 by minimizing color accents in favor of typographic contrast.

| Name | Primary | Accent | Bg | Footer Bg | Vibe / Vertical |
|------|---------|--------|----|-----------|--------------|
| **Graphite Tech** | `#0f0f0f` | `#2563eb` | `#fafafa` | `#0f0f0f` | Near-black + electric blue — tech, startups, longform analysis. Reads as Stratechery / The Information. |
| **Mint Finance** | `#064e3b` | `#059669` | `#ffffff` | `#022c22` | Deep teal + emerald on white — markets, money, business. Validated against the fintech color palette. |
| **Scandi Minimal** | `#1c1c1c` | `#a0a0a0` | `#f5f3ef` | `#1c1c1c` | Bone + ink with *no chromatic accent* — design, architecture, interiors. The accent is `--color-muted` itself. Lets typography do the work. |

### Tier 4 — Dark (5, including 2 with gradients)

Coverage of dark mode aesthetics — currently only Bold Dark and Midnight Purple exist.

| Name | Primary | Accent | Bg | Hero Overlay / Footer Gradient | Vibe / Vertical |
|------|---------|--------|----|----|--------------|
| *Bold Dark* | `#E50914` | `#B81D24` | `#141414` | — | Cinematic red — current |
| *Midnight Purple* | `#581c87` | `#a855f7` | `#0f0720` | — | Saturated purple — current |
| **Carbon Editorial** | `#e6e6e6` | `#f59e0b` | `#0b0b0c` | — | Neutral dark + amber spark — serious dark mode reading. The amber is the *only* color; everything else is grayscale. |
| **Forest Night** | `#86b08a` | `#facc15` | `#0a1410` | Footer: `linear-gradient(180deg, #0a1410, #06100a)` | Dark counterpart to Botanical — outdoor, sustainability, longform nature. |
| **Stadium** | `#facc15` | `#ef4444` | `#0f1419` | Hero scrim: `linear-gradient(180deg, transparent 40%, rgba(239,68,68,0.55) 100%)` | Yellow + action red — sports, esports, motorsport. Hero scrim uses the brand red, not pure black — image overlays feel branded. |

### Tier 5 — Sophisticated Gradients (3)

The new tier. Each preset still ships all 25 solid color vars (fallbacks), plus 1–3 gradient overrides.

| Name | Primary | Accent | Gradients | Vibe / Vertical |
|------|---------|--------|------|--------------|
| **Aurora** | `#0a0e27` | `#a78bfa` | Hero scrim: `linear-gradient(135deg, rgba(102,126,234,0.65), rgba(118,75,162,0.85), rgba(240,147,251,0.4))`. Footer: `linear-gradient(180deg, #1a1a3e, #0a0e27)` | Tech, AI, innovation. Three-stop scrim feels expensive; same gradient sweep across hero + footer ties the page together. |
| **Sunset Strip** | `#be123c` | `#f97316` | Hero scrim: `linear-gradient(135deg, rgba(249,115,22,0.5), rgba(236,72,153,0.65), rgba(139,92,246,0.6))`. Must-reads strip: `linear-gradient(90deg, #be123c, #f97316)` | Music, nightlife, entertainment. Multi-stop warm-to-cool sweep — pop culture energy without going neon-juvenile. |
| **Art Deco Brass** | `#f5e8c7` | `#b8860b` | Hero scrim: `linear-gradient(180deg, transparent 30%, rgba(10,10,10,0.95) 100%)`. Must-reads: `linear-gradient(135deg, #1a1410 0%, #2d2418 100%)` | Luxury, watches, spirits, real estate. Validated against the luxury palette (`#1C1917 / #A16207`). Gradient is tonal-dark rather than colorful — restraint is the point. |

---

## Picker UX (refined)

### The problem with 16 cards

Today's picker is `flex flex-wrap gap-2` with pill-style buttons ([StepTheme.tsx:287-306](services/dashboard/src/components/wizard/StepTheme.tsx#L287-L306)) — 6 pills, ~80px each, wrap onto 1–2 rows. At 16 pills with the same shape, it becomes a wall of indistinguishable text + tiny dots. Choice paralysis. The current 3-dot swatch (primary / accent / background) doesn't communicate gradients at all.

### Redesigned card

```
┌────────────────────┐
│  ████████████████  │  ← preview band (full bleed, 64px tall, shows the
│  ████████████████  │     preset's actual hero feel: bg + footer-bg
│                    │     band + accent stripe; or the gradient itself
│  Newsprint         │     for gradient presets)
│  Editorial · light │  ← name + tier subtext
└────────────────────┘
   ↑ selected = 2px cyan ring + cyan check mark in top-right
```

**Why a preview band over the 3-dot pattern:**
- Shows actual color *relationships* (text on bg, footer band, accent contrast) — what users actually care about
- A single rectangle showing the gradient sweep is unambiguous for gradient presets
- More visually distinct → easier scan across 16
- The tier label is the disambiguator when names are similar ("Editorial Black" vs "Carbon Editorial")

### Layout grid

| Breakpoint | Columns | Card width |
|------------|---------|------------|
| Mobile (<640px) | 2 | ~160px |
| Tablet (640–1024px) | 3 | ~200px |
| Desktop (≥1024px) | 4 | ~220px |

Card height ~130px (preview 64px + text block 66px). 16 cards on desktop = 4 rows. Comfortable, not overwhelming.

### Tier organization

Subtle section headings, no tabs (tabs hide content; user can't visually compare across tiers):

```
Editorial                                            5 presets
─────────────────────────────────────────────────────────────
[Classic News]  [Newsprint]  [Editorial Black]  [Ocean Editorial]
[Elegant Slate]

Lifestyle & Vertical                                 5 presets
─────────────────────────────────────────────────────────────
[Warm Magazine] [Botanical]  [Mocha]              [Coastal Air]
[Rose Garden]

Premium                                              3 presets
─────────────────────────────────────────────────────────────
[Graphite Tech] [Mint Finance] [Scandi Minimal]

Dark                                                 5 presets
─────────────────────────────────────────────────────────────
[Bold Dark]     [Midnight]    [Carbon Editorial] [Forest Night]
[Stadium]

Gradients  ✦                                         3 presets
─────────────────────────────────────────────────────────────
[Aurora]        [Sunset Strip] [Art Deco Brass]
```

Tier headings are `text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide` with a hairline divider — visible structure without ornament. The `✦` marker on Gradients is a Lucide `Sparkles` icon (8px, accent color), not a "NEW" badge that ages.

### "Surprise me" button

Lives in the picker header row, right-aligned:

```
┌──────────────────────────────────────────────────────┐
│  Theme Preset                          [🎲 Surprise me] │
└──────────────────────────────────────────────────────┘
```

- Lucide `Dices` icon + label
- Style: ghost button, hover = cyan tint
- Behavior: picks a random preset *excluding* the currently selected one. If "custom" is active, picks any. Scrolls the picked card into view and applies the brief 2-color flash already used for newly-selected cards.
- No confirmation dialog — Surprise is *meant* to surprise. The user can undo by clicking their previous preset.

### UX checks applied

| Rule | Compliance |
|------|-----------|
| `touch-target-size` (44px min) | Cards are 130px tall × 160–220px wide — well above min. Surprise Me button ≥40×40px tap area via padding. |
| `touch-spacing` (8px gap) | Grid `gap-3` (12px) between cards. Tier sections separated by `mt-8`. |
| `state-clarity` (hover/pressed/disabled distinct) | Hover: subtle scale (1.02) + border-cyan-300. Selected: ring-2 ring-cyan + checkmark badge. Pressed: scale (0.98). |
| `color-not-only` | Selected state = ring **+** checkmark icon, not color alone. |
| `visual-hierarchy` (size, spacing, contrast — not color alone) | Tier headings establish hierarchy via size + spacing; preset cards are uniform; selected state breaks pattern via ring + icon. |
| `whitespace-balance` | 12px intra-tier gap, 32px inter-tier gap. Headings have breathing room above the divider. |
| `keyboard-nav` | Cards are `<button>` elements in DOM order matching visual order; arrow keys could navigate but Tab is sufficient. |
| `focus-states` | 2px cyan focus ring distinct from the selected ring (offset, not solid). |
| `reduced-motion` | The hover scale and Surprise Me flash respect `prefers-reduced-motion: reduce` — drop to opacity transition only. |
| `mobile-first` | 2-column grid at 375px ensures cards stay ≥160px wide. No horizontal scroll. |

### Empty / custom state

When the user manually edits a color in SiteThemeTab and falls out of preset match, the picker shows a `Custom` chip (existing pattern, [StepTheme.tsx:307-315](services/dashboard/src/components/wizard/StepTheme.tsx#L307-L315)) above the tier grid in an amber-tinted card, indicating "your current colors don't match a preset." Click any preset to overwrite.

---

---

## Out of scope (deliberate)

- Gradient authoring UI (color picker for gradient stops + angle)
- Per-site custom-preset save ("save my current colors as a preset")
- Theme preview thumbnails (showing a mock hero card with the preset applied) — would be nice, but adds 2–3 days of work
- Light/dark mode pairing (one preset = one mode for now)
- Migrating existing 6 presets to use gradients

---

## Acceptance criteria

### Code correctness
- [ ] `services/dashboard/src/components/wizard/themePresets.ts` exists; exports `PRESETS`, `ColorState` (28 keys), `ALL_COLOR_KEYS` (solid only), `GRADIENT_KEYS`, `detectPreset()`, `pickRandomPreset(currentId)`
- [ ] Both StepTheme and SiteThemeTab import from the shared module — no local copy of `PRESETS` or `ColorState`
- [ ] `pnpm typecheck` clean across all packages
- [ ] No console errors in browser dev tools when opening wizard or any site detail page

### Picker UI
- [ ] All 16 presets visible in wizard `/wizard` → Theme step
- [ ] All 16 presets visible in site detail → Site Settings → Config → Theme tab
- [ ] Cards use the preview-band design (not 3 dots); gradient presets show the actual gradient in the band
- [ ] Tiers visually grouped with hairline-divider headings; Gradients tier has `Sparkles` icon marker
- [ ] Surprise Me button works in both wizard and SiteThemeTab; never picks the currently selected preset
- [ ] Grid responsive: 2 cols mobile, 3 tablet, 4 desktop. No horizontal scroll at 375px
- [ ] Selected state = ring + checkmark (color-not-only rule)
- [ ] Focus ring visible via keyboard Tab; hover scale respects `prefers-reduced-motion`

### Manual editor
- [ ] `*_gradient` keys do NOT appear as `<ColorPickerField>` entries in SiteThemeTab
- [ ] Selecting a gradient preset still saves the gradient values to `theme.colors` (verify via Network tab → save payload)

### Site worker rendering (local + staging)
- [ ] `pnpm dev` (Astro): all 16 presets render correctly for a test site (set `_atl_site` to swap configs)
- [ ] `pnpm dev:worker` (workerd parity): same verification
- [ ] Aurora / Sunset Strip / Art Deco Brass render gradients on hero scrim, footer, and/or must-reads strip as specified
- [ ] Existing sites (Classic News selected, stale KV without gradient keys) render *identically* before and after worker deploy
- [ ] No 500 errors, no missing CSS vars in rendered HTML
- [ ] Run `pnpm test` in `packages/site-worker` — all existing tests pass

### Save / persistence
- [ ] Selecting a preset in wizard, completing flow → `sites/<domain>/site.yaml` on staging branch contains the full preset color map (verify in Git)
- [ ] Selecting a preset in SiteThemeTab, saving → same verification
- [ ] YAML round-trip: open the saved file, ensure gradient strings are quoted, no syntax errors

### Pre-deploy gate (Asaf-controlled)
- [ ] Asaf has tested locally and approved
- [ ] **Then and only then:** commit, push, `cloudgrid plug`, worker deploy, re-seed via `sync-kv.yml` `force_all: true`

---

## Build sequence (when approved)

1. Extract shared `themePresets.ts` (no behavior change yet — wire both consumers to it with current 6 presets)
2. Typecheck + visual confirm nothing broke
3. Add the 10 new presets to the shared module (solid presets only — no gradient keys yet)
4. Add the picker UI redesign (preview band, tiers, Surprise Me)
5. Add gradient keys + the 3 gradient presets
6. Add the 4 site-worker component CSS fallback lines
7. Add gradient-key filter to SiteThemeTab manual editor
8. Local verification across both consumers + site-worker
9. Hand off to Asaf for local approval
