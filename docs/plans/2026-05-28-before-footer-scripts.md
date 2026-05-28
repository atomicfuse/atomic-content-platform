# `before_footer` Script Position — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `before_footer` position to site-level `ScriptsConfig` so users can inject scripts (e.g. infinite-scroll feed widgets) between the last content section and the footer on every page.

**Architecture:** Add `before_footer: ScriptEntry[]` to `ScriptsConfig` alongside the existing `head`/`body_start`/`body_end`. Thread it through the merge-by-id resolution pipeline, the `resolveScriptVars` substitution, the BaseLayout staging filter, and all 5 page templates that render `<Footer>`. The dashboard already handles ScriptsConfig generically via `ScriptsEditor` — adding a new key to the SECTIONS array is sufficient.

**Tech Stack:** TypeScript, Astro 6, React 19, Next.js 15, pnpm monorepo

---

### Task 1: Add `before_footer` to the `ScriptsConfig` type

**Files:**
- Modify: `packages/shared-types/src/config.ts:411-420`

**Step 1: Edit the ScriptsConfig interface**

Add `before_footer` after `body_end`:

```typescript
export interface ScriptsConfig {
  /** Scripts injected into the document `<head>`. */
  head: ScriptEntry[];

  /** Scripts injected immediately after the opening `<body>` tag. */
  body_start: ScriptEntry[];

  /** Scripts injected just before the closing `</body>` tag. */
  body_end: ScriptEntry[];

  /** Scripts injected immediately before the `<footer>` element. */
  before_footer: ScriptEntry[];
}
```

