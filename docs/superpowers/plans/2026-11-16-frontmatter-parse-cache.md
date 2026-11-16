# Plan: frontmatter parsing without gray-matter's shared cache

Spec: `docs/superpowers/specs/2026-11-16-frontmatter-parse-cache.md`

### Task 1: `parseFrontmatter` helper
Files:
- Create: `services/content-pipeline/src/lib/frontmatter.ts`
- Create test: `services/content-pipeline/src/__tests__/frontmatter.test.ts`

- [x] Write failing tests: independent `data` per call, parity with `matter()`, no `matter.cache` growth
- [x] Run: fail (module missing)
- [x] Implement `parseFrontmatter(raw) = matter(raw, {})`
- [x] Run: pass

### Task 2: Regression test for the hero-image copy
Files:
- Modify test: `services/content-pipeline/src/__tests__/hero-image-to-main.test.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/hero-image-main.ts`

- [x] Write failing test that reproduces production: `matter(text)` is mutated by the staging callback, then `heroImageUpdateForMain(text, …)` must still update
- [x] Write failing test: a non-404 read error on `main` is logged, and a 404 is not
- [x] Run: fail
- [x] Switch `hero-image-main.ts` to `parseFrontmatter`, and log non-404 read errors
- [x] Run: pass

### Task 3: Route every pipeline parse through the helper
Files to modify (`matter(x)` → `parseFrontmatter(x)`, drop unused `gray-matter` imports):
`agents/content-generation/{bulk-image,agent,n8n-image,index}.ts`,
`agents/grid-summaries/files.ts`, `agents/article-regeneration/index.ts`,
`agents/migration/{verify,orchestrator}.ts`, `queue/{scheduler-flow,content-generation}.ts`,
`scripts/{rebuild-dedup-index,brand-safe-slugs,backfill-mongo}.ts`

- [x] Write failing guard test: scan `src/**/*.ts` (excluding tests and `lib/frontmatter.ts`) for a bare `matter(` call
- [x] Run: fail (it lists the current callers)
- [x] Replace the calls
- [x] Run: pass

### Task 4: Verify
- [x] `pnpm typecheck` and the full `pnpm test` in content-pipeline, saved to `docs/test-results/2026-11-16-HHMM-frontmatter-parse-cache.txt`
- [x] Note the test-count delta: 930 → 939 (+9)
- [ ] Hand over for Asaf's local test. No commit, push or deploy before approval.
