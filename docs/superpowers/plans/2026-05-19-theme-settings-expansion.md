# Theme Settings Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple article hero byline from accent color, wire footer text/links to theme, add logo size control, and split global heading/link colors from the catch-all `text`/`primary`/`accent` — all without restructuring the existing site theme settings UI.

**Architecture:** Pure additive schema expansion. New color fields default (via CSS `var(fallback)`) to today's behavior so unset fields produce the same visual output. New fields are surfaced in the existing wizard + site theme tab using the panel's current grouping pattern (sub-headers inside the "Advanced Text Colors" collapsible). Non-color additions (logo heights, optional footer logo) live next to the existing logo upload in the Assets section. Footer logo height is independently controllable but auto-derives from header height when unset.

**Tech Stack:** Astro (site-worker), Next.js 15 + TypeScript (dashboard), Vitest, plain CSS variables.

---

## Pre-flight

**Working branch:** Create `theme-settings-expansion` off `asaf-dev` and push to origin. All commits go to that branch.

**Repo:** `atomic-content-platform` only. No network-repo (`atomic-labs-network`) changes — sites pick up the new defaults automatically through the CSS fallback chain.

**Field summary (what gets added):**

| Field | Type | Group | Fallback |
|---|---|---|---|
| `heading` | color | Text Colors | `--color-text` |
| `link` | color | Text Colors | `--color-primary` |
| `link_hover` | color | Text Colors | `--color-accent` |
| `article_hero_meta` | color | Advanced → Article page | `--color-muted` |
| `footer_text` | color | Advanced → Footer | `--color-muted` |
| `footer_heading` | color | Advanced → Footer | `#ffffff` |
| `footer_link` | color | Advanced → Footer | `--color-muted` |
| `footer_link_hover` | color | Advanced → Footer | `#ffffff` |
| `logo_height` | number (px) | Assets | `52` (header logo) |
| `logo_height_footer` | number (px) | Assets | 92% of `logo_height` |
| `footer_logo` | image (base64/URL) | Assets | falls back to `logo` |

---

## Phase 1 — Tier 1 Bug Fix: CSV theme-builder default

