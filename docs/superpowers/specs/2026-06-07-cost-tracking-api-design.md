# Cost Tracking API — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) — pending implementation plan
**Author:** michal + Claude Code
**Sibling specs:** Generation Stats (foundation), Site Checks, Slack Alerts & Reminders

## Problem

For each site, expose **AI spend** broken down by model:

```
costs:
  site:
    model:           # the AI model
    tokens_use:      # tokens used for this site on this model
    cost_for_token:  # static unit price
    # plus any other costs we think of
```

Purpose: per-site cost/usage accounting. Decision: attribute **LLM tokens (text generation + quality scoring +
OpenAI fallback) and image generation** per site. Infra (Cloudflare/CloudGrid) is out of scope.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Scope | **LLM tokens + image-gen.** No infra estimates. |
| Architecture | Same as Stats: content-pipeline owns Mongo; dashboard `/api/site-costs` proxies. |
| Pricing | Static, editable price table in code (sourced from current public pricing — see table). |

## Hard constraint discovered in code (shapes the whole design)

There are **three LLM call sites**, and **only some expose token usage**:

| Caller | SDK | Usage available? |
|---|---|---|
| Text gen (factual) — `ai.ts` via **CloudGrid AI Gateway** (`@cloudgrid-io/ai`) — **prod default** | gateway | **NO** — returns `{ text }` only |
| Text gen (factual) — `ai.ts` local `@anthropic-ai/sdk` fallback (dev) | Anthropic | **YES** — `usage.input_tokens` / `output_tokens` (currently discarded) |
| Text gen (general/evergreen) — `openai-generator.ts` | OpenAI | **YES** — `usage.prompt_tokens` / `completion_tokens` (currently discarded) |
| Quality scoring — `content-quality/scorer.ts` → `ai.ts` | gateway/Anthropic | same as factual text gen |
| Image gen — Gemini (`gemini.ts`), n8n | — | **NO usage** — cost is `count × static per-image price` |

**Implication:** in production, Claude calls go through the AI Gateway, which **does not return token counts**.
So per-site Claude tokens must be **estimated** with a tokenizer over the prompt + completion text, flagged
`estimated: true`. Where the SDK *does* return usage (OpenAI always; local Anthropic), capture the **exact**
counts and flag `estimated: false`. Image gen is counted (per-image), not tokenized.

> Sub-decision for the plan: tokenizer choice for estimation (e.g. a lightweight `gpt-tokenizer`/`tiktoken`-style
> count, or a chars/4 heuristic). Estimation only needs to be good enough for cost trending; exactness comes from
> the providers that report usage. If/when the AI Gateway exposes usage, switch those records to exact.

## Instrumentation (write path)

Each LLM/image call records a **usage event** keyed by site + model. The cleanest seam is a small helper invoked
at each call site after the response returns — the call sites already exist and currently *discard* usage:

- `ai.ts` (factual text + quality scoring): capture gateway `{text}` → estimate tokens; or capture Anthropic
  `usage` when on the local SDK path.
- `openai-generator.ts`: capture `response.usage` (exact).
- `gemini.ts` / image path: record one image-generation unit on success.

Every call site **must** pass the `siteDomain` (already in scope during generation) and the `model` string.
**Failure isolation:** recording a usage event never breaks generation (try/catch + log), same rule as Stats.

> The site context flows from the same generation entrypoints covered in the Stats spec (scheduler / dashboard /
> wp-import). Cost events are tagged with the same `source` so spend can be split by trigger if wanted.

## Data model (MongoDB)

**Collection `cost_events`** — append-only, one doc per LLM/image call:

```jsonc
{
  "siteDomain": "travelswire",
  "kind":       "text" | "image",
  "model":      "claude-sonnet-4-6",
  "source":     "scheduler" | "dashboard" | "wp-import",
  "inputTokens":  1820,        // text only
  "outputTokens": 640,         // text only
  "images":       0,           // image only (count)
  "estimated":  true,          // true when tokens were estimated (AI Gateway path)
  "costUsd":    0.0150,        // computed at write time from the price table
  "at":         "2026-06-07T14:02:00Z"
}
```

Index: `{ siteDomain: 1, at: -1 }`, `{ model: 1, at: -1 }`.

