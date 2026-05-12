# Article Author — Design Spec

**Date:** 2026-05-12

**Goal:** Give each site a configurable author name displayed on article pages, with a random default assigned at site creation.

---

## Problem

All articles across all sites show `author: "Editorial Team"` — a hardcoded default in the content-generation agent. Sites have no identity behind their articles. The `author` field exists in the type system and KV storage but is never configured per-site and not rendered on the live site.

## Solution

1. Add `author` field to `SiteConfig` (top-level, alongside `site_name`/`site_tagline`).
2. Wizard assigns a random realistic name on site creation.
3. Dashboard Identity tab lets users edit the author name.
4. Content pipeline reads the author from site config instead of hardcoding.
5. `ArticleHero` renders a byline on article detail pages.
6. One-time backfill assigns random author names to all existing sites.

## Scope

**In scope:**
- `author` field in SiteConfig type and site.yaml
- Random name generation utility
- Wizard integration (new sites)
- Dashboard Identity tab editing
- Save route handling
- Content pipeline reads author from config
- ArticleHero byline rendering
- Backfill script for existing sites
- KV seed (seed-kv.ts already reads `author` from frontmatter — no changes needed)

**Out of scope:**
- Author on feed cards / homepage (detail page only)
- Retroactive update of existing articles (forward-only)
- Multiple authors per site / author rotation
- Author bio, avatar, or profile page

---

## Data Model

### SiteConfig (`packages/shared-types/src/config.ts`)

New optional field on `SiteConfig`:

```typescript
export interface SiteConfig {
  domain: string;
  site_name: string;
  site_tagline?: string | null;
  author?: string;                // ← NEW: default author name for generated articles
  groups: string[];
  // ... rest unchanged
}
```

Optional for backward compatibility — missing means "Editorial Team" fallback.

### site.yaml (network repo)

```yaml
domain: financenewsbase
site_name: Finance News Base
site_tagline: Your source for financial news
author: Sarah Mitchell            # ← new field
groups: [mock-ads]
active: true
brief:
  # ...
```

### No changes to article types

`ArticleFrontmatter.author` and `ArticleIndexEntry.author` already exist as required strings. No schema changes needed for articles or KV.

---

## Random Name Generator

Utility function generating realistic author names from curated lists:

```typescript
// ~30 first names, ~30 last names = ~900 combinations
const FIRST_NAMES = ["James", "Sarah", "Michael", "Elena", "David", ...];
const LAST_NAMES = ["Mitchell", "Carter", "Rodriguez", "Chen", "Bennett", ...];

function generateAuthorName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}
```

Lives in a shared utility (e.g. `services/dashboard/src/lib/author-names.ts`) — used by both the wizard and the backfill script.

---

## Dashboard Integration

### Identity Tab (`ContentAgentTab.tsx`)

New "Default Author" text input below "Tagline":

- Label: "Default Author"
- Placeholder: "e.g. Sarah Mitchell"
- Initialized from `siteConfig.author ?? ""`
- Saved alongside siteName, siteTagline, audiences, tone in the existing `saveIdentity` handler

### StagingSiteConfig (wizard.ts)

Add `author?: string` to the `StagingSiteConfig` interface.

### Save Route (`/api/sites/save/route.ts`)

Handle `configUpdates.author`:

```typescript
if (configUpdates.author !== undefined) {
  existing.author = configUpdates.author || undefined;
}
```

---

## Content Pipeline

### agent.ts (line 614)

Replace hardcoded author with config-driven value:

```typescript
// Before
author: "Editorial Team",

// After
author: siteName ? (siteAuthor ?? "Editorial Team") : "Editorial Team",
```

Where `siteAuthor` comes from the site config (read alongside `siteName` and `brief` in `getSiteBrief()`).

### getSiteBrief / readSiteBrief

These functions already read `site.yaml` and return `{ siteName, brief }`. Extend to also return `author`:

```typescript
// Return shape becomes:
{ siteName: string; brief: SiteBrief; author?: string }
```

Callers updated to destructure the new field.

---

## Site Worker Rendering

### ArticleHero.astro

Add author byline between title and date:

```astro
<h1 class="article-hero-title">{article.title}</h1>
<p class="article-hero-meta">
  <span class="article-hero-author">By {article.author}</span>
  <span class="article-hero-separator">&middot;</span>
  <span class="article-hero-date">{date}</span>
</p>
```

Styled to match the existing date styling — accent color, slightly smaller than title.

Only renders author if `article.author` is present and non-empty. Falls back to date-only display if missing.

---

## Wizard Integration

In `createSiteAndBuildStaging()`, add author to the site config object:

```typescript
{
  domain: projectName,
  site_name: data.siteName,
  site_tagline: data.siteTagline || null,
  author: generateAuthorName(),    // ← random name
  groups: data.groups.length > 0 ? data.groups : ["mock-ads"],
  // ...
}
```

No UI input for author in the wizard — it's auto-generated. Users can change it later in Identity settings.

---

## Existing Sites Backfill

One-time Node script that:

1. Reads `dashboard-index.yaml` from the network repo
2. For each site with a staging branch:
   - Reads `sites/<domain>/site.yaml` from the staging branch
   - If `author` field is missing, assigns `generateAuthorName()`
   - Commits updated `site.yaml` back to the staging branch
3. For sites on main only (no staging branch): skips (they'll get an author when next edited)
4. Triggers KV sync workflow after all commits

Run manually once via `npx ts-node scripts/backfill-authors.ts` or similar.

---

## Backward Compatibility

- `author` is optional on `SiteConfig` — old configs without it still work
- Content pipeline falls back to "Editorial Team" if `author` is missing
- ArticleHero renders date-only if no author present
- Existing article frontmatter is untouched — per-article `author` values are preserved
- KV seed-kv.ts already defaults to "Editorial Team" for articles without author — no changes needed
