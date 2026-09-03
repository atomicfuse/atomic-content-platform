# Copy Articles Between Sites — Design Spec

**Date:** 2026-06-08
**Status:** Approved

## Problem

There is no way to copy articles (including their R2 images) from one site to another. When content fits multiple sites or a site is being restructured, articles must be manually recreated.

## Solution

A dedicated page at `/tools/copy-articles` that lets the user select a source site, a target site, and specific articles to copy. The operation copies both Git markdown files and R2 images, handling slug conflicts by skipping.

## User Flow

1. Navigate to Tools → Copy Articles in the sidebar.
2. Select source site from dropdown (all sites from `dashboard-index.yaml`).
3. Select target site from dropdown (excludes source).
4. Article checklist loads from source site's staging branch. All selected by default with a "Deselect all" toggle.
5. Click "Copy Articles" button.
6. Progress indicator while operation runs.
7. Summary banner: N copied, M skipped (with reasons).

## Architecture

### Page

`services/dashboard/src/app/tools/copy-articles/page.tsx`

- Server component wrapper, client component for interactive state.
- Two site selector dropdowns populated from `dashboard-index.yaml` via existing `readDashboardIndex()`.
- Article checklist fetched from `/api/articles/list?domain=<source>` or via `readArticles()` server action.
- Copy button triggers POST to `/api/articles/copy`.

### API Route

`services/dashboard/src/app/api/articles/copy/route.ts`

**Request:**

```json
{
  "sourceDomain": "travelswire",
  "targetDomain": "wineoceans",
  "slugs": ["slug-a", "slug-b", "slug-c"]
}
```

**Process:**

1. Read `dashboard-index.yaml` to get staging branches for both sites.
2. Read target site's article list to identify existing slugs.
3. Partition requested slugs into copyable vs. conflicting.
4. For each copyable article:
   a. Read full markdown content from source staging branch.
   b. If `featuredImage` exists, copy R2 object from `<source>/assets/images/<file>` to `<target>/assets/images/<file>`.
5. Commit all article markdown files to target staging branch in a single atomic commit via `commitNetworkFiles()`.
6. Invalidate caches for the target site.

**Response:**

```json
{
  "copied": ["slug-a", "slug-b"],
  "skipped": [{ "slug": "slug-c", "reason": "Already exists on target site" }],
  "warnings": ["R2 image not found for slug-a, article copied without image"]
}
```

### Data Flow

```
Source staging branch                    Target staging branch
sites/<source>/articles/slug.md    →    sites/<target>/articles/slug.md

Source R2                                Target R2
<source>/assets/images/slug.webp   →    <target>/assets/images/slug.webp
```

The frontmatter `featuredImage` field (e.g., `/assets/images/slug.webp`) is domain-relative — no rewriting needed.

### Sidebar

Add a "Tools" section to the sidebar navigation between existing sections:

```
Sites
Review
...
Tools
  Copy Articles
Settings
...
```

## Conflict Handling

- Before copying, read the target site's article list from its staging branch.
- Any slug already present on the target is skipped.
- Skipped articles are reported in the response with the reason.
- No overwrite, no auto-rename.

## R2 Image Copy

- For each article with a non-empty `featuredImage`, extract the filename from the path.
- GetObject from `<sourceDomain>/assets/images/<filename>` in `atl-assets-prod`.
- PutObject to `<targetDomain>/assets/images/<filename>` in `atl-assets-prod`.
- If R2 credentials are not configured, skip image copy entirely with a warning per article.
- If a specific source image doesn't exist in R2, skip that image with a warning — the article markdown is still copied.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Source site has no articles | Show empty state: "No articles found on source site" |
| All selected articles conflict | Show summary: "All articles skipped — they already exist on the target site" |
| R2 image missing for an article | Copy article anyway, add warning to response |
| R2 not configured (no credentials) | Copy all articles without images, show single warning |
| Target staging branch doesn't exist | Create it from main (same pattern as the site wizard) |
| Source and target are the same site | UI prevents this (target dropdown excludes source) |
| Article has videos/scripts in frontmatter | Copied as-is (frontmatter is preserved verbatim) |

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/app/tools/copy-articles/page.tsx` | Create | Page component |
| `src/app/tools/layout.tsx` | Create | Tools section layout (minimal) |
| `src/app/api/articles/copy/route.ts` | Create | POST endpoint for copy operation |
| Sidebar component | Modify | Add Tools section with Copy Articles link |

## Non-Goals

- Moving articles (delete from source after copy) — out of scope.
- Cross-branch copying (e.g., main to staging of another site) — always staging-to-staging.
- Copying site config, theme, or other non-article content.
- Auto-renaming conflicting slugs.
