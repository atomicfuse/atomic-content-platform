# Ops Console 3 — Cost Tracking API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Attribute AI spend per site, broken down by model — text token usage (Claude/OpenAI/quality-scorer) and image generation — persisted to MongoDB and exposed via `GET /site-costs[/:domain]` (content-pipeline) + `/api/site-costs` (dashboard proxy).

**Architecture:** A failure-isolated cost recorder writes `cost_events` (append-only) + upserts `site_costs` (per-model rollup), using a static price table. Text usage is captured **exact** where the SDK exposes it (OpenAI always; local Anthropic SDK) and **estimated** where it doesn't (the CloudGrid AI Gateway returns only `{text}`), flagged `estimated`. Image cost is `count × per-image price`, recorded at the n8n image callback (the prod image path is fire-and-forget via n8n).

**Tech Stack:** TypeScript (strict), `mongodb` (via Plan 1 `lib/mongo.ts`), Vitest. No new heavy deps; token estimation uses a simple heuristic (optionally `js-tiktoken`).

**Spec:** `docs/superpowers/specs/2026-06-07-cost-tracking-api-design.md`
**Depends on:** Plan 1 (`lib/mongo.ts`, route + proxy conventions, `source` plumbing). Touches the same LLM call sites; coordinate with Plan 1 Task 8/9 (do this plan after Plan 1).

---

## Pre-flight notes
- Branch `michal-dev`. Recording cost must **never** break generation (try/catch + log), same rule as Plan 1.
- **Usage availability (verified):** `ai.ts` CloudGrid gateway branch returns only `{text}` (no usage) → **estimate**; `ai.ts` local Anthropic branch has `response.usage.{input_tokens,output_tokens}` → **exact**; `openai-generator.ts` has `response.usage.{prompt_tokens,completion_tokens}` → **exact**. Images: no usage → `count × price`.
- **Model ids in code:** `claude-sonnet-4-20250514` (ai.ts default + scorer), `claude-sonnet` (gateway alias), `claude-opus-4-7` (propose-filter), `claude-sonnet-4-6` (article-cleanup), `gpt-4o-mini` (openai-generator), `gemini-2.5-flash-image` (gemini.ts).
- **Pricing (USD/MTok unless noted), June 2026:** Opus 4.x `5/25`; Sonnet 4.x `3/15`; `gpt-4o-mini` `0.15/0.60`; `gemini-2.5-flash-image` `$0.039/image`. (Editable config.)
- **`source`/`siteDomain` at the LLM call:** `processItem` (agent.ts) has `siteDomain`; add `source` to `ContentGenerationParams` → thread to `processItem` (reuse the `source` already computed by the 3 callers in Plan 1 Task 8).

## File structure
```
services/content-pipeline/
  src/costs/types.ts             (create: CostEvent, SiteCosts)
  src/costs/pricing.ts           (create: price table + costFor())
  src/costs/estimate.ts          (create: estimateTokens)
  src/costs/recorder.ts          (create: recordTextUsage, recordImageUsage)
  src/costs/repo.ts              (create: getSiteCosts + windows)
  src/costs/__tests__/*.test.ts
  src/lib/ai.ts                              (modify: return usage; estimate on gateway path)
  src/agents/content-generation/generators/openai-generator.ts (modify: surface usage)
  src/agents/content-generation/agent.ts     (modify: thread source; record text usage in processItem)
  src/agents/content-quality/scorer.ts       (modify: surface scorer usage to caller)
  src/agents/content-generation/n8n-image.ts (modify: record image usage on success)
  src/agents/content-generation/index.ts     (modify: GET /site-costs[/:domain])
services/dashboard/src/app/api/site-costs/route.ts          (create: proxy)
services/dashboard/src/app/api/site-costs/[domain]/route.ts (create: proxy)
```

---

## Task 1: Price table + `costFor`

**Files:** Create `src/costs/pricing.ts`, `src/costs/types.ts`; Test `__tests__/pricing.test.ts`.

- [ ] **Step 1: Types** (`types.ts`):
```typescript
import type { GenerationSource } from "../stats/types.js";
export interface CostEvent {
  siteDomain: string; kind: "text" | "image"; model: string; source: GenerationSource;
  inputTokens: number; outputTokens: number; images: number;
  estimated: boolean; costUsd: number; at: Date;
}
export interface ModelRollup { inputTokens: number; outputTokens: number; images: number; costUsd: number; estimated: boolean; }
export interface SiteCosts { _id: string; byModel: Record<string, ModelRollup>; totalCostUsd: number; updatedAt: Date; }
export const COST_COLLECTIONS = { costEvents: "cost_events", siteCosts: "site_costs" } as const;
```

