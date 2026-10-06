# Plan: generation fixes (spec: `docs/superpowers/specs/2026-10-06-generation-fixes.md`)

All paths relative to repo root. TDD per task: failing test → implement → pass.

### Task 1: Wizard group id
Files: modify `services/dashboard/src/components/wizard/StepGroups.tsx`; create test `services/dashboard/src/components/wizard/__tests__/StepGroups.test.tsx`
- [ ] Test: groups `{id:"atl"}`, `{id:"ncg"}` → clicking "atl" calls onChange with `["atl"]` only; legacy `group_id` still works
- [ ] Implement `groupIdOf(g) = g.group_id ?? g.id`

### Task 2: Provider chain in `ai.ts`
Files: modify `services/content-pipeline/src/lib/ai.ts`; create test `services/content-pipeline/src/lib/__tests__/ai.test.ts`
- [ ] Tests: order Anthropic → gateway → OpenAI; skip Anthropic without key; fallthrough; aggregate error; no sticky state; returns model/provider
- [ ] Implement

### Task 3: Robust parse + leak check
Files: modify `services/content-pipeline/src/agents/content-generation/generators/base-generator.ts`, `claude-generator.ts`, `openai-generator.ts`; create test `.../generators/__tests__/base-generator.test.ts`
- [ ] Tests: repair trailing comma / raw newline; retry on parse fail; retry on leak; final sanitise
- [ ] Implement `generateArticleWithChecks`; wire both generators; OpenAI → `gpt-6-luna`

### Task 4: Routing + cost model ids
Files: modify `agent.ts` (primary Claude, cost uses `generated.model`), `dedicated-agent.ts`, `grid-summaries/index.ts`, `article-regeneration/index.ts`, `costs/pricing.ts`, `content-generation/types.ts`
- [ ] Test: pricing knows `claude-sonnet-5-5`, `gpt-6-luna`
- [ ] Implement

### Task 5: Article count
Files: modify `per-topic-fetch.ts`, `agent.ts`; test in existing per-topic-fetch tests
- [ ] Tests: `manualPerTopicTarget(50,5)=10`, `(3,5)=1`; `candidateLimit(1)=3`, `(10)=15`
- [ ] Implement targets + stop on created count

### Task 6: Prompt (done) + docs
- [ ] Update `cloudgrid.yaml` comment (ANTHROPIC_API_KEY is used), CLAUDE.md landmine notes
- [ ] Full suites → `docs/test-results/2026-10-06-generation-fixes.txt`
