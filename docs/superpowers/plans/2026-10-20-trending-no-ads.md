# Plan — `?trending` ad-free session

Spec: `docs/superpowers/specs/2026-10-20-trending-no-ads-design.md`
Branch: `asaf-dev`

### Task 1: `no-ads.ts` pure helpers
Files:
- Create test: `packages/site-worker/src/lib/__tests__/no-ads.test.ts`
- Create: `packages/site-worker/src/lib/no-ads.ts`

- [ ] Step 1: Write failing tests for `hasNoAdsParam`, `hasNoAdsCookie`, `stripAds`, `NO_ADS_COOKIE_HEADER`
- [ ] Step 2: Run `pnpm test` in site-worker — confirm they fail (module missing)
- [ ] Step 3: Implement `no-ads.ts`
- [ ] Step 4: Run tests — confirm they pass

### Task 2: Wire into middleware + locals
Files:
- Modify: `packages/site-worker/src/env.d.ts` (`noAds: boolean`)
- Modify: `packages/site-worker/src/lib/config.ts` (`isNoAds`)
- Modify: `packages/site-worker/src/middleware.ts`

- [ ] Step 1: After conditional overrides, compute `noAds` and strip config
- [ ] Step 2: Set `locals.site.noAds`
- [ ] Step 3: On response: `private, no-store` when `noAds`; `Set-Cookie` when the param triggered it
- [ ] Step 4: `pnpm typecheck` passes

### Task 3: Article frontmatter scripts
Files:
- Modify: `packages/site-worker/src/pages/[slug]/index.astro`

- [ ] Step 1: Skip `injectArticleScripts` when `isNoAds(Astro)`
- [ ] Step 2: `pnpm typecheck` + `pnpm build` pass

### Task 4: Docs
Files:
- Create: `services/dashboard/public/guide/27-trending-no-ads.md`
- Modify: `services/dashboard/src/app/guide/page.tsx` (`GUIDE_PAGES`)
- Modify: `docs/runbooks/phase-7-cache-strategy.md`

- [ ] Step 1: Write the guide page and register it
- [ ] Step 2: Add the no-ads `no-store` rule to the cache runbook

### Task 5: QA
- [ ] Full `pnpm test` in site-worker → `docs/test-results/2026-10-20-trending-no-ads.txt`
- [ ] `pnpm typecheck` (site-worker + dashboard), `pnpm build` (site-worker)
- [ ] Local `pnpm dev:worker` check: without param / with `?trending` / follow-up navigation / Server Island responses; save curl output to test results
- [ ] Hand to Asaf for local testing — no commit before approval