**Step 2: Verify typecheck catches all consumers**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`

Expected: Multiple type errors in files that construct `ScriptsConfig` objects without `before_footer`. This is good — it maps out exactly what needs updating.

**Step 3: Commit**

```bash
git add packages/shared-types/src/config.ts
git commit -m "feat(shared-types): add before_footer to ScriptsConfig"
```

---

### Task 2: Update merge-by-id resolution in `resolve.ts`

**Files:**
- Modify: `packages/site-worker/scripts/lib/resolve.ts:59-123` (ScriptsLike, SCRIPT_POSITIONS, mergeScriptLayers, return type)
- Modify: `packages/site-worker/scripts/lib/resolve.ts:303-328` (resolveScriptVars)

**Step 1: Add `before_footer` to the local types and constant**

In `ScriptsLike` (line 64-68), add:
```typescript
interface ScriptsLike {
  head?: ScriptEntryLike[];
  body_start?: ScriptEntryLike[];
  body_end?: ScriptEntryLike[];
  before_footer?: ScriptEntryLike[];
}
```

Update `SCRIPT_POSITIONS` (line 70):
```typescript
const SCRIPT_POSITIONS = ['head', 'body_start', 'body_end', 'before_footer'] as const;
```

**Step 2: Update `mergeScriptLayers` return type and replace-mode handling**

Return type (line 87):
```typescript
): { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[]; before_footer: ScriptEntryLike[] } {
```

Replace-mode block (lines 93-97):
```typescript
    return {
      head: Array.isArray(scripts?.head) ? scripts.head : [],
      body_start: Array.isArray(scripts?.body_start) ? scripts.body_start : [],
      body_end: Array.isArray(scripts?.body_end) ? scripts.body_end : [],
      before_footer: Array.isArray(scripts?.before_footer) ? scripts.before_footer : [],
    };
```

Default result (lines 100-104):
```typescript
  const result: Record<string, ScriptEntryLike[]> = {
    head: [],
    body_start: [],
    body_end: [],
    before_footer: [],
  };
```

Return cast (line 122):
```typescript
  return result as { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[]; before_footer: ScriptEntryLike[] };
```

**Step 3: Update `resolveScriptVars` signatures**

Parameter type (line 304):
```typescript
  scripts: { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[]; before_footer: ScriptEntryLike[] },
```

Return type (line 306):
```typescript
): { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[]; before_footer: ScriptEntryLike[] } {
```

Return block (lines 324-328):
```typescript
  return {
    head: scripts.head.map(substituteEntry),
    body_start: scripts.body_start.map(substituteEntry),
    body_end: scripts.body_end.map(substituteEntry),
    before_footer: scripts.before_footer.map(substituteEntry),
  };
```

**Step 4: Commit**

```bash
git add packages/site-worker/scripts/lib/resolve.ts
git commit -m "feat(site-worker): add before_footer to script merge and var resolution"
```

---

### Task 3: Update existing tests for `before_footer`

**Files:**
- Modify: `packages/site-worker/scripts/__tests__/resolve.test.ts`

**Step 1: Update test assertions**

Every `mergeScriptLayers` test that checks the result shape needs `before_footer: []` (or the expected entries) in its assertion. Search for all `expect(result)` calls in the `mergeScriptLayers` describe block and add `before_footer` to each expected object.

For example, the "empty layers" test should expect:
```typescript
expect(result).toEqual({ head: [], body_start: [], body_end: [], before_footer: [] });
```

**Step 2: Add a test for `before_footer` merge**

```typescript
it('merges before_footer entries by id', () => {
  const org = { scripts: { before_footer: [{ id: 'feed', src: 'https://example.com/feed.js' }] } };
  const site = { scripts: { before_footer: [{ id: 'feed', src: 'https://new.com/feed.js' }] } };
  const result = mergeScriptLayers([org, site]);
  expect(result.before_footer).toEqual([{ id: 'feed', src: 'https://new.com/feed.js' }]);
});
```

**Step 3: Run tests**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/site-worker test`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add packages/site-worker/scripts/__tests__/resolve.test.ts
git commit -m "test(site-worker): update resolve tests for before_footer position"
```

---

### Task 4: Update `BaseLayout.astro` staging filter

**Files:**
- Modify: `packages/site-worker/src/layouts/BaseLayout.astro:32-37`

**Step 1: Add before_footer extraction and staging filter**

After line 34 (`const allBodyEndScripts = scripts?.body_end ?? [];`), add:
```typescript
const allBeforeFooterScripts = scripts?.before_footer ?? [];
```

After line 37 (`const bodyEndScripts = ...`), add:
```typescript
const beforeFooterScripts = staging ? allBeforeFooterScripts.filter(isLocalScript) : allBeforeFooterScripts;
```

**Step 2: Expose `beforeFooterScripts` via a named slot**

BaseLayout renders the `<slot />` (the child page content), then body_end scripts at the bottom of `<body>`. Since the Footer lives inside child pages (not in BaseLayout), we can't inject before_footer here. Instead, we pass it down via Astro's `define:vars`.

Actually, the cleaner approach: **expose `beforeFooterScripts` from `getConfig()`** — since all pages already call `getConfig(Astro)` and access `config.scripts`, the page templates can read `config.scripts.before_footer` directly. BaseLayout only needs the staging filter.

The approach: modify the staging filter logic so stale before_footer scripts are also filtered. Then each page template reads `config.scripts.before_footer` directly (applied in Task 5).

But wait — the staging filter happens in BaseLayout, not in `getConfig()`. The config object still has all scripts. The staging filter is a presentation-time concern only for the positions that BaseLayout renders directly (head, body_start, body_end).

Since `before_footer` will be rendered by individual page templates (not BaseLayout), we need to either:
- (a) Apply the staging filter in each page template, or
- (b) Apply it once in `getConfig()`, or
- (c) Create a shared helper

Best approach: **(c) Create a small utility** in `config.ts` that filters scripts for staging. But the simplest approach matching the existing pattern: since BaseLayout already has all scripts and the staging check, **pass the filtered `beforeFooterScripts` to child content via `define:vars` on the slot wrapper, and have page templates read it**. 

Actually, the simplest approach that matches the codebase: **apply the staging filter directly in each page template** using the same `isLocalScript` check. But this duplicates logic.

**Recommended approach:** Add `before_footer` to BaseLayout's staging filter (for consistency), and export the filtering utility for page templates. But since the Footer is rendered by page templates, the cleanest solution is:

**Move the injection into the Footer component itself.** Footer already receives `config: ResolvedConfig` which includes `config.scripts.before_footer`. Footer can render the scripts immediately before its own `<footer>` tag. This way:
- One place to render (Footer.astro), not 5 page templates
- Staging filter needs to be applied in Footer — pass `staging` as a prop, or have Footer compute it

**Final decision: Render `before_footer` scripts inside Footer.astro**, prepended before the `<footer>` element. Pass `staging` as a boolean prop. This touches 1 component + 5 call sites (to add the prop), instead of adding rendering logic to 5 separate pages.

**Step 1 (revised): Add `staging` prop to Footer.astro**

In `packages/site-worker/src/themes/modern/components/Footer.astro`, update the Props interface:

```typescript
interface Props {
  config: ResolvedConfig;
  staging?: boolean;
}
```

And destructure:
```typescript
const { config, staging = false } = Astro.props;
```

**Step 2: Add before_footer rendering at the top of Footer.astro template**

Before the `<footer class="site-footer">` element, add:

```astro
{/* before_footer scripts — injected from site-level config */}
{(() => {
  const allBF = config.scripts?.before_footer ?? [];
  const bfScripts = staging ? allBF.filter((s) => !!s.src?.startsWith('/')) : allBF;
  return bfScripts.length > 0 ? bfScripts : [];
})().map((s) =>
  s.src
    ? <script is:inline async={s.async} src={s.src}></script>
    : s.inline
      ? <script is:inline set:html={s.inline} />
      : null
)}
{(() => {
  const allBF = config.scripts?.before_footer ?? [];
  const bfScripts = staging ? allBF.filter((s) => !!s.src?.startsWith('/')) : allBF;
  return bfScripts;
})().filter(s => !s.src && !s.inline).length === 0 && (() => {
  // Render raw HTML entries (like <div data-cg-feed="...">)
  return null;
})()}
```

Wait — this is getting complex. Let me simplify. The `ScriptEntry` type has `src` (external) or `inline` (JS code). But the user's use case is:
```html
<script src="https://...feed-widget.js" async></script>
<div data-cg-feed="journey_peaks_1"></div>
```

The `<script>` part maps to a ScriptEntry with `src`. But the `<div>` is not a script — it's raw HTML. Looking at how the current article-level scripts work, the `content` field in `ArticleScript` holds raw HTML. But site-level `ScriptEntry` only has `src` and `inline`.

Hmm — actually, looking at how `body_end` inline scripts work: inline content is wrapped in `window.addEventListener('load', ...)`. For `before_footer`, we should NOT wrap inline content that way — it should be direct injection.

For the `<div data-cg-feed="...">` part, the user would need to put it in an `inline` entry. But `inline` is rendered as `<script set:html={...} />`, which wraps it in script tags.

**The solution:** For `before_footer`, render `inline` entries as raw HTML (using `set:html`), not wrapped in `<script>` tags. This allows users to put both `<script>` tags and `<div>` tags in the inline content. The external `src` entries render as `<script>` tags as usual.

This matches how article-level scripts work — the `content` field holds raw HTML including `<script>` tags and arbitrary HTML.

Let me reconsider: the simplest approach that works for the user's case:
- `src` entry → renders as `<script src="..." async></script>`
- `inline` entry → renders as raw HTML via `Fragment set:html` (NOT wrapped in `<script>` tags)

This way the user adds two entries:
1. External: `{ id: "feed-js", src: "https://.../feed-widget.js", async: true }`
2. Inline: `{ id: "feed-div", inline: "<div data-cg-feed=\"journey_peaks_1\"></div>" }`

Or even simpler — one inline entry with both:
```
{ id: "feed-widget", inline: "<script src=\"...\"></script>\n<div data-cg-feed=\"...\"></div>" }
```

**Revised rendering in Footer.astro:**

```astro
---
// ... existing frontmatter ...
const beforeFooterScripts = (() => {
  const all = config.scripts?.before_footer ?? [];
  return staging ? all.filter((s: { src?: string }) => !!s.src?.startsWith('/')) : all;
})();
---

{beforeFooterScripts.map((s) =>
  s.src
    ? <script is:inline async={s.async} src={s.src}></script>
    : s.inline
      ? <Fragment set:html={s.inline} />
      : null
)}
<footer class="site-footer">
  ...existing footer content...
</footer>
```

Key difference from `body_end`: inline `before_footer` entries render as **raw HTML** (via `Fragment set:html`), not wrapped in `<script>`. This lets users inject both `<script>` tags and HTML elements (like `<div data-cg-feed="...">`).

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "feat(site-worker): render before_footer scripts in Footer component"
```

---

### Task 5: Pass `staging` prop to Footer in all page templates

**Files:**
- Modify: `packages/site-worker/src/pages/[slug]/index.astro:139`
- Modify: `packages/site-worker/src/pages/index.astro:117`
- Modify: `packages/site-worker/src/pages/category/[topic].astro:145`
- Modify: `packages/site-worker/src/pages/search.astro:55`
- Modify: `packages/site-worker/src/layouts/PageLayout.astro:51`

In each file, change:
```astro
<Footer config={config} />
```
to:
```astro
<Footer config={config} staging={staging} />
```

Each of these pages already has access to `staging` — it's computed in BaseLayout or via `isStagingEnv(Astro)`. Check each file:

- `[slug]/index.astro`: Check if `staging` or `isStagingEnv` is already imported/computed. If not, add: `const staging = isStagingEnv(Astro);` in the frontmatter and `import { isStagingEnv } from '../../lib/staging';` (or wherever it comes from — check the BaseLayout import).
- `index.astro`: Same check.
- `category/[topic].astro`: Same check.
- `search.astro`: Same check.
- `PageLayout.astro`: Same check.

**Note:** If a page doesn't already have the staging check, look at how BaseLayout imports it. The pattern is `import { isStagingEnv } from '../lib/staging'` or similar. Grep for the import.

**Step 1: Find the staging utility import**

Run: `grep -rn 'isStagingEnv' packages/site-worker/src/ --include='*.astro' --include='*.ts' | head -10`

**Step 2: Add staging prop to each Footer call**

For each of the 5 files, if they don't already compute `staging`:
1. Add the import for `isStagingEnv`
2. Add `const staging = isStagingEnv(Astro);` in the frontmatter
3. Change `<Footer config={config} />` to `<Footer config={config} staging={staging} />`

**Step 3: Run typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`

Expected: No errors.

**Step 4: Commit**

```bash
git add packages/site-worker/src/pages/[slug]/index.astro
git add packages/site-worker/src/pages/index.astro
git add packages/site-worker/src/pages/category/[topic].astro
git add packages/site-worker/src/pages/search.astro
git add packages/site-worker/src/layouts/PageLayout.astro
git commit -m "feat(site-worker): pass staging prop to Footer for before_footer filtering"
```

---

### Task 6: Add runtime default in `getConfig()`

**Files:**
- Modify: `packages/site-worker/src/lib/config.ts:27-48`

Per landmine #38: any new config field needs a runtime default so stale KV entries don't crash.

**Step 1: Add the default**

After `config.layout` backfill block (around line 46), before `return config;`, add:

```typescript
  // Backfill before_footer if missing (stale KV entries pre-date this field).
  if (config.scripts) {
    (config.scripts as Record<string, unknown>).before_footer ??= [];
  }
```

**Step 2: Commit**

```bash
git add packages/site-worker/src/lib/config.ts
git commit -m "fix(site-worker): runtime default for before_footer on stale KV configs"
```

---

### Task 7: Update dashboard — normalizer, default, ScriptsEditor, and save route

**Files:**
- Modify: `services/dashboard/src/lib/config-normalizers.ts:51-55`
- Modify: `services/dashboard/src/components/config/UnifiedConfigForm.tsx:102-106`
- Modify: `services/dashboard/src/components/settings/ScriptsEditor.tsx:25-29`

**Step 1: Update `normalizeScripts` to include `before_footer`**

In `config-normalizers.ts`, change the return block (lines 51-55):

```typescript
  return {
    head: normalizeEntries(raw?.head),
    body_start: normalizeEntries(raw?.body_start),
    body_end: normalizeEntries(raw?.body_end),
    before_footer: normalizeEntries(raw?.before_footer),
  };
```

**Step 2: Update `DEFAULT_SCRIPTS` in `UnifiedConfigForm.tsx`**

Change lines 102-106:

```typescript
const DEFAULT_SCRIPTS: ScriptsConfig = {
  head: [],
  body_start: [],
  body_end: [],
  before_footer: [],
};
```

**Step 3: Update `SECTIONS` in `ScriptsEditor.tsx`**

Change lines 25-29:

```typescript
const SECTIONS: Array<{ key: ScriptPosition; label: string }> = [
  { key: "head", label: "Head" },
  { key: "body_start", label: "Body Start" },
  { key: "body_end", label: "Body End" },
  { key: "before_footer", label: "Before Footer" },
];
```

**Step 4: Run typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`

Expected: No errors (the save route at `api/sites/save/route.ts` already iterates `Object.entries(scripts)` dynamically — it doesn't hardcode position names, so it handles `before_footer` automatically).

**Step 5: Commit**

```bash
git add services/dashboard/src/lib/config-normalizers.ts
git add services/dashboard/src/components/config/UnifiedConfigForm.tsx
git add services/dashboard/src/components/settings/ScriptsEditor.tsx
git commit -m "feat(dashboard): add before_footer section to scripts editor"
```

---

### Task 8: Update org.yaml default

**Files:**
- Modify: `../atomic-labs-network/org.yaml` (lines 27-32)

**Step 1: Add before_footer to org.yaml**

```yaml
scripts:
  head: []
  body_start: []
  body_end: []
  before_footer: []
```

**Step 2: Commit (in the network repo)**

This is in the network repo, not the platform repo. Commit separately.

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-labs-network
git add org.yaml
git commit -m "feat: add before_footer to org scripts config"
```

---

### Task 9: Full typecheck + test suite

**Step 1: Typecheck all packages**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`

Expected: Clean — no errors.

**Step 2: Run full test suite**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm test`

Expected: All 381+ tests pass.

**Step 3: Commit any remaining fixes**

If any tests fail, fix them and commit.

---

### Task 10: Manual verification

**Step 1: Seed a test site with before_footer scripts**

Add a `before_footer` entry to travelswire's site.yaml (on a staging branch) or a test group config:

```yaml
scripts:
  before_footer:
    - id: test-feed
      src: https://ob-mock-ad-tester-9116.atomic.cloudgrid.io/feed-widget.js
      async: true
```

Run seed-kv for the site to push the config to staging KV.

**Step 2: Verify in the staging worker**

Open the staging worker URL with `?_atl_site=travelswire` and navigate to an article. Scroll to the footer. The feed-widget.js script tag should appear in the DOM immediately before the `<footer class="site-footer">` element.

**Step 3: Check the dashboard**

Open the dashboard, navigate to a site's Config tab. The Scripts section should show a fourth tab: "Before Footer". Adding/removing entries should save correctly.

**Step 4: Clean up test config and preview HTML**

Remove the test entries from site.yaml. Delete `feed-widget-preview.html` from the project root.

---

## Summary of all files changed

### Platform repo (`atomic-content-platform`)
| File | Change |
|------|--------|
| `packages/shared-types/src/config.ts` | Add `before_footer: ScriptEntry[]` to `ScriptsConfig` |
| `packages/site-worker/scripts/lib/resolve.ts` | Add `before_footer` to `ScriptsLike`, `SCRIPT_POSITIONS`, `mergeScriptLayers`, `resolveScriptVars` |
| `packages/site-worker/scripts/__tests__/resolve.test.ts` | Update assertions, add `before_footer` merge test |
| `packages/site-worker/src/themes/modern/components/Footer.astro` | Accept `staging` prop, render `before_footer` scripts before `<footer>` |
| `packages/site-worker/src/pages/[slug]/index.astro` | Pass `staging` to Footer |
| `packages/site-worker/src/pages/index.astro` | Pass `staging` to Footer |
| `packages/site-worker/src/pages/category/[topic].astro` | Pass `staging` to Footer |
| `packages/site-worker/src/pages/search.astro` | Pass `staging` to Footer |
| `packages/site-worker/src/layouts/PageLayout.astro` | Pass `staging` to Footer |
| `packages/site-worker/src/lib/config.ts` | Runtime default for `before_footer` on stale KV |
| `services/dashboard/src/lib/config-normalizers.ts` | Add `before_footer` to normalizer |
| `services/dashboard/src/components/config/UnifiedConfigForm.tsx` | Add `before_footer` to `DEFAULT_SCRIPTS` |
| `services/dashboard/src/components/settings/ScriptsEditor.tsx` | Add "Before Footer" to `SECTIONS` |

### Network repo (`atomic-labs-network`)
| File | Change |
|------|--------|
| `org.yaml` | Add `before_footer: []` to scripts |

### Cleanup
| File | Action |
|------|--------|
| `feed-widget-preview.html` | Delete (preview mockup, no longer needed) |
