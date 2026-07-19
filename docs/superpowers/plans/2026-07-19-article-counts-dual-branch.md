# Plan: Dual-branch article reads (staging ∪ main)

**Date:** 2026-07-19 · **Scope:** Small (1 session) · **Spec:** `../specs/2026-07-19-article-counts-dual-branch.md`

### Task 1: countArticlesForSites — union branches, distinct-slug counts
Files:
- Modify test: `services/dashboard/src/lib/db/__tests__/articles.test.ts`
- Modify: `services/dashboard/src/lib/db/articles.ts`

- [ ] Write failing tests: null-staging site included via main; $in [staging, main] match; distinct-slug grouping; empty input → {} without query
- [ ] Run tests — confirm they fail
- [ ] Implement aggregation change
- [ ] Run tests — confirm they pass

### Task 2: readArticlesFromDb — union + slug dedup preferring staging
Files: same two files

- [ ] Write failing tests: $in query when staging branch passed; dedup prefers staging doc; no-branch call stays main-only
- [ ] Run tests — confirm they fail
- [ ] Implement
- [ ] Run tests — confirm they pass

### Task 3: Verification gate
- [ ] `pnpm typecheck` (dashboard)
- [ ] Full dashboard test suite, output → `docs/test-results/2026-07-19-article-counts-dual-branch.txt`, state delta
- [ ] Update audit log + session summary + bugs.md; NO commit (Asaf tests locally first per standing rule)
