# Audit Log: Review Queue — Site Filter

- **Date:** 2026-04-19
- **Session type:** Coding
- **Branch:** `refactor/ui-restructure`
- **Triggered by:** Add filterable dropdown to Review Queue page to filter articles by site domain

## Pre-flight Checks

| Check | Result |
|-------|--------|
| tsc --noEmit (dashboard) | PASS |
| Branch | refactor/ui-restructure |

## Investigation

- `app/review/page.tsx` — server component, calls `getReviewQueue()`, passes articles to `ReviewQueueClient`
- `app/review/ReviewQueueClient.tsx` — client component, articles already have `domain` field
- `actions/review.ts` — `getReviewQueue()` fetches all review articles across all sites, each with `domain`
- **No API changes needed** — domain data already present on each article

## Changes

### Change 1: Site Filter in ReviewQueueClient
- **File:** `app/review/ReviewQueueClient.tsx`
- **Action:** Added search+dropdown filter for site domain. Pure client-side:
  - `selectedDomain` state for active filter
  - `siteSearch` state for search input
  - `dropdownOpen` state + click-outside handler
  - `domainCounts` useMemo extracts unique domains sorted by article count
  - `filteredArticles` useMemo applies domain filter before existing pending/approved/rejected split
  - Dropdown only shows when >1 site has articles (no filter needed for single-site queues)
  - Shows article count per site, "All Sites (N)" default, clear button on active filter
- **tsc --noEmit:** PASS

## Final Verification

| Check | Result |
|-------|--------|
| tsc --noEmit | PASS |
| pnpm run build | PASS |
