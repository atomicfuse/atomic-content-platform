# Article Generation Prompts v2 — Design

**Date:** 2026-07-08
**Status:** Draft — pending Asaf's review
**Scope:** `services/content-pipeline` only. No model changes, no dashboard/shared-types/KV/site-worker changes.

## Problem

The three article prompts (`news-article.ts`, `general-article.ts`, `dedicated-article.ts`) are shallow:

- `general-article.ts` forces a **TL;DR** into every evergreen article (stated 3×) — visible on recently generated articles and unwanted.
- No guidance on angle-taking, hooks, register, attribution, or structure — output reads generic.
- The prompts ignore what the aggregator actually sends: the `summary` field is a **structured editorial brief** (What It Covers / Items / Why It Matters Now / Content Opportunity / Key Angles), not a plain summary. Today the model has no idea how to use it.
- Prompts print dead fields (`vertical` is deprecated, always null → "**Vertical:** General" on every item) and can print `**Description:** null` for videos.
- No defenses against fabrication under pressure: fact-thin briefs ("Items: — not provided in source material") and partial enumerations (source title promises "15 things", brief contains 6) invite the model to invent the gap.
- No register control: a true-crime video was observed categorized `Pop Culture / Humor and Satire` — category-driven tone selection would apply snark to a missing-persons story.

## Goals

1. Remove TL;DR everywhere.
2. Articles with a real angle, a hook that keeps its promise, genre-appropriate register, and strict factual honesty.
3. One prompt system covering all use cases: news, evergreen, pop-culture/gossip, reviews/listicles; sourced (aggregator item) and original (dedicated user prompt); article/video/social_post source types.
4. Models and routing untouched: Claude Sonnet for factual, GPT-4o-mini for general, existing fallback logic. Prompts must be robust enough for the weaker model (clear, imperative, structured).

## Non-goals

- Model upgrades (separate future task).
- URL fetching/scraping (pipeline has none; prompts must not ask the model to "research beyond the source").
- Dashboard, shared-types, or site-worker changes. No KV re-seed.

## Architecture

Prompts are **composed** from a shared core plus two orthogonal axes:

| Axis | Values | Chosen by |
|------|--------|-----------|
| **Source mode** | `sourced` (facts from aggregator brief) / `original` (model knowledge, qualified claims) | Call site: news+general flows → `sourced`; dedicated flow → `original` |
| **Genre pack** | `news`, `evergreen`, `pop-culture`, `review-listicle` | Auto-detection (below) |

### File layout

```
services/content-pipeline/src/agents/content-generation/prompts/
  core.ts               Shared foundation: site identity, input mapping, truth rules
                        (per source mode), craft rules, tagging rules, output schema
  genres/
    news.ts             Genre packs: register, 5–8 non-negotiable rules,
    evergreen.ts        structure template, headline guidance
    pop-culture.ts
    review-listicle.ts
  select-genre.ts       Pure function: (brief, item?, routerDecision?) → GenrePack
  build-prompts.ts      buildArticlePrompts(...) → { system, user }
```

The three existing prompt files are **replaced**. Call sites updated:
- `generators/claude-generator.ts`, `generators/openai-generator.ts` → `buildArticlePrompts(item, config)` with `sourced` mode.
- `dedicated-agent.ts` → `buildArticlePrompts` with `original` mode (no item).

`Generator` interface, `parseGeneratedArticle`, JSON output schema, word-count handling (`parseWordCountFromGuidelines`, per-genre defaults: news 600–900, others 800–1200), tagging rules, and "no H1 in body" all carry over unchanged.

### Type additions (pipeline-local `types.ts` / `base-generator.ts` only)

- `ContentItem`: add `author: string | null`, `expires_at: string | null` (both already in the API response).
- `PromptContext`: add `contentType`, `author`, `expiresAt`; drop `vertical` (deprecated, always null). `description` becomes nullable-aware.
- Prompt builders omit empty/null fields entirely (never print `**Description:** null`).

## Genre selection

Signals, in priority order:

1. **Site brief is the register authority.** `brief.theme`, `brief.topics`, `brief.tone` determine which packs a site can use at all. A pop-culture/entertainment site maps to `pop-culture`; a review-centric site to `review-listicle`; etc.
2. **Item categories/tags corroborate, never override.** Aggregator categories are observed to be noisy (true-crime content under "Humor and Satire"). Item signals may pick between packs the site allows, but can never force a register the site's brief doesn't support.
3. **Router decision as tiebreak:** `isFactual` → `news`, else `evergreen` (default).

Implemented as a pure function with keyword-matching against brief/topic/category/tag names; fully unit-tested with fixtures including the observed miscategorized true-crime item.

**Dedicated articles** (no item): pack inferred from brief theme/topics, default `evergreen`.

### Tone safety valve (core rule, applies regardless of pack)

Wit/snark is only permitted for celebrity/entertainment subject matter. If the actual subject involves victims, tragedy, crime, disaster, or death, the register drops to sober and respectful — regardless of pack, site tone, or item categories. This rule lives in the core (not in packs) so a misrouted item cannot produce snark about a tragedy.

## Shared core prompt content

### 1. Site identity
Site name, editorial angle (`brief.theme`), audience, tone, topics, SEO focus keywords, editorial guidelines — as today, but framed as a voice to embody, not metadata to echo.

### 2. Input mapping (sourced mode)
Field-by-field guide to the aggregator item. The `summary` is a structured editorial brief whose **section headers vary by content type** — the prompt maps sections by *role*, not exact name:

