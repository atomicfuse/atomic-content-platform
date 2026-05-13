# Per-Article Script Injection — Design Spec

**Date:** 2026-05-13
**Status:** Draft
**Goal:** Allow dashboard users to attach custom scripts (tracking, quizzes, widgets, etc.) to individual articles, controlling where each script appears in the rendered page.

---

## Data Model

### Frontmatter Schema

A new optional `scripts` array field in article YAML frontmatter (`sites/<domain>/articles/<slug>.md`):

```yaml
scripts:
  - id: "quiz-1"
    name: "Trivia Quiz"
    position: "after-paragraph-3"
    content: '<script src="https://example.com/quiz.js"></script>'
  - id: "tracking-pixel"
    name: "Campaign Pixel"
    position: "head"
    content: '<script>/* inline tracking code */</script>'
```

### Script Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Auto-generated unique ID (e.g. `crypto.randomUUID()` on the client). Used for stable React keys and edit/delete targeting. |
| `name` | `string` | Yes | Human-readable label (e.g. "Campaign Pixel", "Quiz Widget"). |
| `position` | `string` | Yes | Where to inject. One of: `head`, `before-content`, `after-content`, or `after-paragraph-{N}` where N >= 1. |
| `content` | `string` | Yes | Raw HTML script tag(s). Can be `<script src="..."></script>`, inline `<script>...</script>`, or multiple tags. |

### Type Definition

Add to `packages/shared-types/src/article.ts`:

```typescript
export type ArticleScriptPosition =
  | "head"
  | "before-content"
  | "after-content"
  | `after-paragraph-${number}`;

export interface ArticleScript {
  id: string;
  name: string;
  position: ArticleScriptPosition;
  content: string;
}
```

Extend `ArticleFrontmatter` (used by the dashboard and content-pipeline):

```typescript
export interface ArticleFrontmatter {
  // ... existing fields ...
  scripts?: ArticleScript[];
}
```

**Note:** The site-worker uses `ArticleIndexEntry` (from `kv-schema.ts`) at runtime, not `ArticleFrontmatter`. Both types need the `scripts?` field, but the rendering path depends on `ArticleIndexEntry`. See the KV Schema section below.

### Validation Rules

- `name`: non-empty string, max 100 characters.
- `position`: must match one of the valid position patterns (`head`, `before-content`, `after-content`, or `after-paragraph-{N}` where N is a positive integer).
- `content`: must contain at least one `<script` tag (case-insensitive). Max 50 KB.
- `id`: non-empty string, unique within the article's scripts array.
- Maximum 20 scripts per article.

---

## Dashboard Changes

### 1. Article Detail Route

**New route:** `/sites/[domain]/articles/[slug]`

**File:** `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx`

This is a **standalone page** — it does NOT render inside `SiteDetailTabs`. It uses the same top-level dashboard layout but has its own page structure.

A server component page that:
1. Looks up the site entry from `dashboard-index.yaml` to get the staging branch.
2. Reads the article markdown from the network repo (staging branch first, falls back to main).
3. Parses frontmatter to extract metadata and scripts.
4. Renders an article metadata summary header and the `ArticleScriptsPanel` client component.

**Article metadata header** (read-only):
- Back link to `/sites/[domain]` ("Back to Site" navigation)
- Title, status badge, quality score, type, publish date, author
- Preview link (opens Worker staging URL)

### 2. ArticleScriptsPanel Component

**File:** `services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx`

A client component that manages the scripts array for an article.

**Props:**
```typescript
interface ArticleScriptsPanelProps {
  domain: string;
  slug: string;
  stagingBranch: string | null;
  initialScripts: ArticleScript[];
}
```

**UI structure:**

1. **Scripts list** — each script displays:
   - Name (bold) + position badge (colored pill: cyan for head, violet for before/after-content, amber for after-paragraph-N)
   - Truncated content preview (first 80 chars of `content`, monospace, muted)
   - Edit button (pencil icon) — opens inline edit form
   - Delete button (trash icon) — removes with confirmation