- [ ] **Step 2: Failing test** for `costFor(model, { inputTokens, outputTokens, images })` → USD; unknown model → `{ costUsd: 0, known: false }`.
```typescript
import { describe, it, expect } from "vitest";
import { costFor } from "../pricing.js";
it("sonnet text cost", () => {
  expect(costFor("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 1_000_000, images: 0 }).costUsd).toBeCloseTo(18);
});
it("gemini image cost", () => {
  expect(costFor("gemini-2.5-flash-image", { inputTokens:0, outputTokens:0, images: 10 }).costUsd).toBeCloseTo(0.39);
});
it("unknown model → cost 0, known false", () => {
  expect(costFor("mystery", { inputTokens: 1000, outputTokens: 0, images: 0 })).toEqual({ costUsd: 0, known: false });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `pricing.ts`** with a `PRICES` map keyed by normalized model id (map aliases: `claude-sonnet`→sonnet rate, `claude-sonnet-4-20250514`/`claude-sonnet-4-6`→`3/15`, `claude-opus-4-7`→`5/25`, `gpt-4o-mini`→`0.15/0.60`, `gemini-2.5-flash-image`→`{perImage:0.039}`). `costFor` returns `{ costUsd, known }`. Log a warning for unknown models.

- [ ] **Step 5: Run → PASS. Step 6: Commit**
```bash
git add services/content-pipeline/src/costs/pricing.ts services/content-pipeline/src/costs/types.ts services/content-pipeline/src/costs/__tests__/pricing.test.ts
git commit -m "feat(content-pipeline): cost price table + costFor"
```

---

## Task 2: Token estimation

**Files:** Create `src/costs/estimate.ts`; Test.

- [ ] **Step 1: Failing test** — `estimateTokens(text)` is roughly `ceil(chars/4)`, ≥ 1 for non-empty, 0 for empty.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a simple `Math.ceil(text.length / 4)` heuristic with a doc comment that this is an approximation used only on the AI-Gateway path (exact counts used elsewhere). (Optional: swap in `js-tiktoken` later; keep the signature stable.)

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/costs/estimate.ts services/content-pipeline/src/costs/__tests__/estimate.test.ts
git commit -m "feat(content-pipeline): token estimation heuristic"
```

---

## Task 3: Cost recorder (event + rollup, failure-isolated)

**Files:** Create `src/costs/recorder.ts`; Test (in-memory Mongo, same harness as Plan 1 Task 4).

