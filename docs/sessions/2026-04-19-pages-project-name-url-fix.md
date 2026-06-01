# Session: Pages Project Name URL Fix

**Date:** 2026-04-19
**Branch:** `fix/pages-project-name-url`
**Type:** Bug fix

## Summary

Fixed two locations where staging/preview URLs used the site slug instead of the actual Cloudflare Pages project name for the `*.pages.dev` domain. When CF appends a suffix to avoid name collisions (e.g., `scienceworld-124` instead of `scienceworld`), these URLs would point to a non-existent domain.

## Changes

1. **`ensureStagingBranch` in wizard.ts** — The staging branch name now uses `domain` (site folder name) while the preview URL correctly uses `pages_project` (actual CF project name). Previously both used `pages_project`, which meant the branch name would be `staging/scienceworld-124` instead of the expected `staging/scienceworld`.

2. **`StepGoLive.tsx`** — Separated `siteSlug` from `pagesProject` in the fallback URL construction. The branch slug prefix now uses the site slug while the pages.dev domain uses the actual CF project name.

## Learning Notes

1. The Cloudflare Pages API may return a `name` that differs from the requested name when there are collisions. The `createPagesProject` response's `name` field is authoritative and must be captured and stored — the dashboard already does this correctly in the creation flow.

2. In this codebase, the `domain` field in `dashboard-index.yaml` is NOT always a real domain — for wizard-created sites, it's the project slug (e.g., "scienceworld"). The `pages_project` field holds the actual CF Pages project name. The staging branch convention is `staging/{domain}`, not `staging/{pages_project}`.

3. The majority of URL constructions (13 out of 15) were already correct. The bugs were in fallback/edge-case paths: the `ensureStagingBranch` function (used when a site's staging branch is missing) and the wizard's final step fallback (used when the creation API hasn't returned yet).
