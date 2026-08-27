# Plan — Authoritative image-timeout alerts

**Spec:** `docs/superpowers/specs/2026-08-27-image-timeout-alert-authoritative.md`
**Baseline:** 75 test files, 639 tests (post Bug B)

## Task 1: shared dashboard URL + correct link
- [ ] Add `DASHBOARD_PUBLIC_URL` to `src/lib/config.ts`
- [ ] Failing test: alert body has dashboard link, no `https://<siteId>/`
- [ ] Fix `notifyImageDefaultFallback`; point `alerts/run.ts` at the constant
- [ ] Run — pass

## Task 2: pure decision
- [ ] Failing tests for `shouldAlertOnImageTimeout` (5 cases)
- [ ] Implement, reusing `isGeneralImage`
- [ ] Run — pass

## Task 3: verifier + timer wiring
- [ ] Failing tests with fake timers (real image / general image / throws / cleared)
- [ ] Add `ImageVerifier`, `createGitImageVerifier`, async timer check
- [ ] Pass verifier from `dedicated-agent.ts` and `queue/content-generation.ts`
- [ ] Run — pass

## Task 4: QA gate
- [ ] `pnpm typecheck` exit 0 (check the exit code, not tail's)
- [ ] Full suite green, saved to `docs/test-results/2026-08-27-HHMM-image-timeout-alert.txt`
- [ ] State test-count delta
- [ ] No commit — Asaf tests locally first