- [ ] **Step 1: Failing tests:**
  - `recordTextUsage({ siteDomain, source, model, inputTokens, outputTokens, estimated })` inserts a `cost_events` doc and upserts `site_costs.byModel[model]` (accumulating tokens + costUsd) and `totalCostUsd`.
  - `recordImageUsage({ siteDomain, source, model, images })` inserts an image cost event and accumulates `byModel[model].images` + cost.
  - Mongo unreachable → both resolve without throwing.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** both functions: compute `costUsd` via `costFor`, insert event, then `updateOne({_id:siteDomain}, { $inc: { [`byModel.${model}.inputTokens`]: ..., ..., totalCostUsd: cost }, $set:{updatedAt}, $max:{[`byModel.${model}.estimated`]: estimated?1:0} }, {upsert:true})`. (Mongo dotted-path `$inc` creates the nested model bucket. For `estimated`, store a boolean derived from whether any event for that model was estimated — simplest: `$set` it to the latest event's value, or track via `$max` on a 0/1 then map in the repo.) Wrap in try/catch + log; never throw.

- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/costs/recorder.ts services/content-pipeline/src/costs/__tests__/recorder.test.ts
git commit -m "feat(content-pipeline): cost recorder (text + image), failure-isolated"
```

---

## Task 4: Surface usage from `ai.ts` and the OpenAI generator

**Files:** Modify `src/lib/ai.ts`, `openai-generator.ts`; update all `generateContent` callers.

- [ ] **Step 1:** Change `generateContent` to return `{ text: string; usage: { inputTokens: number; outputTokens: number; estimated: boolean } }`:
  - Gateway branch: `usage = { inputTokens: estimateTokens(systemPrompt+userPrompt), outputTokens: estimateTokens(text), estimated: true }`.
  - Anthropic SDK branch: `usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, estimated: false }`.
  - Update **all** callers to use `.text` (find with `grep -rn "generateContent(" src`): the Claude generator, `scorer.ts`, `propose-filter.ts`, `article-cleanup.ts`. Where the caller can attribute to a site, also pass the usage up (Task 5); where it can't (e.g. propose-filter has no per-article site cost), just use `.text`.
- [ ] **Step 2:** OpenAI generator: capture `response.usage` and return it on the `GeneratedArticle` (add optional `usage?: {inputTokens,outputTokens,estimated:false}` to the `GeneratedArticle` type) — map `prompt_tokens`/`completion_tokens`.

- [ ] **Step 3:** Adjust/extend existing ai/generator unit tests for the new return shape; `pnpm typecheck && pnpm test` → PASS.

- [ ] **Step 4: Commit**
```bash
git add services/content-pipeline/src/lib/ai.ts services/content-pipeline/src/agents/content-generation/generators/openai-generator.ts services/content-pipeline/src/agents/content-quality/scorer.ts services/content-pipeline/src/agents/content-generation/generators
git commit -m "feat(content-pipeline): surface LLM token usage (exact + estimated)"
```

---

## Task 5: Record text cost in `processItem`; thread `source`

**Files:** Modify `agent.ts` (`ContentGenerationParams`, `runContentGeneration`, `processItem`), `scorer.ts` return.

- [ ] **Step 1:** Add `source?: GenerationSource` to `ContentGenerationParams`; pass it from the 3 callers (Plan 1 Task 8 already computes `source` for stats — reuse the same value). Thread `source` into `processItem` (new param, default `"dashboard"` if absent).
- [ ] **Step 2:** In `processItem`, after the generator call and after `scoreArticle`, record cost (failure-isolated, `void`):
  - text generation: `void recordTextUsage({ siteDomain, source, model: <generator model id>, ...generatorUsage })` — the generator result now carries `usage`; the model id is the generator's model (`gpt-4o-mini` for OpenAI; for Claude use the model passed to `generateContent`, default `claude-sonnet-4-20250514`).
  - quality scoring: have `scoreArticle` return its `usage` (it calls `generateContent`); `void recordTextUsage({ siteDomain, source, model: "claude-sonnet-4-20250514", ...scorerUsage })`.
- [ ] **Step 3:** `pnpm typecheck && pnpm test` → PASS (existing generation tests still green; cost recording is fire-and-forget).
- [ ] **Step 4: Commit**
```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/agents/content-quality/scorer.ts
git commit -m "feat(content-pipeline): record text-gen + scoring cost per site/model"
```

---

## Task 6: Record image cost at the n8n callback

**Files:** Modify `src/agents/content-generation/n8n-image.ts`.

- [ ] **Step 1:** In `handleImageCallback`, on the **success** branch (after the guard + after `processN8nImageResult`), `void recordImageUsage({ siteDomain: site_domain, source: "scheduler", model: payload.meta?.provider === "openai" ? "<openai-image-model>" : "gemini-2.5-flash-image", images: 1 })`.
  - `source` isn't on the callback payload; default to `"scheduler"` (most images come from scheduled/dashboard generation). Acceptable approximation — note it. (Migration-path direct Gemini calls in `migration/orchestrator.ts` may also record `recordImageUsage` with the in-scope `siteDomain` if image cost there matters — optional, flagged.)
- [ ] **Step 2:** `pnpm typecheck && pnpm test` → PASS. **Commit**
```bash
git add services/content-pipeline/src/agents/content-generation/n8n-image.ts
git commit -m "feat(content-pipeline): record image-gen cost at n8n callback"
```

---

## Task 7: Cost read repo + routes + dashboard proxy

**Files:** Create `src/costs/repo.ts`; modify `index.ts`; create dashboard routes.

- [ ] **Step 1: Failing test** for `getSiteCosts(domain, now)` → builds the response: `byModel[]` (model, tokensUse {input,output}, costForToken {input,output}|{perImage}, costUsd, estimated), `totalCostUsd`, and `windows: { thisWeekUsd, last30dUsd }` aggregated from `cost_events`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `repo.ts`** (read `site_costs` rollup + aggregate `cost_events` for the windows; join with `pricing.ts` to expose `costForToken`). Add routes `GET /site-costs` / `/site-costs/:domain` in `index.ts` (same pattern as Plan 1 Task 10; 503 on Mongo failure).
- [ ] **Step 4: Create dashboard `/api/site-costs/route.ts` + `[domain]/route.ts`** — thin proxies via `getAgentUrl()` (no enrichment needed). Same `/api/*` auth treatment as `/api/site-stats`.
- [ ] **Step 5:** typecheck + tests both services → PASS. **Commit**
```bash
git add services/content-pipeline/src/costs/repo.ts services/content-pipeline/src/agents/content-generation/index.ts services/content-pipeline/src/costs/__tests__/repo.test.ts services/dashboard/src/app/api/site-costs
git commit -m "feat: cost read API + dashboard proxy"
```

---

## Final verification
- [ ] content-pipeline + dashboard typecheck & tests green.
- [ ] Failure-isolation tests (Task 3) green — cost recording never throws.
- [ ] Manual smoke (optional): generate articles locally, `curl http://localhost:5000/site-costs/<domain>` shows `byModel` with token counts and `estimated:true` for Claude (gateway path).
- [ ] Scoped commits; no secrets staged.

## Notes
- The `estimated` flag must surface in the API so totals aren't read as exact. If/when the CloudGrid AI Gateway exposes usage, switch the gateway branch in `ai.ts` to use it and set `estimated:false`.
- Index `cost_events` on `{ siteDomain: 1, at: -1 }` and `{ model: 1, at: -1 }` — add to `ensureStatsIndexes()` (Plan 1) or a `ensureCostIndexes()` called at boot.
