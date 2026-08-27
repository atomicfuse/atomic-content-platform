# Plan — Auto-publish staging CAS

**Spec:** `docs/superpowers/specs/2026-08-27-auto-publish-staging-cas.md`
**Baseline:** 74 test files, 629 tests passing (content-pipeline)

## Files

- Modify: `services/content-pipeline/src/queue/scheduler-flow.ts`
- Modify test: `services/content-pipeline/src/__tests__/auto-publish.test.ts`

## Task 1: `decideStagingReset` — pure CAS decision

- [ ] Write failing tests: equal SHAs → `reset`; differing + attempts left →
      `recopy`; differing + last attempt → `skip`; `null` either side → `reset`
- [ ] Run — confirm failure (function does not exist)
- [ ] Implement `StagingResetDecision` type + `decideStagingReset`, exported
- [ ] Run — confirm pass

## Task 2: `getBranchSha` helper

- [ ] Implement: `git.getRef` → `object.sha`, `null` on any throw
- [ ] Covered indirectly by Task 3 (fake Octokit returns/throws)

## Task 3: `autoPublishSite` attempt loop

- [ ] Write failing test: drift present → commits to `main`, `updateRef` NOT
      called, `deleteArticlesForSiteBranch` NOT called
- [ ] Write test: no drift → `updateRef` called once with `force: true`
- [ ] Write test: drift then settles → two `commitBatch` calls, then reset
- [ ] Run — confirm the drift test fails against current code (it resets)
- [ ] Restructure `autoPublishSite` into the bounded loop
- [ ] Run — confirm all pass

## Task 4: QA gate

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` full suite green, output saved to
      `docs/test-results/2026-08-27-HHMM-auto-publish-staging-cas.txt`
- [ ] State test-count delta
- [ ] No commit — hand to Asaf for local testing and approval first

## Not doing

Bug A, the 5-article remediation, docs/bugs.md entry (after Bug A, so both
land together).