| Role | Header variants seen | How to use |
|------|---------------------|------------|
| The peg | "What It Covers", "What's Trending" | What happened / what's the moment. Goes up top. |
| The fact base | "Items", "Key Takeaways" | The complete fact universe. Every concrete claim in the article must be grounded here. |
| The timeliness | "Why It Matters Now" | Anchors urgency and framing. |
| The framing hint | "Content Opportunity" | Written for video/social creators — **adapt** the intent to a written article, don't obey it literally. |
| The angle menu | "Key Angles" (may be absent) | Pick **one** and commit. When absent, derive one angle from the fact base. |

The brief is **guidance, not gospel**: mine it for the angle, but since the pipeline cannot fetch the source URL, the brief is also the *entire* fact universe — nothing outside it may be asserted as fact.

Other fields: `description` = tone hint/logline (for `social_post` it is the original post text — quotable with attribution; may be null), `tags` = entities + natural SEO keywords to work in, `published_at` = time anchor (write as current, e.g. "this week"; never sound stale), `expires_at` present = short shelf life, `author`/`source.name` = who originally reported it, for attribution.

**Content-type awareness:**
- `video`: the source video is embedded after paragraph 1 of the published article — write a piece that stands alone but complements it; never write as if the reader already watched it; don't transcribe.
- `social_post`: the description is the original post; the article expands the moment into standalone value.
- `article`: default.

### 3. Truth & honesty rules
Universal (both modes):
- Attribute every reported claim ("Grammer told Vulture", "per reports"). Never state rumor or speculation as fact.
- **Zero fabricated quotes.** Quotation marks only around text verbatim from the brief.
- Separate fact from take: sourced facts vs. the writer's read ("the timing suggests…") — never blurred.
- Frame unconfirmed things as "reportedly" / questions, never accusations. No defamation.

Sourced mode — **incomplete-brief block** (unified rule):
- If the brief names or implies data it doesn't contain ("Items: — not provided"), never reconstruct it from model knowledge. Attribute the full set to the source, deliver only the subset the brief supports, or pick an angle that doesn't need the missing data.
- **Count honesty:** never inherit a number from the source title that the brief can't cover. Source says "15 things", brief has 6 → the article promises 6, or drops the number, or reframes ("Planet Football ranked all 48 squads — these six tell the story"). Never pad to the promised count.

Original mode (dedicated): qualify claims ("research suggests", "according to experts"); no specific statistics/quotes/attributions the model isn't confident in.

### 4. Craft rules
- The peg up top — what happened, who said it, where — THEN the angle. Don't bury the lede under setup.
- One clear angle per article, committed to; not a survey of all possible angles.
- The headline makes a promise the piece keeps — no clickbait gap.
- Opening paragraph hooks; closing lands a point rather than summarizing.
- **No TL;DR. No summary box. No "In conclusion".**
- Concrete specifics over generic filler; varied sentence rhythm; scannable H2/H3 structure.
- Banned AI-isms (explicit list): "in today's fast-paced world", "delve", "it's important to note", "whether you're a X or a Y", "in conclusion", "game-changer", "unlock", "elevate", "navigate the landscape", em-dash overuse, rhetorical-question openers, etc.
- SEO: keywords integrated naturally, never stuffed; meta description written to earn the click honestly.

### 5. Tagging + output format
Unchanged from today: first tag must be a site topic; JSON-only response with existing schema; word-count limits from `content_guidelines`; no H1 in body.

## Genre packs (register + rules + structure + headlines)

- **news** — journalistic register. Inverted-pyramid-with-an-angle; strict attribution; time-anchored ("this week", not dates that will read stale); "according to reports" fallback for vague points; factual headline that still carries the angle.
- **evergreen** — utility register. Practical payoff stated early; how-to/guide structures; no fake urgency or manufactured news pegs; reader leaves with something actionable; headline states the benefit plainly.
- **pop-culture** — the gossip rules, adapted: earn the snark with substance (every joke sits on a real fact); pop-culture literacy is the "pro" tell (genuine connective references a fan would love); playful, never mean or baseless; the news peg still goes up top; fact-vs-take separation is *extra* strict here. Subject-matter safety valve applies.
- **review-listicle** — opinion-forward but justified; clear verdicts with reasoning; comparison logic; never invent specs, prices, or ratings; count honesty is *extra* strict here (this is the listicle pack).

## Testing

1. **Unit tests** (`services/content-pipeline`, existing test setup):
   - `select-genre`: fixtures per pack, including the miscategorized true-crime item (must NOT select pop-culture), fact-router tiebreaks, dedicated/brief-only path.
   - Prompt composition snapshots: sample brief + item per (source mode × genre × content type) — assert TL;DR is absent, key sections present, null fields omitted, word-count injected.
2. **`pnpm typecheck` + `pnpm test`** for content-pipeline.
3. **Manual QA gate (blocking):** generate sample articles locally across all four genres + a video item + a fact-thin item; Asaf reviews output quality. Nothing is committed/deployed before approval (standing rule).

## Rollout

Pipeline-only change: merges → `cloudgrid plug` (with permission). No KV re-seed, no worker deploy. Old prompt files deleted in the same change. Existing published articles are unaffected (TL;DR remains in already-published articles unless regenerated).

## Risks

- **GPT-4o-mini instruction-following:** the composed prompt is longer; 4o-mini may drop rules. Mitigation: imperative phrasing and clear section structure; deliberate redundancy reserved for only the two highest-stakes rules (no fabrication, count honesty), which appear in both the rule block and the output-schema `body` line. If quality is still poor, that's evidence for the deferred model upgrade.
- **Genre misrouting:** mitigated by site-brief-primacy + tone safety valve + unit fixtures from real observed payloads.
- **Word-count pressure vs. richer structure:** packs must respect existing `content_guidelines` limits; craft rules must not push length up. Explicit "STRICT: never exceed" line carries over.
