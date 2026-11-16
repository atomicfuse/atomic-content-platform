# Plan — scheduler scale fix

Spec: `docs/superpowers/specs/2026-11-16-scheduler-scale-fix.md`

### Task 1: readFile by path
Files:
- Modify: `services/content-pipeline/src/lib/github.ts`, `src/lib/github-stats.ts`
- Rewrite test: `services/content-pipeline/src/__tests__/github-cache.test.ts`

- [ ] Write failing tests (getContent used, no getTree; 404/dir → "Expected file"; > 1MB → getBlob; base64 variant)
- [ ] Implement `fetchFileBase64` via `repos.getContent`; readFile/readFileBase64 use it
- [ ] Tests pass

### Task 2: LRU tree cache
Files: same as Task 1
- [ ] Failing test: 11th branch evicts the oldest; a hit refreshes recency
- [ ] Implement TREE_CACHE_MAX = 10
- [ ] Tests pass

### Task 3: scheduler-plan queue
Files:
- Create: `services/content-pipeline/src/queue/scheduler-plan.ts`
- Modify: `src/queue/types.ts`, `src/queue/index.ts`, `src/agents/scheduled-publisher/index.ts`
- Create test: `services/content-pipeline/src/__tests__/scheduler-plan.test.ts`

- [ ] Failing tests: enqueue + queued result; alreadyQueued; planSchedulerRun eligible/skipped/duplicate/listing-error
- [ ] Implement queue/worker + `planSchedulerRun` + `enqueueSchedulerPlan`
- [ ] Tests pass

### Task 4: dashboard Run now
Files: `services/dashboard/src/app/settings/scheduler/page.tsx`
- [ ] Show the queued / already-queued state

### Task 5: verify
- [ ] Full pipeline + dashboard test suites, typecheck, save output to docs/test-results/
- [ ] Re-run the local repro (82 sites) for before/after numbers