2. **Add Script button** — opens inline form at the bottom of the list

3. **Script form** (used for both add and edit):
   - Name: text input
   - Position: dropdown select with options:
     - `head` — "Page Head"
     - `before-content` — "Before Article"
     - `after-content` — "After Article"
     - `after-paragraph-{N}` — "After Paragraph..." (selecting this shows a number input for N)
   - Content: textarea (monospace font, ~6 rows)
   - Save / Cancel buttons

4. **Save behavior:**
   - Calls `PUT /api/articles/[domain]/[slug]/scripts` with the full updated scripts array
   - Shows toast on success/error
   - Disables form during save

**Empty state:** "No scripts attached to this article. Click 'Add Script' to inject tracking, widgets, or other scripts."

### 3. Content Tab Link

**Modify:** `services/dashboard/src/components/site-detail/ContentTab.tsx`

Make the article title in the table a clickable link to `/sites/[domain]/articles/[slug]`. Currently it's just text.

### 4. API Routes

#### `GET /api/articles/[domain]/[slug]`

**File:** `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts`

Reads the article **raw markdown** from the network repo (Git source, not KV). Determines the staging branch by looking up the site in `dashboard-index.yaml`. Tries staging branch first, falls back to main.

**Response (200):**
```json
{
  "slug": "best-thriller-movies",
  "frontmatter": {
    "title": "Best Thriller Movies",
    "status": "published",
    "type": "listicle",
    "publishDate": "2026-05-10",
    "author": "Editorial Team",
    "tags": ["movies", "thriller"],
    "quality_score": 85,
    "scripts": [
      { "id": "abc", "name": "Quiz", "position": "after-paragraph-3", "content": "<script>...</script>" }
    ]
  },
  "body": "## Article body markdown...",
  "branch": "staging/coolnews.dev"
}
```

**Error responses:** 404 if article not found on either branch.

#### `PUT /api/articles/[domain]/[slug]/scripts`

**File:** `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts`

Updates only the `scripts` field in the article's frontmatter. Does not touch the body or other frontmatter fields.

**Request body:**
```json
{
  "scripts": [
    { "id": "abc", "name": "Quiz", "position": "after-paragraph-3", "content": "<script>...</script>" }
  ]
}
```

**Flow:**
1. Read current article markdown from staging branch (looked up via `dashboard-index.yaml`).
2. Parse frontmatter using `parseFrontmatter()` from `@/lib/article-upload`.
3. Validate each script entry (name, position format, content contains `<script`, max 20 scripts).
4. Replace `scripts` field in frontmatter, preserve everything else.
5. Reconstruct markdown using `stringifyYaml(fm, { lineWidth: 0 })` + original body. The `lineWidth: 0` setting ensures the `yaml` library correctly handles multiline script content (inline JS with special characters like `:`, `#`, `{`, `}`, quotes) by choosing appropriate YAML scalar styles.
6. Commit via `commitNetworkFiles()` to staging branch.
7. Return 200 with updated frontmatter.

**Error responses:** 400 (validation), 404 (article not found), 500 (commit failure).

---

## Site-Worker Rendering Changes

### Data Flow Overview

Articles flow through three stages:
1. **Git (network repo):** Raw markdown with YAML frontmatter — this is what the dashboard reads and writes.
2. **seed-kv.ts:** Converts markdown body to HTML via `marked.parse()`, stores `ArticleRecord` in KV.
3. **Site-worker (runtime):** Reads HTML body from KV, injects ads and scripts, renders via `set:html`.

The `injectArticleScripts()` function operates on **HTML** (stage 3), not raw markdown.

### Script Injection Function

**New file:** `packages/site-worker/src/lib/inject-scripts.ts`

```typescript
export interface InjectionResult {
  headScripts: string;      // HTML to inject in <head>
  bodyHtml: string;          // Article body HTML with before/after/paragraph scripts injected
}

export function injectArticleScripts(
  body: string,
  scripts: ArticleScript[] | undefined,
): InjectionResult
```

