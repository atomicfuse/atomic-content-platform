# Plan: Six-bugs fix set

**Spec:** `docs/superpowers/specs/2026-07-16-six-bugs-fix-set.md`
**Rule:** TDD per task; `tsc --noEmit` after every file change; nothing committed until Asaf approves.

### Task A: per-topic migration dual-write (issue 1)
Files:
- Modify: `services/dashboard/src/actions/per-topic-migration.ts`
- Modify test: `services/dashboard/src/actions/__tests__/per-topic-migration.test.ts`

- [ ] Failing test: migration calls `upsertSiteConfig(domain, updatedConfig)` and `revalidatePath("/sites/<domain>")`
- [ ] Implement: import + call after `commitSiteFiles`
- [ ] Suite green

### Task B: goLive status + sync self-heal (issue 2)
Files:
- Modify: `services/dashboard/src/actions/wizard.ts` (goLive)
- Modify: `services/dashboard/src/actions/sync.ts` (extract pure `computeCorrectStatus`, reorder)
- Create test: `services/dashboard/src/actions/__tests__/sync-status.test.ts`
- Modify test: `services/dashboard/src/actions/__tests__/wizard-per-topic.test.ts` or new goLive test

- [ ] Failing tests: goLive keeps Live when `custom_domain` set / sets Ready when not; `computeCorrectStatus` promotes stuck-Ready-with-domain to Live, keeps Staging sticky
- [ ] Implement both
- [ ] Suite green

### Task C: per-topic drop-tags fallback (issue 3)
Files:
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts` (filter branch of `runPerTopicGeneration`)
- Create test: `services/content-pipeline/src/__tests__/per-topic-fallback.test.ts`

- [ ] Failing test: filter topic (cats+tags) where tagged query returns 0 → retried without tags → article created; no retry when tags empty or categories empty
- [ ] Implement fallback (mirror legacy narrow→broad)
- [ ] Suite green

### Task D: dedup ids + source_title (issue 4)
Files:
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts` (ExistingArticles, DedupIndexData v2, serialize/parse, extractFromFrontmatter, 3 fetch loops, processItem frontmatter)
- Modify: `services/content-pipeline/src/queue/content-generation.ts` (index merge)
- Modify: `services/content-pipeline/src/scripts/rebuild-dedup-index.ts`
- Modify: `services/content-pipeline/src/agents/migration/orchestrator.ts` (ids field)
- Modify test: `services/content-pipeline/src/__tests__/dedup-index.test.ts`
- Modify test: `services/content-pipeline/src/__tests__/agent.test.ts` (or new) — id-based skip

- [ ] Failing tests: v2 round-trip with ids; v1 parse back-compat (ids empty); fetch loop skips item whose id is in index; frontmatter carries `source_title`
- [ ] Implement
- [ ] Suite green

### Task E: docs
- [ ] CLAUDE.md: replace stale `invalidateSiteCaches` guidance with Mongo dual-write pattern
- [ ] Ops runbook `docs/runbooks/2026-07-16-post-us-migration-remediation.md` (issue 6 backfill + giantsavings tags + rebuild-dedup-index + REDIS_URL check)

### Task F: verification + audit trail
- [ ] Full suites for dashboard + content-pipeline → `docs/test-results/2026-07-16-*`
- [ ] Typecheck all packages
- [ ] Audit log, session summary, backlog/bugs/notes sync