### Task 1: Change `feed_date` default in theme-builder from `accent` to `muted`

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/theme-builder.ts:79`
- Modify: `services/content-pipeline/src/__tests__/migration/theme-builder.test.ts`

- [ ] **Step 1: Add a failing test for the new `feed_date` default**

Open `services/content-pipeline/src/__tests__/migration/theme-builder.test.ts` and add this test inside the `describe("expandThemeColors", ...)` block:

```typescript
it("defaults feed_date to the muted color, not accent", () => {
  const colors = expandThemeColors({
    primary: "#1a1a2e",
    accent: "#f4c542",
    text: "#000000",
    background: "#ffffff",
  });
  // feed_date should follow the muted (secondary text) color,
  // not the bright CTA accent.
  expect(colors.feed_date).toBe(colors.muted);
  expect(colors.feed_date).not.toBe(colors.accent);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/theme-builder.test.ts -t "defaults feed_date"`
Expected: FAIL — `feed_date` currently equals `accent`.

- [ ] **Step 3: Update theme-builder default**

In `services/content-pipeline/src/agents/migration/theme-builder.ts`, change line 79:

```typescript
// before
feed_date: accent,
// after
feed_date: mixColors(text, background, 0.5),
```

(This matches the formula used for `muted` on line 65 so the two stay in sync.)

- [ ] **Step 4: Run the full test file to verify all tests pass**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/theme-builder.test.ts`
Expected: PASS (including the new test).

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/migration/theme-builder.ts services/content-pipeline/src/__tests__/migration/theme-builder.test.ts
git commit -m "fix(migration): default feed_date to muted, not accent

CSV-imported sites were inheriting the bright CTA accent on every
feed-card date, which clashes with article previews. Default to the
muted/secondary text color instead."
```

---

## Phase 2 — Schema & CSS Defaults

### Task 2: Add new color fields to `ColorState` in the wizard

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx:13-33` (interface)
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx:104-110` (`ALL_COLOR_KEYS`)

- [ ] **Step 1: Extend the `ColorState` interface**

Replace lines 13–33 with:

```typescript
interface ColorState {
  primary: string;
  accent: string;
  background: string;
  secondary: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
  // New globals (Tier 4 — decouple from text/primary/accent)
  heading: string;
  link: string;
  link_hover: string;
  footer_bg: string;
  must_reads_bg: string;
  hero_title: string;
  must_reads_title: string;
  article_hero_title: string;
  // New article-hero byline override (Tier 1 fix)
  article_hero_meta: string;
  feed_title: string;
  feed_desc: string;
  feed_date: string;
  prose_heading: string;
  prose_body: string;
  category_header_text: string;
  // New footer text fields (Tier 2)
  footer_text: string;
  footer_heading: string;
  footer_link: string;
  footer_link_hover: string;
}
```

- [ ] **Step 2: Update `ALL_COLOR_KEYS` to include new keys**

Replace lines 104–110 with:

```typescript
const ALL_COLOR_KEYS: (keyof ColorState)[] = [
  "primary", "accent", "background", "secondary", "text", "muted", "surface", "border",
  "heading", "link", "link_hover",
  "footer_bg", "must_reads_bg",
  "hero_title", "must_reads_title", "article_hero_title", "article_hero_meta",
  "feed_title", "feed_desc", "feed_date",
  "prose_heading", "prose_body", "category_header_text",
  "footer_text", "footer_heading", "footer_link", "footer_link_hover",
];
```

- [ ] **Step 3: Verify TypeScript still compiles (it should fail — presets are missing keys)**

Run: `cd services/dashboard && pnpm typecheck`
Expected: FAIL with errors like `Property 'heading' is missing in type '{ ... }' but required in type 'ColorState'` for every `PRESETS` entry. This is intentional — Task 3 fixes them.

- [ ] **Step 4: Do not commit yet — Task 3 fixes the type errors in the same logical change.**

---

### Task 3: Update all 6 PRESETS in `StepTheme.tsx` with new field values

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx:35-102` (`PRESETS`)

- [ ] **Step 1: Replace each preset's `colors` block with the new keys**

For each preset entry in `PRESETS`, append the new fields. Use this drop-in replacement for the entire `PRESETS` block (lines 35–102):

```typescript
const PRESETS: Record<string, { name: string; colors: ColorState }> = {
  classic: {
    name: "Classic News",
    colors: {
      primary: "#1a1a2e", accent: "#f4c542", background: "#ffffff", secondary: "#1a1a2e",
      text: "#1a1a2e", muted: "#6b7280", surface: "#f8f9fa", border: "#e5e7eb",
      heading: "#1a1a2e", link: "#1a1a2e", link_hover: "#f4c542",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#6b7280",
      feed_title: "#1a1a2e", feed_desc: "#1a1a2e", feed_date: "#6b7280",
      prose_heading: "#1a1a2e", prose_body: "#1a1a2e", category_header_text: "#ffffff",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  bold: {
    name: "Bold Dark",
    colors: {
      primary: "#E50914", accent: "#B81D24", background: "#141414", secondary: "#1a1a2e",
      text: "#ffffff", muted: "#8C8C8C", surface: "#2a2a2a", border: "#333333",
      heading: "#ffffff", link: "#E50914", link_hover: "#B81D24",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#8C8C8C",
      feed_title: "#ffffff", feed_desc: "#e0e0e0", feed_date: "#8C8C8C",
      prose_heading: "#ffffff", prose_body: "#e0e0e0", category_header_text: "#ffffff",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  ocean: {
    name: "Ocean Editorial",
    colors: {
      primary: "#0f4c81", accent: "#10b981", background: "#f8fafc", secondary: "#0f172a",
      text: "#0f172a", muted: "#64748b", surface: "#e2e8f0", border: "#cbd5e1",
      heading: "#0f172a", link: "#0f4c81", link_hover: "#10b981",
      footer_bg: "#0f172a", must_reads_bg: "#0f172a",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#64748b",
      feed_title: "#0f172a", feed_desc: "#0f172a", feed_date: "#64748b",
      prose_heading: "#0f172a", prose_body: "#1e293b", category_header_text: "#ffffff",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  warm: {
    name: "Warm Magazine",
    colors: {
      primary: "#7c2d12", accent: "#ea580c", background: "#fffbeb", secondary: "#1c1917",
      text: "#1c1917", muted: "#78716c", surface: "#fef3c7", border: "#d6d3d1",
      heading: "#1c1917", link: "#7c2d12", link_hover: "#ea580c",
      footer_bg: "#1c1917", must_reads_bg: "#1c1917",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#78716c",
      feed_title: "#1c1917", feed_desc: "#1c1917", feed_date: "#78716c",
      prose_heading: "#1c1917", prose_body: "#292524", category_header_text: "#ffffff",
      footer_text: "#a8a29e", footer_heading: "#ffffff", footer_link: "#a8a29e", footer_link_hover: "#ffffff",
    },
  },
  slate: {
    name: "Elegant Slate",
    colors: {
      primary: "#334155", accent: "#6366f1", background: "#ffffff", secondary: "#1e293b",
      text: "#1e293b", muted: "#94a3b8", surface: "#f1f5f9", border: "#e2e8f0",
      heading: "#1e293b", link: "#334155", link_hover: "#6366f1",
      footer_bg: "#1e293b", must_reads_bg: "#1e293b",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#94a3b8",
      feed_title: "#1e293b", feed_desc: "#334155", feed_date: "#94a3b8",
      prose_heading: "#1e293b", prose_body: "#334155", category_header_text: "#ffffff",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  midnight: {
    name: "Midnight Purple",
    colors: {
      primary: "#581c87", accent: "#a855f7", background: "#0f0720", secondary: "#1e1038",
      text: "#f0e6ff", muted: "#a78bfa", surface: "#1e1038", border: "#2e1a50",
      heading: "#f0e6ff", link: "#a855f7", link_hover: "#c084fc",
      footer_bg: "#1e1038", must_reads_bg: "#1e1038",
      hero_title: "#ffffff", must_reads_title: "#f0e6ff", article_hero_title: "#ffffff",
      article_hero_meta: "#a78bfa",
      feed_title: "#f0e6ff", feed_desc: "#d8c8f0", feed_date: "#a78bfa",
      prose_heading: "#f0e6ff", prose_body: "#d8c8f0", category_header_text: "#ffffff",
      footer_text: "#a78bfa", footer_heading: "#ffffff", footer_link: "#a78bfa", footer_link_hover: "#ffffff",
    },
  },
};
```

- [ ] **Step 2: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (errors from Task 2 are now resolved).

- [ ] **Step 3: Do not commit yet — Task 4 mirrors these changes in `SiteThemeTab.tsx`. Commit at end of Task 4.**

---

### Task 4: Mirror `ColorState` and `PRESETS` in `SiteThemeTab.tsx`

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx:16-39` (interface)
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx:53-121` (`PRESETS`)
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx:122-128` (`ALL_COLOR_KEYS`)

- [ ] **Step 1: Replace `ColorState` and `ALL_COLOR_KEYS` to match the wizard**

Use the same `ColorState` interface body from Task 2, Step 1, and the same `ALL_COLOR_KEYS` array from Task 2, Step 2. The two files must stay byte-for-byte identical for these two declarations.

- [ ] **Step 2: Replace the `PRESETS` block with the same content from Task 3, Step 1.**

Both files now share identical color schema and preset definitions.

- [ ] **Step 3: Run typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx services/dashboard/src/components/site-detail/SiteThemeTab.tsx
git commit -m "feat(dashboard): extend ColorState with heading/link/footer/article_hero_meta fields

Adds 8 new color fields to the theme schema: heading, link, link_hover
(decouple from text/primary/accent), article_hero_meta (replaces the
hardcoded accent in the article hero byline), and footer_text /
footer_heading / footer_link / footer_link_hover (replace hardcoded
colors in the footer).

All 6 presets updated. No consuming components wired yet — that
happens in subsequent commits."
```

---

### Task 5: Add CSS variable defaults for new color fields in `theme.css`

**Files:**
- Modify: `packages/site-worker/src/themes/modern/styles/theme.css:15-37` (the `@layer theme-defaults` block)

- [ ] **Step 1: Add new variable defaults inside the theme-defaults layer**

Locate the `@layer theme-defaults` block (currently lines 15–37 — confirm via Read before editing). Add these new declarations alongside the existing ones, preserving their cascade-layer wrapping:

```css
/* New globals — decouple heading/link from text/primary/accent */
--color-heading: var(--color-text, #1a1a2e);
--color-link: var(--color-primary, #1a1a2e);
--color-link_hover: var(--color-accent, #f4c542);

/* Article hero byline — was hardcoded to accent */
--color-article_hero_meta: var(--color-muted, #6b7280);

/* Footer text — was hardcoded #fff / #9ca3af / #6b7280 */
--color-footer_text: var(--color-muted, #9ca3af);
--color-footer_heading: #ffffff;
--color-footer_link: var(--color-muted, #9ca3af);
--color-footer_link_hover: #ffffff;
```

- [ ] **Step 2: Build the site-worker to verify CSS is valid**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS. No CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/styles/theme.css
git commit -m "feat(site-worker): add CSS variable defaults for new theme fields

Adds layer-wrapped defaults for heading/link/link_hover (fall back to
text/primary/accent), article_hero_meta (falls back to muted), and
footer_text/heading/link/link_hover. Default chain preserves current
visual behavior — no site change until consumers are wired."
```

---

### Task 6: Add `logo_height` to `ThemeConfig` shared type

**Files:**
- Modify: `packages/shared-types/src/config.ts:115` (`ThemeConfig`)

- [ ] **Step 1: Read the current `ThemeConfig` interface to confirm the shape**

Run: `grep -n "ThemeConfig\|ResolvedThemeConfig" packages/shared-types/src/config.ts | head -20`

Confirm the interface declares `colors?: Record<string, string>`, `logo?: string`, `favicon?: string`, `fonts?: {…}`.

- [ ] **Step 2: Add `logo_height` (optional number) to `ThemeConfig` and `ResolvedThemeConfig`**

In `packages/shared-types/src/config.ts`, locate the `ThemeConfig` interface and add:

```typescript
export interface ThemeConfig {
  base?: "modern" | "editorial" | "bold" | "classic";
  colors?: Record<string, string>;
  logo?: string;
  /** Header logo height in pixels. Defaults to 52. */
  logo_height?: number;
  /** Footer logo height in pixels. Defaults to ~92% of `logo_height` (≈48 when logo_height is 52). */
  logo_height_footer?: number;
  favicon?: string;
  fonts?: {
    heading?: string;
    body?: string;
  };
}
```

And in `ResolvedThemeConfig` (right below it), add the resolved (required) form. Note `logo_height_footer` is `number | null` — `null` means "let the CSS default (calc from header) take over":

```typescript
export interface ResolvedThemeConfig {
  base: "modern" | "editorial" | "bold" | "classic";
  colors: Record<string, string>;
  logo: string;
  logo_height: number;
  logo_height_footer: number | null;
  favicon: string;
  fonts: { heading: string; body: string };
}
```

- [ ] **Step 3: Run typecheck across the workspace**

Run: `cd packages/shared-types && pnpm typecheck && cd ../../services/dashboard && pnpm typecheck && cd ../../packages/site-worker && pnpm typecheck`
Expected: PASS in all three. (The site-worker resolver populates `ResolvedThemeConfig` — if it errors with "Property 'logo_height' is missing", proceed to Step 4.)

- [ ] **Step 4: If the resolver complains, set the defaults at resolution time**

Locate the resolver in `packages/site-worker/scripts/lib/resolve.ts` (or wherever `ResolvedThemeConfig` is constructed). Add these two lines to the resolved object — note `logo_height_footer` is `null` (not undefined) when unset so the CSS fallback proportional calc applies:

```typescript
logo_height: theme.logo_height ?? 52,
logo_height_footer: theme.logo_height_footer ?? null,
```

(Read the file first to find the right location and pattern.)

- [ ] **Step 5: Re-run typecheck**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/config.ts packages/site-worker/scripts/lib/resolve.ts
git commit -m "feat(shared-types): add logo_height and logo_height_footer to ThemeConfig

Optional pixel values for header and footer logo heights. Header
defaults to 52. Footer defaults to null which lets CSS calc 92% of
header height — set explicitly to override that proportion."
```

---

### Task 7: Inject `--logo-height` CSS variable in `BaseLayout.astro`

**Files:**
- Modify: `packages/site-worker/src/layouts/BaseLayout.astro` (the `<style>` block around line 108 that injects color vars)

- [ ] **Step 1: Read BaseLayout to find the inline `<style>:root { … }` block**

Run: `grep -n "color-primary\|--color-" packages/site-worker/src/layouts/BaseLayout.astro | head -20`

The injection point is the `<style>:root` block that currently emits `--color-<key>: <value>;` for every entry in `config.theme.colors`.

- [ ] **Step 2: Emit `--logo-height` and (conditionally) `--logo-height-footer` alongside the color variables**

In the inline style block, after the loop that emits color variables, emit the logo height variables. The footer variable is only emitted when explicitly set — otherwise the CSS fallback in `theme.css` (calc from header) takes over.

If the style block uses Astro expression interpolation:

```astro
--logo-height: {config.theme.logo_height ?? 52}px;
{config.theme.logo_height_footer != null && (
  <Fragment>--logo-height-footer: {config.theme.logo_height_footer}px;</Fragment>
)}
```

If the style block is assembled as a string, append:

```typescript
let styleBody = /* existing color var lines */;
styleBody += `--logo-height: ${config.theme.logo_height ?? 52}px;`;
if (config.theme.logo_height_footer != null) {
  styleBody += `--logo-height-footer: ${config.theme.logo_height_footer}px;`;
}
```

Match the style of the surrounding code.

- [ ] **Step 3: Add a default in `theme.css` so unset sites still render**

In `packages/site-worker/src/themes/modern/styles/theme.css`, inside the same `@layer theme-defaults` block edited in Task 5, add:

```css
--logo-height: 52px;
--logo-height-footer: calc(var(--logo-height) * 0.92);
```

(The footer scales to ~92% of header logo height — matches the current `52px` → `48px` ratio.)

- [ ] **Step 4: Build site-worker**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 5: Commit**

```bash
git add packages/site-worker/src/layouts/BaseLayout.astro packages/site-worker/src/themes/modern/styles/theme.css
git commit -m "feat(site-worker): inject --logo-height and --logo-height-footer CSS vars

Always emit --logo-height (default 52px). Only emit --logo-height-footer
when explicitly set in theme config; otherwise theme.css default
(calc 92% of header height) applies."
```

---

## Phase 3 — Wire Consumers to the New Variables

### Task 8: Wire global headings to `--color-heading`

**Files:**
- Modify: `packages/site-worker/src/themes/modern/styles/theme.css:95-100` (global `h1-h6` rule)
- Modify: `packages/site-worker/src/themes/modern/styles/theme.css:155` (`.section-heading`)

- [ ] **Step 1: Update the global `h1-h6` rule**

Find:

```css
h1, h2, h3, h4, h5, h6 {
  font-family: var(--fontHeading), system-ui, -apple-system, sans-serif;
  font-weight: 700;
  line-height: 1.25;
  color: var(--color-text);
}
```

Replace `color: var(--color-text);` with:

```css
  color: var(--color-heading, var(--color-text, #1a1a2e));
```

- [ ] **Step 2: Update `.section-heading`**

Find `.section-heading { … color: var(--color-text); }` (around line 155). Change the color line to:

```css
  color: var(--color-heading, var(--color-text, #1a1a2e));
```

- [ ] **Step 3: Build to verify**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add packages/site-worker/src/themes/modern/styles/theme.css
git commit -m "feat(site-worker): wire global headings to --color-heading

Falls back to --color-text so unset sites keep current colors."
```

---

### Task 9: Wire global links to `--color-link` / `--color-link_hover`

**Files:**
- Modify: `packages/site-worker/src/themes/modern/styles/theme.css:114-122`

- [ ] **Step 1: Update the `a` and `a:hover` rules**

Find:

```css
a {
  color: var(--color-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-accent);
}
```

Replace with:

```css
a {
  color: var(--color-link, var(--color-primary, #1a1a2e));
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-link_hover, var(--color-accent, #f4c542));
}
```

- [ ] **Step 2: Build to verify**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/styles/theme.css
git commit -m "feat(site-worker): wire global links to --color-link / --color-link_hover

Falls back to primary / accent so unset sites keep current behavior."
```

---

### Task 10: Replace article-hero meta accent with `--color-article_hero_meta`

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/ArticleHero.astro:55-61`

- [ ] **Step 1: Update the `.article-hero-meta` rule**

Find:

```css
.article-hero-meta {
  color: var(--color-accent, #f4c542);
  font-weight: 600;
}
```

Replace with:

```css
.article-hero-meta {
  color: var(--color-article_hero_meta, var(--color-muted, #6b7280));
  font-weight: 600;
}
```

- [ ] **Step 2: Build**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/ArticleHero.astro
git commit -m "fix(site-worker): article hero byline no longer inherits accent color

Switches .article-hero-meta from var(--color-accent) to a dedicated
--color-article_hero_meta with a muted fallback. Resolves the visual
bug where bright accent colors made the date/author byline jarring
on featured articles."
```

---

### Task 11: Wire footer hardcoded colors to theme variables

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro` (multiple CSS rules)

- [ ] **Step 1: Read the current Footer.astro CSS section to confirm line numbers**

Run: `grep -n "color: #\|color: rgb\|color: var" packages/site-worker/src/themes/modern/components/Footer.astro`

You should see hardcoded `#fff`, `#9ca3af`, `#6b7280` at approximately lines 110–253. Confirm before editing.

- [ ] **Step 2: Replace `.footer-logo-text` color**

Find:

```css
.footer-logo-text {
  color: #fff;
```

Replace `color: #fff;` with:

```css
  color: var(--color-footer_heading, #ffffff);
```

- [ ] **Step 3: Replace `.footer-tagline` (or equivalent description) color**

Find the tagline rule with `color: #9ca3af;` and replace with:

```css
  color: var(--color-footer_text, #9ca3af);
```

- [ ] **Step 4: Replace `.footer-heading` color**

Find the section-heading rule with `color: #fff;` and replace with:

```css
  color: var(--color-footer_heading, #ffffff);
```

- [ ] **Step 5: Replace footer link colors**

Find the link list default rule with `color: #9ca3af;`:

```css
  color: var(--color-footer_link, #9ca3af);
```

Find the link hover rule with `color: #fff;`:

```css
  color: var(--color-footer_link_hover, #ffffff);
```

- [ ] **Step 6: Replace newsletter description color**

Find the newsletter description rule (currently `color: #9ca3af;`):

```css
  color: var(--color-footer_text, #9ca3af);
```

- [ ] **Step 7: Replace copyright color**

Find the copyright rule (currently `color: #6b7280;`):

```css
  color: var(--color-footer_text, #6b7280);
```

(Note: copyright uses the same `footer_text` variable as the tagline — both are "muted footer text". A future redesign can split them if needed.)

- [ ] **Step 8: Build**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 9: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "feat(site-worker): wire footer text/headings/links to theme variables

Replaces hardcoded #fff / #9ca3af / #6b7280 in Footer.astro with
var(--color-footer_*) references. Fallbacks preserve current colors
when sites don't set the new fields."
```

---

### Task 12: Wire logo height in Header.astro

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Header.astro:134-139`

- [ ] **Step 1: Update the `.logo-img` rule**

Find:

```css
.logo-img {
  height: 52px;
  max-width: 300px;
  width: auto;
}
```

Replace with:

```css
.logo-img {
  height: var(--logo-height, 52px);
  max-width: 300px;
  width: auto;
}
```

- [ ] **Step 2: Build**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Header.astro
git commit -m "feat(site-worker): header logo height driven by --logo-height"
```

---

### Task 13: Wire logo height in Footer.astro

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro:103-107`

- [ ] **Step 1: Update the `.footer-logo` rule**

Find:

```css
.footer-logo {
  height: 48px;
  width: auto;
}
```

Replace with:

```css
.footer-logo {
  height: var(--logo-height-footer, 48px);
  width: auto;
}
```

- [ ] **Step 2: Build**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "feat(site-worker): footer logo height driven by --logo-height-footer"
```

---

## Phase 4 — Dashboard UI: Surface the new fields

### Task 14: Wizard — split "Headings & body" + add link/link_hover/heading in Text Colors

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx:319-329` (Text Colors section)

- [ ] **Step 1: Replace the Text Colors block**

Find lines 319–329 (the `{/* Text Colors */}` section). Replace the inner `<div className="grid…">` with this expanded layout:

```tsx
      {/* Text Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Text Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColorPickerField
            label="Body text"
            value={colors.text ?? "#1a1a2e"}
            onChange={(v): void => setColor("text", v)}
            helperText="Default body color (paragraphs, etc.)"
          />
          <ColorPickerField
            label="Headings"
            value={colors.heading ?? colors.text ?? "#1a1a2e"}
            onChange={(v): void => setColor("heading", v)}
            helperText="Page headings (h1–h6). Defaults to body text."
          />
          <ColorPickerField
            label="Muted (dates, meta)"
            value={colors.muted ?? "#6b7280"}
            onChange={(v): void => setColor("muted", v)}
            helperText="Secondary text"
          />
          <ColorPickerField
            label="Link"
            value={colors.link ?? colors.primary ?? "#1a1a2e"}
            onChange={(v): void => setColor("link", v)}
            helperText="Inline links. Defaults to main color."
          />
          <ColorPickerField
            label="Link hover"
            value={colors.link_hover ?? colors.accent ?? "#f4c542"}
            onChange={(v): void => setColor("link_hover", v)}
            helperText="Link color on hover. Defaults to accent."
          />
          <ColorPickerField
            label="Borders"
            value={colors.border ?? "#e5e7eb"}
            onChange={(v): void => setColor("border", v)}
            helperText="Dividers and outlines"
          />
          <ColorPickerField
            label="Surface (card bg)"
            value={colors.surface ?? "#f8f9fa"}
            onChange={(v): void => setColor("surface", v)}
            helperText="Card backgrounds"
          />
          <ColorPickerField
            label="Secondary (dark sections)"
            value={colors.secondary ?? "#1a1a2e"}
            onChange={(v): void => setColor("secondary", v)}
            helperText="Dark section fallback"
          />
        </div>
      </div>
```

- [ ] **Step 2: Run dashboard dev server and visually confirm the new fields render**

Run (in a separate terminal): `cd services/dashboard && pnpm dev`
Open http://localhost:3001/wizard, advance to the Theme step, and confirm that the Text Colors section now shows 8 fields including "Headings", "Link", "Link hover".

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx
git commit -m "feat(dashboard): split heading from body, add link colors in wizard

Text Colors section now exposes: Body text, Headings, Muted, Link,
Link hover, Borders, Surface, Secondary. Headings and Link colors
were previously locked to the global text / primary colors with no
override path."
```

---

### Task 15: Wizard — add `article_hero_meta` to Advanced "Article page" subgroup; add new "Footer" subgroup with 4 fields

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx:331-371` (Advanced Text Colors block)

- [ ] **Step 1: Add `article_hero_meta` to the "On dark overlays" sub-group**

Find the "On dark overlays" grid (around line 344) and add a fourth `ColorPickerField` for `article_hero_meta`. The full sub-group should look like:

```tsx
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">On dark overlays</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Hero card title" value={colors.hero_title ?? "#ffffff"} onChange={(v): void => setColor("hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Must Reads card title" value={colors.must_reads_title ?? "#ffffff"} onChange={(v): void => setColor("must_reads_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero title" value={colors.article_hero_title ?? "#ffffff"} onChange={(v): void => setColor("article_hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero byline (date/author)" value={colors.article_hero_meta ?? colors.muted ?? "#6b7280"} onChange={(v): void => setColor("article_hero_meta", v)} helperText="Default: muted" />
              </div>
            </div>
```

- [ ] **Step 2: Add a new "Footer" sub-group right before the closing helper-text paragraph**

After the closing `</div>` of the "Article page" sub-group and before the `<p className="text-xs text-[var(--text-muted)] border-t …">` paragraph, insert:

```tsx
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Footer</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorPickerField
                  label="Footer text"
                  value={colors.footer_text ?? colors.muted ?? "#9ca3af"}
                  onChange={(v): void => setColor("footer_text", v)}
                  helperText="Tagline, description, copyright. Default: muted."
                />
                <ColorPickerField
                  label="Footer column headings"
                  value={colors.footer_heading ?? "#ffffff"}
                  onChange={(v): void => setColor("footer_heading", v)}
                  helperText="Default: white"
                />
                <ColorPickerField
                  label="Footer link"
                  value={colors.footer_link ?? colors.muted ?? "#9ca3af"}
                  onChange={(v): void => setColor("footer_link", v)}
                  helperText="Quick Links and similar. Default: muted."
                />
                <ColorPickerField
                  label="Footer link hover"
                  value={colors.footer_link_hover ?? "#ffffff"}
                  onChange={(v): void => setColor("footer_link_hover", v)}
                  helperText="Default: white"
                />
              </div>
            </div>
```

- [ ] **Step 3: Visually verify in the wizard**

Reload http://localhost:3001/wizard → Theme step → expand "Advanced text colors". Confirm:
- "On dark overlays" now has 4 fields including "Article hero byline"
- A new "Footer" sub-group appears with 4 fields

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx
git commit -m "feat(dashboard): add Footer subgroup + article_hero_meta in wizard Advanced

Adds 5 new color pickers to the Advanced Text Colors panel: the
article-hero byline (under On Dark Overlays) and a new Footer
subgroup with text/headings/link/link-hover. Uses the existing
sub-header pattern — no top-level layout change."
```

---

### Task 16: Wizard — add header & footer logo height sliders in the Assets section

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx` (the Logo upload card around lines 545–578)
- Modify: `services/dashboard/src/types/dashboard.ts` (`WizardFormData` — add `logoHeight?: number` + `logoHeightFooter?: number`)

- [ ] **Step 1: Find the WizardFormData type and add the two height fields**

Run: `grep -n "WizardFormData\|themeColors\|logoBase64" services/dashboard/src/types/dashboard.ts | head -20`

Open the file and add these two lines to the `WizardFormData` interface (next to `logoBase64`):

```typescript
  logoHeight?: number;
  logoHeightFooter?: number;
```

- [ ] **Step 2: Add two sliders below the existing logo file picker**

Inside the logo upload card (the `<div>` containing the "Logo" heading at line ~546), after the `<p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>` line, insert:

```tsx
            <div className="pt-2 border-t border-[var(--border-secondary)] space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Header logo height
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={32}
                    max={96}
                    step={2}
                    value={data.logoHeight ?? 52}
                    onChange={(e): void => onChange({ logoHeight: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-cyan"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                    {data.logoHeight ?? 52}px
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Footer logo height
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={24}
                    max={96}
                    step={2}
                    value={data.logoHeightFooter ?? Math.round((data.logoHeight ?? 52) * 0.92)}
                    onChange={(e): void => onChange({ logoHeightFooter: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-cyan"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                    {data.logoHeightFooter ?? Math.round((data.logoHeight ?? 52) * 0.92)}px
                  </span>
                  {data.logoHeightFooter != null && (
                    <button
                      type="button"
                      onClick={(): void => onChange({ logoHeightFooter: undefined })}
                      className="text-xs text-[var(--text-muted)] hover:text-red-400"
                      title="Reset to auto (92% of header)"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Defaults to 92% of header height. Click Reset to return to auto.
                </p>
              </div>
            </div>
```

- [ ] **Step 3: Wire both heights into the form-data submission path**

Find where `themeColors`, `fontHeading`, `fontBody`, `logoBase64` are mapped to the saved theme config (likely in `services/dashboard/src/actions/wizard.ts` or similar — grep for `themeColors`). Add:

```typescript
logo_height: data.logoHeight ?? 52,
logo_height_footer: data.logoHeightFooter,  // undefined means "auto" — don't write a value
```

Note: do **not** apply a `?? 52` fallback for `logoHeightFooter`. We want `undefined` to be preserved so the saved YAML omits the field, which is how we signal "auto-derive from header".

Run: `grep -rn "themeColors" services/dashboard/src/actions/ services/dashboard/src/app/api/sites/ 2>&1 | head -10`

Open the relevant file and add the mappings next to `colors: data.themeColors`.

- [ ] **Step 4: Visually verify in the wizard**

Reload http://localhost:3001/wizard. The Assets → Logo card should now show two sliders: "Header logo height" and "Footer logo height". The footer slider should show the auto-derived value (≈48 when header is 52) until you move it. Once moved, a "Reset" button appears that returns it to auto.

- [ ] **Step 5: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx services/dashboard/src/types/dashboard.ts services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): add header + footer logo height sliders in wizard

Two independent sliders in Assets. Header default 52 (32–96 range).
Footer auto-derives as 92% of header until user explicitly sets it;
Reset button returns to auto. Saved as theme.logo_height and
theme.logo_height_footer (latter omitted when auto)."
```

---

### Task 17: Mirror Task 14, 15, 16 changes in `SiteThemeTab.tsx`

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`

- [ ] **Step 1: Apply the same Text Colors expansion as Task 14**

Find the existing Text Colors section (`<ColorPickerField label="Headings & body" …>` around line 401) and replace with the same 8-field block from Task 14 Step 1 — adapt the `value` references from `colors.X` to `state.colors.X` and `setColor` calls to match the local file's signature (`(key: keyof ColorState, value: string)`).

- [ ] **Step 2: Apply the Advanced "Footer" subgroup + `article_hero_meta`**

Use the same JSX from Task 15 Steps 1 & 2, adapting `colors.X` to `state.colors.X`.

- [ ] **Step 3: Add both logo-height sliders**

In `SiteThemeTab.tsx`, locate the logo upload card (likely a similar pattern to the wizard). Add the same two-slider JSX from Task 16 Step 2 (Header + Footer sliders with Reset), but wired through this tab's state. The exact state shape depends on this file — read the surrounding code first to find how other theme values are held (likely `state.logoHeight` / `state.logoHeightFooter` with `setState((s) => ({ ...s, logoHeight: ... }))`).

The Footer slider must preserve `undefined` semantics — never coerce it to a number on save unless the user explicitly moved the slider.

- [ ] **Step 4: Ensure both `logo_height` and `logo_height_footer` are included in the payload to `/api/sites/save`**

Find the `handleSave` (or equivalent) function in `SiteThemeTab.tsx`. Confirm the `configUpdates.theme` object includes:

```typescript
logo_height: state.logoHeight ?? 52,
logo_height_footer: state.logoHeightFooter,  // undefined → field omitted from saved YAML
```

- [ ] **Step 5: Visually verify on a site detail page**

Open http://localhost:3001/sites/<any-test-site>/, go to Site Settings → Theme. Confirm all new fields render and the slider works.

- [ ] **Step 6: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/dashboard/src/components/site-detail/SiteThemeTab.tsx
git commit -m "feat(dashboard): mirror new theme fields in Site Settings → Theme tab

Adds the same Text Colors expansion, Advanced Footer subgroup,
article_hero_meta, and logo height slider to the post-launch site
theme editor."
```

---

## Phase 4B — Footer Logo Variant

Optional: site admins can upload a second logo specifically for the footer (e.g. a light-on-dark variant when the footer has a dark background but the header logo is dark-on-light). If unset, the footer keeps using the main `logo`.

### Task 17B: Add `footer_logo` to `ThemeConfig`

**Files:**
- Modify: `packages/shared-types/src/config.ts` (`ThemeConfig` + `ResolvedThemeConfig`)
- Modify: `packages/site-worker/scripts/lib/resolve.ts` (resolver, if needed)

- [ ] **Step 1: Add the field to both interfaces**

In `packages/shared-types/src/config.ts`, locate `ThemeConfig` (the same interface edited in Task 6) and add `footer_logo`:

```typescript
export interface ThemeConfig {
  base?: "modern" | "editorial" | "bold" | "classic";
  colors?: Record<string, string>;
  logo?: string;
  /** Optional alternate logo shown only in the footer (e.g. a light-on-dark variant). Falls back to `logo` when unset. */
  footer_logo?: string;
  logo_height?: number;
  favicon?: string;
  fonts?: {
    heading?: string;
    body?: string;
  };
}
```

In `ResolvedThemeConfig` (right below), add the resolved form. Use `string` (empty string when unset) to match the existing pattern for `logo`:

```typescript
export interface ResolvedThemeConfig {
  base: "modern" | "editorial" | "bold" | "classic";
  colors: Record<string, string>;
  logo: string;
  footer_logo: string;
  logo_height: number;
  favicon: string;
  fonts: { heading: string; body: string };
}
```

- [ ] **Step 2: Update the resolver to pass `footer_logo` through**

Run: `grep -n "logo:" packages/site-worker/scripts/lib/resolve.ts`

In the resolver function where `ResolvedThemeConfig` is constructed, add `footer_logo: theme.footer_logo ?? ""` right next to the `logo: theme.logo ?? ""` line. Match the existing style.

- [ ] **Step 3: Typecheck**

Run: `cd packages/shared-types && pnpm typecheck && cd ../../packages/site-worker && pnpm typecheck && cd ../../services/dashboard && pnpm typecheck`
Expected: PASS in all three.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/config.ts packages/site-worker/scripts/lib/resolve.ts
git commit -m "feat(shared-types): add optional footer_logo to ThemeConfig

Lets sites supply a separate logo for the footer (e.g. light variant
on a dark footer bg). Falls back to the main logo when unset."
```

---

### Task 17C: Footer.astro uses `footer_logo` when set

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro` (the logo `<img>` rendering, around line 34)

- [ ] **Step 1: Read the current logo render block**

Run: `grep -n "theme.logo\|footer-logo" packages/site-worker/src/themes/modern/components/Footer.astro | head -10`

You should see the `<img>` tag that uses `config.theme.logo` for the `src` attribute, with a text fallback to `config.site_name` when no logo is set.

- [ ] **Step 2: Update the logo source resolution**

Change the logo selection logic to prefer `footer_logo` and fall back to `logo`. Locate the current pattern (likely an inline expression like `{config.theme.logo && (<img src={config.theme.logo} … />)}`) and replace with:

```astro
---
// Existing frontmatter, add this line near the other config destructuring:
const footerLogoSrc = config.theme.footer_logo || config.theme.logo;
---

{footerLogoSrc ? (
  <img src={footerLogoSrc} alt={config.site_name} class="footer-logo" />
) : (
  <span class="footer-logo-text">{config.site_name}</span>
)}
```

Adapt the exact JSX to match the current block's structure — the principle is to consume `footerLogoSrc` instead of `config.theme.logo` directly.

- [ ] **Step 3: Build to verify**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "feat(site-worker): Footer.astro uses footer_logo when provided

Falls back to theme.logo when footer_logo is empty, preserving
current behavior for sites that haven't set the new field."
```

---

### Task 17D: Wizard — add footer logo upload card

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx` (Assets section)
- Modify: `services/dashboard/src/types/dashboard.ts` (`WizardFormData` — add `footerLogoBase64?: string`)
- Modify: `services/dashboard/src/actions/wizard.ts` (or equivalent save path)

- [ ] **Step 1: Add `footerLogoBase64` to `WizardFormData`**

In `services/dashboard/src/types/dashboard.ts`, add `footerLogoBase64?: string;` next to `logoBase64`.

- [ ] **Step 2: Add a `handleFooterLogoUpload` handler in StepTheme.tsx**

Right after the existing `handleLogoUpload` function (around line 194), add a sibling handler:

```typescript
  function handleFooterLogoUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) onChange({ footerLogoBase64: base64Data });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }
```

- [ ] **Step 3: Add a `footerLogoInputRef`**

Near the existing `const logoInputRef = useRef<HTMLInputElement>(null);` line, add:

```typescript
  const footerLogoInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 4: Add the second upload card inside Assets**

Inside the Assets section's grid (where the Logo and Favicon cards already live, around line 543), add a third card. Place it after the Logo card and before the Favicon card:

```tsx
          {/* Footer logo (optional) */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Footer logo</h4>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Optional — use if your footer background needs a different logo variant (e.g. light-on-dark). Defaults to the main logo.
              </p>
            </div>
            {data.footerLogoBase64 && (
              <div className="flex items-center gap-3">
                <img
                  src={`data:image/png;base64,${data.footerLogoBase64}`}
                  alt="Footer logo preview"
                  className="w-16 h-16 rounded-lg object-contain bg-[#1a1a2e] border border-[var(--border-secondary)] p-1"
                />
                <button
                  type="button"
                  onClick={(): void => onChange({ footerLogoBase64: undefined })}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => footerLogoInputRef.current?.click()}
            >
              {data.footerLogoBase64 ? "Replace Footer Logo" : "Upload Footer Logo"}
            </Button>
            <input
              ref={footerLogoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleFooterLogoUpload}
            />
            <p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>
          </div>
```

(Note: preview background is dark `#1a1a2e` rather than white so a light-variant logo previews against an approximation of the footer background.)

- [ ] **Step 5: Wire `footerLogoBase64` into the save payload**

In `services/dashboard/src/actions/wizard.ts` (or wherever the wizard form maps to the saved theme config — same file edited in Task 16 Step 3), add `footer_logo: data.footerLogoBase64 ? \`data:image/png;base64,\${data.footerLogoBase64}\` : undefined` to the theme payload.

(Or, if the existing logo path stores the raw base64 string directly, follow the same convention — read the surrounding code to match the existing logo serialization.)

- [ ] **Step 6: Visual verification**

Reload http://localhost:3001/wizard → Theme step → Assets section. Confirm a "Footer logo" card appears with a dark-bg preview tile.

- [ ] **Step 7: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx services/dashboard/src/types/dashboard.ts services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): wizard supports optional footer logo upload

Second upload card in Assets for a footer-specific logo variant.
Preview tile uses a dark background so light-variant logos render
against an approximation of footer bg."
```

---

### Task 17E: SiteThemeTab — mirror footer logo upload card

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`

- [ ] **Step 1: Add footer-logo handling that matches the wizard**

Locate the Assets section in `SiteThemeTab.tsx` (find the existing logo upload pattern via `grep -n "logoBase64\|Upload Logo" services/dashboard/src/components/site-detail/SiteThemeTab.tsx`). Apply the same three additions as Task 17D:

1. A `footerLogoInputRef` ref
2. A `handleFooterLogoUpload` (or equivalent) handler that updates the tab's local state with the new footer logo base64
3. The second upload card JSX from Task 17D Step 4, wired through this tab's state

Read the surrounding pattern first — `SiteThemeTab` manages its own internal state (rather than receiving via props), so adapt the handler to call `setState` instead of `onChange`.

- [ ] **Step 2: Include `footer_logo` in the save payload**

Find the `handleSave` function (or wherever the tab calls `POST /api/sites/save`). Confirm the `configUpdates.theme` object includes `footer_logo` next to `logo`. Add it if missing.

- [ ] **Step 3: Visual verification**

Open http://localhost:3001/sites/<any-test-site>/ → Site Settings → Theme. Scroll to Assets. Confirm the Footer logo card appears alongside the existing Logo card.

- [ ] **Step 4: End-to-end test**

1. Upload a different image as Footer logo
2. Save
3. Verify `site.yaml` on the staging branch now contains `theme.footer_logo: <path-or-base64>`
4. Re-seed KV and visit the site — confirm header still uses the main logo and footer uses the new one

- [ ] **Step 5: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/components/site-detail/SiteThemeTab.tsx
git commit -m "feat(dashboard): site theme tab supports footer logo upload

Mirrors the wizard's footer logo card so post-launch sites can add
or replace the footer logo variant without going through wizard."
```

---

## Phase 5 — Migration & Final Verification

### Task 18: Extend CSV theme-builder to emit the new color fields

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/theme-builder.ts:50-84` (`expandThemeColors`)
- Modify: `services/content-pipeline/src/__tests__/migration/theme-builder.test.ts:4-24` (`ALL_19_KEYS`)

- [ ] **Step 1: Update the test's expected key list**

In the test file, replace the `ALL_19_KEYS` constant with:

```typescript
const ALL_27_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "text",
  "muted",
  "surface",
  "border",
  "heading",
  "link",
  "link_hover",
  "footer_bg",
  "hero_title",
  "must_reads_title",
  "must_reads_bg",
  "article_hero_title",
  "article_hero_meta",
  "feed_title",
  "feed_desc",
  "feed_date",
  "category_header_text",
  "prose_heading",
  "prose_body",
  "footer_text",
  "footer_heading",
  "footer_link",
  "footer_link_hover",
] as const;
```

Then update every reference to `ALL_19_KEYS` in the file to `ALL_27_KEYS`, and update the `toHaveLength(19)` assertion to `toHaveLength(27)`. Rename the test description from "all 19 color keys" to "all 27 color keys".

- [ ] **Step 2: Run the test to verify it now fails**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/theme-builder.test.ts`
Expected: FAIL — `expandThemeColors` returns 19 keys but the test now expects 27.

- [ ] **Step 3: Update `expandThemeColors` to emit the new fields**

In `theme-builder.ts`, replace the `return { … }` block in `expandThemeColors` (lines 59–83) with:

```typescript
  const mutedColor = mixColors(text, background, 0.5);

  return {
    primary,
    secondary,
    accent,
    background,
    text,
    muted: mutedColor,
    surface: bgIsDark
      ? adjustBrightness(background, 0.1)
      : adjustBrightness(background, -0.03),
    border: bgIsDark
      ? adjustBrightness(background, 0.2)
      : adjustBrightness(background, -0.1),
    heading: text,
    link: primary,
    link_hover: accent,
    footer_bg: isDark(primary) ? primary : secondary,
    hero_title: "#ffffff",
    must_reads_title: "#ffffff",
    must_reads_bg: isDark(primary) ? primary : secondary,
    article_hero_title: "#ffffff",
    article_hero_meta: mutedColor,
    feed_title: text,
    feed_desc: mixColors(text, background, 0.2),
    feed_date: mutedColor,
    category_header_text: bgIsDark ? "#ffffff" : "#1a1a1a",
    prose_heading: text,
    prose_body: mixColors(text, background, 0.15),
    footer_text: "#9ca3af",
    footer_heading: "#ffffff",
    footer_link: "#9ca3af",
    footer_link_hover: "#ffffff",
  };
```

(Note: `feed_date: mutedColor` keeps the Task 1 fix consistent. `footer_*` defaults match the CSS layer defaults from Task 5 — fixed greys for footer text since CSV migration doesn't carry footer-specific color info.)

- [ ] **Step 4: Re-run the test**

Run: `cd services/content-pipeline && pnpm vitest run src/__tests__/migration/theme-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full content-pipeline test suite to catch regressions**

Run: `cd services/content-pipeline && pnpm test`
Expected: PASS (all suites green).

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/migration/theme-builder.ts services/content-pipeline/src/__tests__/migration/theme-builder.test.ts
git commit -m "feat(migration): emit all 27 theme color fields from CSV import

CSV theme-builder now generates heading, link, link_hover,
article_hero_meta, and the 4 footer_* fields with sensible
defaults derived from the brand colors. Test updated 19→27 keys."
```

---

### Task 19: Full-workspace verification

**Files:** None modified — verification only.

- [ ] **Step 1: Run typecheck across all packages**

Run: `cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform && pnpm typecheck`
Expected: PASS in every package.

- [ ] **Step 2: Run the site-worker test suite**

Run: `cd packages/site-worker && pnpm test`
Expected: PASS (381 tests at baseline — confirm none regress).

- [ ] **Step 3: Run content-pipeline tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: PASS.

- [ ] **Step 4: Build site-worker production bundle**

Run: `cd packages/site-worker && pnpm build`
Expected: SUCCESS, no warnings about missing CSS vars.

- [ ] **Step 5: Manual smoke test — wizard flow**

In a browser:
1. Start dashboard: `cd services/dashboard && pnpm dev` (port 3001)
2. Open http://localhost:3001/wizard
3. Walk to the Theme step
4. Confirm Text Colors shows 8 fields (Body / Headings / Muted / Link / Link hover / Borders / Surface / Secondary)
5. Expand Advanced Text Colors. Confirm 4 sub-groups: On dark overlays (4 fields now), Feed cards, Article page, **Footer (new)**
6. In Assets → Logo card, confirm the height slider appears
7. In Assets, confirm the new **Footer logo** upload card appears with a dark-bg preview tile

- [ ] **Step 6: Manual smoke test — existing site theme tab**

1. Open http://localhost:3001/sites/<any-test-site>/
2. Go to Site Settings → Theme
3. Confirm the same 5 new fields + Footer subgroup + logo slider appear
4. Pick a value for `article_hero_meta` (e.g. `#888888`) and save
5. Verify the saved site.yaml on the staging branch now contains `theme.colors.article_hero_meta: "#888888"` and `theme.logo_height: <n>`

- [ ] **Step 7: Manual smoke test — site-worker render**

1. Run the site-worker locally: `cd packages/site-worker && pnpm dev`
2. Visit a test site through the dev server
3. Confirm:
   - Article hero byline (date/author) is now muted-colored, not accent-colored
   - Footer text/links still look correct (no visual regression)
   - Setting a non-default header logo height in the dashboard and re-seeding KV changes the header logo size
   - Leaving footer logo height on "auto" makes the footer logo ≈92% of header height
   - Explicitly setting footer logo height to a different value (e.g. 80px when header is 52px) is reflected on the rendered site
   - With no `footer_logo` set, the footer still shows the main logo (regression check)
   - With `footer_logo` set to a different image, the header and footer render different logos

- [ ] **Step 8: Push the branch and open a compare URL**

```bash
git push -u origin theme-settings-expansion
```

Then print the compare URL:
`https://github.com/atomicfuse/atomic-content-platform/compare/asaf-dev...theme-settings-expansion`

(Per CLAUDE.md, `gh pr create` does not work in this token's scope — open the PR through the web UI.)

---

## Out of Scope (Deliberately Deferred)

- **Group-level theme form expansion** — `services/dashboard/src/components/groups/ThemeForm.tsx` only exposes 4 colors. Since groups in this network are used for ad/script clustering, not branding, leaving it as-is is the right call until the full settings redesign.
- **Hero overlay / gradient opacity settings** — not raised by user.
- **Hero overlay opacity / color** — the dark gradient drawn over hero background images is hardcoded. Only the text colors *on top* of overlays are configurable (`hero_title`, `must_reads_title`, `article_hero_title`). Controlling overlay darkness itself would be a separate `hero_overlay_*` field set.
- **Header text color overrides** — header text is hardcoded `#fff` assuming a dark primary. Not in this scope; would warrant its own subgroup.
- **Restructuring the Advanced Text Colors layout** — kept the existing sub-header pattern intentionally per "no drastic UI changes" constraint.