**Logic:**
- If `scripts` is undefined or empty, return `{ headScripts: "", bodyHtml: body }`.
- Partition scripts by position type:
  - `head` → concatenate into `headScripts` string
  - `before-content` → prepend to body HTML
  - `after-content` → append to body HTML
  - `after-paragraph-N` → insert after the Nth `</p>` tag (1-indexed). If N exceeds paragraph count, append to end. Uses the same paragraph-counting pattern as `injectInlineAds()`.

### Article Page Update

**Modify:** `packages/site-worker/src/pages/[slug]/index.astro`

**Injection order:** `injectInlineAds(body)` first, then `injectArticleScripts(adsInjectedBody)`. Ad slots inject `<div>` elements (not `<p>` tags), so paragraph numbering for `after-paragraph-N` scripts is unaffected by the ad injection step.

1. Run `injectInlineAds(article.body, placements)` as before.
2. Call `injectArticleScripts(adsInjectedBody, article.frontmatter.scripts)` to get `{ headScripts, bodyHtml }`.
3. Use `bodyHtml` for the `set:html` article body fragment.
4. Inject `headScripts` in `<head>` via Astro's named slot: add a second `<Fragment slot="head" set:html={headScripts} />` after the existing SEO head fragment. `BaseLayout.astro` already has `<slot name="head" />` which accepts multiple contributions.

### KV Schema Update

**Modify:** `packages/site-worker/src/lib/kv-schema.ts`

Add `scripts` to `ArticleIndexEntry` (this is the runtime type the Worker reads from KV):

```typescript
import type { ArticleScript } from "@atomic-platform/shared-types";

export interface ArticleIndexEntry {
  // ... existing fields ...
  scripts?: ArticleScript[];
}
```

### Seed-KV Update (Required)

**Modify:** `packages/site-worker/scripts/seed-kv.ts`

The `loadArticles` function constructs `ArticleIndexEntry` with an **explicit field whitelist** — it does NOT pass through unknown frontmatter fields. The `scripts` field must be explicitly added to the construction.

In the `loadArticles` function, add to the frontmatter object construction:

```typescript
const frontmatter: ArticleIndexEntry = {
  // ... existing fields ...
  scripts: Array.isArray(front.scripts) ? (front.scripts as ArticleScript[]) : undefined,
};
```

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx` | Article detail page (standalone server component, not inside SiteDetailTabs) |
| `services/dashboard/src/components/site-detail/ArticleScriptsPanel.tsx` | Scripts management UI (client component) |
| `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts` | GET article content API |
| `services/dashboard/src/app/api/articles/[domain]/[slug]/scripts/route.ts` | PUT scripts update API |
| `packages/site-worker/src/lib/inject-scripts.ts` | Script injection into article HTML |

### Modified Files

| File | Change |
|------|--------|
| `packages/shared-types/src/article.ts` | Add `ArticleScript` interface, `ArticleScriptPosition` type, `scripts?` field to `ArticleFrontmatter` |
| `packages/site-worker/src/lib/kv-schema.ts` | Add `scripts?` to `ArticleIndexEntry` (import `ArticleScript` from shared-types) |
| `packages/site-worker/src/pages/[slug]/index.astro` | Call `injectArticleScripts()`, add head scripts via `<Fragment slot="head">` |
| `packages/site-worker/scripts/seed-kv.ts` | Add `scripts` to the explicit field whitelist in `loadArticles` |
| `services/dashboard/src/components/site-detail/ContentTab.tsx` | Make article titles clickable links to detail page |

---

## Out of Scope

- Markdown body editing in the dashboard
- Script validation beyond `<script` tag presence check
- Script execution preview in the dashboard (use Worker preview)
- Script ordering/priority (rendered in array order)
- Script deduplication across articles
- CSP (Content Security Policy) configuration
