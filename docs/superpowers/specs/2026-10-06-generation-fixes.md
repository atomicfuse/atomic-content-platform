# Generation fixes: models, backup chain, article count, persona, wizard groups

**Status:** approved in session 2026-10-06 (Asaf). Investigation evidence: `docs/test-results/2026-10-06-model-comparison/`.

## Goal
Make article generation reliable and on-voice: one strong model (Claude Sonnet 5.5) with a 3-step backup chain, the requested article count actually produced, site guidelines/persona honoured, no prompt-jargon leaks, and fix the wizard group picker.

## Background (root causes found)
1. **Wizard groups** — `StepGroups.tsx` reads `group.group_id`; `/api/groups` returns `id`. Every id is `undefined`, so one click selects all and `groups: [null]` is saved.
2. **~4–5 articles per manual run** — manual "Generate N" with no topic runs every topic at `computePerRunTarget(topic.schedule)` (= 1 on scoopella); `count` only caps the total. Each topic fetches exactly its target, so a single rejected item is never replaced.
3. **Guidelines ignored / weaker bulk articles** — the router sends almost all non-news items to gpt-4o-mini, which ignores the persona; the guideline was a weak bullet overridden by the genre pack. Sonnet 5.5 follows it (9–12 "Ella/XOXO" per article vs 0).
4. **No real backup** — `ai.ts` falls back to the Anthropic SDK only if the *first* gateway call of the process fails, and then sticks to it for the process lifetime; any later gateway error throws. Dedicated, regeneration, grid summaries, scorer and propose-filter have no fallback at all.
5. **Lost articles** — 4/27 test generations returned JSON the parser rejected (trailing commas, raw newlines); the article is skipped.
6. **Jargon leak** — "per the brief" appears in 32/5,719 live articles.

## Design

### A. `lib/ai.ts` — provider chain (per call, no sticky state)
`generateContent()` tries, in order, and returns `{ text, usage, model, provider }`:
1. **Anthropic SDK** (`ANTHROPIC_API_KEY`), model `claude-sonnet-5-5`, `output_config.effort: "medium"`, `max_tokens = max(requested, 16000)` (Sonnet 5.5 thinks adaptively; a 4096 cap risks truncating). Skipped when no key.
2. **CloudGrid AI Gateway** (`@cloudgrid-io/ai`, alias `claude-sonnet`).
3. **OpenAI** (`OPENAI_API_KEY`), model `gpt-6-luna`.
Each step is tried once; the first success wins. All failures → one error listing every provider's message. Direct SDK first because it pins the exact model and returns real token usage; the gateway alias cannot pin a version.
Model ids are overridable via env (`CLAUDE_MODEL`, `OPENAI_FALLBACK_MODEL`) — defaults above.

### B. Generators / router
- Bulk + per-topic: Claude generator is always primary (`classifyContent` still decides `isFactual` for genre selection). The existing cross-model fallback in `processItem` stays as a final net.
- `OpenAIGenerator` model → `gpt-6-luna` (reasoning-style params: `max_completion_tokens`).
- Generated articles carry the actual `model`; cost recording uses it (no hard-coded `claude-sonnet-4-6`). Pricing table gains `claude-sonnet-5-5` ($2/$10), `gpt-6-luna` ($0.10/$0.50).

### C. Robust output (`base-generator.ts`)
- `parseGeneratedArticle` gains a repair pass: strip trailing commas before `}`/`]`, escape raw control characters inside strings.
- New `generateArticleWithChecks(call)`: up to 2 attempts; retry on parse failure or a jargon leak (`the/our/my brief`, `the peg`) in title/description/body. If the last attempt still leaks, replace `the brief` → `the report` deterministically.

### D. Prompt (`prompts/core.ts`, `build-prompts.ts`) — already implemented locally
Site guidelines become a "Site Persona & Editorial Guidelines (HIGHEST PRIORITY)" section + closing reminder; audience defaults to "a general audience"; "never write 'the brief'" rule.

### E. Article count (`agent.ts` per-topic path, `per-topic-fetch.ts`)
- Manual all-topics run with `count`: per-topic target = `ceil(count / topics)`; total still capped by `count`.
- Every topic fetches `target + backups` candidates (`candidateLimit(target) = target + max(2, ceil(target/2))`) and stops generating once `target` articles were **created** for that topic.

### F. Wizard (`StepGroups.tsx`)
Use `group.group_id ?? group.id` as the identifier (key, toggle, label). Report sites whose `site.yaml` holds `groups: [null]` (data fix is manual, out of scope for code).

## Error handling
Provider errors are logged per step with provider name; final aggregate error preserved. Leak sanitisation logs a warning. No silent swallowing.

## Edge cases
- No `ANTHROPIC_API_KEY` (some local setups) → chain starts at the gateway.
- Gateway unavailable locally → falls through quickly to OpenAI.
- `count` smaller than topic count → targets of 1 for the first topics; `remainingTotal` caps the total.
- Topic with fewer candidates than target → creates what it can (no spill-over to other topics in this change).

## Test plan
- `lib/__tests__/ai.test.ts`: chain order, skip-without-key, fallthrough on error, aggregate error, no sticky state across calls, returned model/provider.
- `generators/__tests__/base-generator.test.ts`: trailing-comma + raw-newline repair; retry on parse failure; retry on leak; final sanitisation.
- `__tests__/per-topic-fetch.test.ts`: `manualPerTopicTarget`, `candidateLimit`.
- `costs/__tests__`: new prices.
- Dashboard `StepGroups.test.tsx`: groups with only `id` toggle individually.
- Full pipeline + dashboard suites saved to `docs/test-results/`.

## Out of scope
Spill-over of unused per-topic quota; "duplicates" counter redesign; switching scoopella to its bundle; Grid external-sources work (separate spec); repairing existing leaked articles / `groups: [null]` site data.
