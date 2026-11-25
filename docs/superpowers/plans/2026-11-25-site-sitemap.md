# Plan: per-site sitemap + ads.txt owner fix

Spec: `docs/superpowers/specs/2026-11-25-site-sitemap.md`

### Task 1: Sitemap library
Files:
- Create test: `packages/site-worker/src/lib/__tests__/sitemap.test.ts`
- Create: `packages/site-worker/src/lib/sitemap.ts`
- Modify: `packages/site-worker/src/lib/authors.ts` (export the existing `topicSlug` so the category slug rule has one home)

- [ ] Write failing tests (modern, categories off, Grid, escaping, cap, invalid date, index)
- [ ] Run them and confirm they fail
- [ ] Implement `buildSitemapUrls`, `renderUrlset`, `renderSitemapIndex`
- [ ] Run them and confirm they pass

### Task 2: Routes
Files:
- Create: `packages/site-worker/src/pages/sitemap.xml.ts`
- Create: `packages/site-worker/src/pages/sitemap-index.xml.ts`

- [ ] Wire config, article index and shared-page existence (KV) into the lib
- [ ] Typecheck and build; then `pnpm dev`: curl both paths for a modern site and a Grid site

### Task 3: ads.txt owner (network repo data, no code)
- [ ] `groups/atl-grid.yaml` (main): `ownerdomain=ngcdigital.io` becomes `atomiclabs.io`; drop the `# NGC Digital Websites #` comment (same as Michal's 2026-11-23 change to atl/ncg)
- [ ] `sites/hypezen/site.yaml` (`staging/hypezen`): same change; drop the stray empty `""` line
- [ ] Push and re-seed hypezen only after Asaf approves; mirror hypezen's config to Mongo (backfill), otherwise the next dashboard save brings back the old ads.txt

### Task 4: QA
- [ ] Full site-worker unit suite saved to `docs/test-results/2026-11-25-site-sitemap.txt`
- [ ] Typecheck and build pass