**Collection `site_costs`** — per-site rollup, upserted on each event:

```jsonc
{
  "_id": "travelswire",
  "byModel": {
    "claude-sonnet-4-6": { "inputTokens": 1.2e6, "outputTokens": 4.1e5, "images": 0, "costUsd": 9.75, "estimated": true },
    "gpt-4o-mini":       { "inputTokens": 3.0e5, "outputTokens": 9.0e4, "images": 0, "costUsd": 0.099, "estimated": false },
    "gemini-2.5-flash-image": { "inputTokens": 0, "outputTokens": 0, "images": 142, "costUsd": 5.54, "estimated": false }
  },
  "totalCostUsd": 15.39,
  "updatedAt": "2026-06-07T14:02:00Z"
}
```

Windowed spend (this-week / 30d) is computed on read from `cost_events`; `site_costs` holds the all-time rollup.

## Static price table (code constant, editable)

Sourced from current public pricing (June 2026). USD per **million tokens** unless noted; output is the slash-right value.

| Model (as used in code) | Input / Output ($/MTok) | Notes |
|---|---|---|
| `claude-opus-4-7` (and Opus 4.x class, e.g. quality/propose-filter) | $5.00 / $25.00 | Opus 4.x rate |
| `claude-sonnet-4-6`, `claude-sonnet-4-20250514` (factual text) | $3.00 / $15.00 | Sonnet 4.x rate |
| `gpt-4o-mini` (general/evergreen) | $0.15 / $0.60 | |
| `gemini-2.5-flash-image` (image) | **$0.039 per image** | 1290 output tokens/image @ $30/MTok (≈$0.039); resolution varies |

> Model IDs are read from the actual call sites; keep this table in one module and map unknown models to a
> `cost_for_token: null` (record usage, mark cost unknown) rather than guessing. Pricing is config — easy to edit
> as rates change. The plan should re-verify rates at implementation time.

## Read API

- **content-pipeline** (internal): `GET /site-costs` and `GET /site-costs/:domain` → rollup + windowed spend.
- **dashboard** (public, NextAuth): `GET /api/site-costs[/:domain]` → proxies (standard `CONTENT_AGENT_URL`
  fallback, landmine #4).

Response block (merges into the per-site aggregate as `costs`):

```jsonc
"costs": {
  "totalCostUsd": 15.39,
  "byModel": [
    { "model": "claude-sonnet-4-6", "tokensUse": { "input": 1200000, "output": 410000 }, "costForToken": { "input": 3.0, "output": 15.0 }, "costUsd": 9.75, "estimated": true },
    { "model": "gpt-4o-mini",       "tokensUse": { "input": 300000,  "output": 90000  }, "costForToken": { "input": 0.15, "output": 0.6 }, "costUsd": 0.099, "estimated": false },
    { "model": "gemini-2.5-flash-image", "images": 142, "costForToken": { "perImage": 0.039 }, "costUsd": 5.54, "estimated": false }
  ],
  "windows": { "thisWeekUsd": 1.12, "last30dUsd": 6.40 }
}
```

(`tokensUse` + `costForToken` map directly to the requested `tokens_use` / `cost_for_token` fields.)

## Error handling

- Usage recording is try/caught and never breaks generation.
- Unknown model → record usage with `costUsd: 0` + `costForToken: null`; surface `estimated`/unknown so totals
  aren't silently wrong. Log a warning so the price table gets updated.
- Mongo unreachable on read → API `503`.

## Testing

- **Unit:** cost computation per model (input/output token math; per-image); estimated-vs-exact flag; unknown-model
  handling; windowed aggregation (this-week / 30d); rollup `byModel` accumulation.
- **Integration:** instrument-and-read round-trip with `mongodb-memory-server`; assert a thrown recorder error
  does not propagate out of `ai.ts` / `openai-generator.ts` / the image path.

## Out of scope

- Infra cost attribution (Cloudflare/CloudGrid/hosting).
- Budgets/limits/enforcement (cost data only; alerting on spend could be a future Alerts condition).
- Exact Claude token counts in production until/unless the CloudGrid AI Gateway exposes `usage` (estimated for now).

## Sources (pricing)

- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
