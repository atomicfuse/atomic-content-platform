# Spec: Dual-branch article reads (staging ∪ main)

**Date:** 2026-07-19
**Status:** Approved (Asaf: "you can start fixing those too" — approach presented in-session)
**Bug:** `docs/bugs.md` → "Article counts disappear for auto-published sites"; root cause in `docs/audit-logs/2026-07-19-1324-article-counts-staging-banner.md`

## Goal
Sites whose Mongo article docs live under branch `"main"` (auto-published sites — `autoPublishSite` re-keys docs to `main` and deletes staging docs) must show correct article counts in the Sites table and correct article lists in the site Content tab.

## Architecture
The Mongo `articles` collection is keyed `(domain, slug, branch)`. After the nightly auto-publish, a site's docs exist only under `branch: "main"`; between publishes, new articles exist under the staging branch. The dashboard's Mongo read layer therefore must treat a site's article set as the **union of staging-branch docs and main docs, deduplicated by slug, preferring the staging doc** (it is the newer working copy).

Only the `USE_MONGO_READS=true` path changes. The Git fallback path already reads the staging branch in Git, which contains everything (staging is reset to main on publish), so it needs no change.

## Components
- Modify: `services/dashboard/src/lib/db/articles.ts`
  - `countArticlesForSites(sites)` — currently drops sites with `staging_branch: null` and matches only `branch === staging_branch`. New behavior: every site matches `branch ∈ {staging_branch, "main"}` (`{"main"}` when staging_branch is null); count = number of **distinct slugs** per domain (`$addToSet` + `$size`).
  - `readArticlesFromDb(domain, branch?)` — currently `find({domain, branch: branch ?? "main"})`. New behavior: when a branch is given and ≠ "main", query `branch: {$in: [branch, "main"]}` and dedupe by slug preferring the doc whose branch === the requested branch. When branch is undefined or "main", behavior unchanged (main only).
- Not changed (no external callers / different semantics): `getArticlesMeta`, `getArticleMeta`, `countArticlesByStatus`, `countArticles` — these are branch-exact by design (review flows want staging-only docs).
- Test: `services/dashboard/src/lib/db/__tests__/articles.test.ts` — extend.

## Data flow
Sites table → `/api/sites/article-counts` → `countArticlesForSites` (Mongo aggregation, one query for all sites) → domain→count map. Site detail page → `readArticlesFromDb(domain, site.staging_branch)` → ArticleEntry[] → ContentTab + site-stats.

## Error handling
Unchanged: read errors propagate to the route/page as today; the aggregation guard for an empty sites array returns `{}` (avoids `$or: []`, which MongoDB rejects).

## Edge cases
- Site with `staging_branch: null` (e.g. WordPress/pages sites): now counted via `main` docs instead of silently dropped.
- Article on both branches (upserted to staging, then published, staging doc not yet deleted): counted once; list shows the staging version.
- Article deleted on staging pending publish: existing delete paths (`review.ts:265-267`, `wizard.ts:470-472`) already delete Mongo docs under **both** `main` and staging, so no phantom resurrection.
- Duplicate slugs within one branch: impossible (unique index `domain+slug+branch`).

## Test plan
1. `countArticlesForSites` includes null-staging sites with `branch: {$in: ["main"]}`.
2. `countArticlesForSites` matches `{$in: [staging, "main"]}` for staged sites and counts distinct slugs (pipeline uses `$addToSet`/`$size`).
3. `countArticlesForSites` returns `{}` for empty input without querying.
4. `readArticlesFromDb(domain, staging)` queries `branch: {$in: [staging, "main"]}` and dedupes by slug preferring the staging doc.
5. `readArticlesFromDb(domain)` (no branch) queries main only — unchanged behavior.
6. Existing tests keep passing (regression).

## Out of scope
- Write-side changes to `autoPublishSite` (it may keep re-keying docs; reads are now tolerant).
- Stale-main-doc garbage collection on publish (pre-existing, tracked separately if observed).
- Git-read fallback path and KV path.
