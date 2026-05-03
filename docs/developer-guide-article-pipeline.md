# Developer Guide — Article Generation Pipeline

> Companion to `docs/developer-guide-content-generation.md`. That doc covers the **orchestration layer** (queue, scheduler, dashboard route, retry policy). **This** doc covers what happens **inside** a single content-generation run — the per-article pipeline mechanics, with focus on the new mandatory three-tier image ladder.
>
> Audience: developers modifying the agent itself (text generation, image generation, scoring, commit shape).
> Last updated: 2026-05-03 against code as of `image-pipeline/generator.ts` and `agent.ts` updates landed today.

## What this document covers

- The end-to-end flow of `runContentGeneration` from "fetch from aggregator" to "batch commit"
- Each function in the pipeline, what it does, where it lives
- **The mandatory three-tier image ladder** (Gemini → OpenAI → exhausted) and what happens when each tier fires
- How "image exhausted on this article" triggers "try a new source URL" without any extra plumbing
- Worked-through failure cases (good for debugging real incidents)

What this doc does NOT cover (read the companion docs):
- BullMQ / queue topology / retries at the job level → `developer-guide-content-generation.md`
- Wizard / new-site creation → `developer-guide-site-creation.md`
- High-level architecture (KV, R2, Worker, two-repo split) → either of the above

---

## Where this code lives

```
services/content-pipeline/src/
├── agents/content-generation/
│   ├── agent.ts                    ← runContentGeneration() + processItem() (the orchestrator)
│   ├── api-client.ts               ← Aggregator HTTP client
│   ├── router.ts                   ← classifyContent() — Claude vs OpenAI routing
│   ├── generators/
│   │   ├── base-generator.ts       ← Generator interface
│   │   ├── claude-generator.ts     ← Claude article generator
│   │   └── openai-generator.ts     ← OpenAI article generator
│   ├── image-pipeline/
│   │   ├── generator.ts            ← generateImageWithLadder() — the three-tier ladder
│   │   ├── analyzer.ts             ← (unused in current path; legacy)
│   │   └── types.ts                ← ImageLadderResult, ImageGenAttempt, ImageLadderAttemptLog
│   ├── seo/
│   │   ├── metadata-generator.ts   ← SEO title/description
│   │   └── slug-generator.ts       ← URL slug
│   └── prompts/
│       ├── general-article.ts      ← OpenAI prompt template
│       └── news-article.ts         ← Claude prompt template
├── lib/
│   ├── gemini.ts                   ← generateImageWithGemini() — single-call provider
│   ├── openai-image.ts             ← generateImageWithOpenAI() — single-call provider
│   ├── concurrency.ts              ← processWithConcurrency() — generic concurrency runner
│   ├── github.ts                   ← Octokit wrappers
│   └── writer.ts                   ← writeArticleBatch() — the batch commit
```

When you're chasing a bug:
- "Image looks wrong / didn't generate" → `image-pipeline/generator.ts` first, then `lib/gemini.ts` or `lib/openai-image.ts`
- "Article body is wrong" → `generators/*-generator.ts` + `prompts/*`
- "Article got abandoned, why?" → `agent.ts` `processItem()` + the image ladder

---

## Top-level flow

```
runContentGeneration({ siteDomain, count, branch })
│
├── 1. getSiteBrief                                      ← reads org → groups → site config
│       (lib/site-brief.ts; falls back to dashboard-index for vertical)
│
├── 2. getAllExistingArticles                            ← builds dedup set (URLs + titles)
│       (agent.ts; reads sites/<id>/articles/*.md frontmatter)
│
├── 3. Resolve tag IDs from topics if needed             ← aggregator API
│       (api-client.ts: resolveTopicTagIds)
│
├── 4. Paginate aggregator until we have enough          ← MAX_PAGES=5, PAGE_SIZE=20
│   ┌─────────────────────────────────────────────────────────┐
│   │ for page in 1..5:                                       │
│   │   fetch 20 items from aggregator                        │
│   │   filter out items already in dedup set                 │
│   │   if newItems.length >= count: break                    │
│   │   if last page reached: break                           │
│   └─────────────────────────────────────────────────────────┘
│       Result: pool of `newItems` (>= count if all goes well, fewer if exhausted)
│
├── 5. processWithConcurrency(newItems, MAX_CONCURRENCY=3, targetCount=count, processItem)
│   │       ↑
│   │       Keeps launching items until we have `count` SUCCESSES,
│   │       OR we run out of items in the pool.
│   │       Failed items don't count toward target — runner picks the next item.
│   │       This is the "try a new source URL on failure" mechanism.
│   │
│   └── For each item, runs processItem(item) ──────────► see "Per-article pipeline" below
│
├── 6. Batch commit (writeArticleBatch)                  ← one git commit, all articles + assets
│       (lib/writer.ts; Git Data API: blobs + tree + commit + ref)
│
└── return BatchContentGenerationResult
        { siteDomain, requested, totalSourced, duplicateCount, availableNew, results: [...] }
```

**Key insight:** `processWithConcurrency` is what makes the image-exhausted-retry-with-new-source pattern work without any explicit retry plumbing. When `processItem` returns `{ status: "error", reason: "image_gen_exhausted" }`, that's just "not a success" — the runner picks the next item from the pool and tries it. From `runContentGeneration`'s point of view, abandoning an article and grabbing a new source URL is the same code path as "this item happened to be skippable."

---

## Per-article pipeline (`processItem`)

Lives at `agent.ts:471`. Called once per candidate item from the aggregator. Returns one of:

```ts
{ status: "created",  slug, path, qualityScore, articleStatus, generatedBy, _pendingArticle, _pendingAsset }
{ status: "skipped",  reason }     // pre-flight: no summary, non-EN, etc.
{ status: "error",    reason, message }
```

### Pipeline stages

```
processItem(item, settings, config, siteDomain, siteName, brief, branch)
│
├── 0. Pre-flight skips
│      • no/short summary       → return { skipped, reason: "no summary" }
│      • non-English language   → return { skipped, reason: "non-English: ..." }
│
├── 1. classifyContent(item, settings)                      ← router.ts
│      Determines factual (→ Claude) vs general (→ OpenAI)
│      Output: { generator, isFactual, reason }
│
├── 2. Generate article body                                ← generators/*-generator.ts
│   │   primary  = decision.isFactual ? claude : openai
│   │   fallback = decision.isFactual ? openai : claude
│   │
│   │   try primary.generate(item, { siteName, brief })
│   │   catch → fallback.generate(item, { siteName, brief })   ← cross-provider fallback
│   │   if both throw → escapes to outer catch → return { status: "error", message }
│   │
│   └── Output: { title, description, body, slug, type, tags }
│
├── 3. Slug resolution (resolveUniqueSlug)                  ← agent.ts
│      Uses generated.slug if present, else generateSlug(title).
│      Suffixes -2, -3, etc. if collision with existing article.
│
├── 4. Image generation (MANDATORY, three-tier ladder)      ← image-pipeline/generator.ts
│   │
│   │   See "The image ladder" section below for full detail.
│   │
│   │   if ladder returns { ok: false, reason: "image_gen_exhausted" }:
│   │      ↳ return { status: "error", reason: "image_gen_exhausted", message: <reason chain> }
│   │      ↳ processWithConcurrency picks NEXT source URL → new processItem() invocation
│   │
│   └── Output (on success): pendingImageAsset, featuredImageUrl
│
├── 5. SEO metadata                                         ← seo/metadata-generator.ts
│      Generates: metaDescription, readingTime
│      Uses featuredImageUrl in og:image
│
├── 6. Article type validation                              ← agent.ts
│      Coerces to one of: "listicle" | "how-to" | "review" | "standard"
│
├── 7. Topic tag enforcement                                ← agent.ts: ensureTopicTag
│      Ensures at least one tag matches a site topic (for category page filtering).
│      Adds the topic as a tag if generator didn't include one.
│
├── 8. Quality scoring (Claude)                             ← content-quality/scorer.ts
│   │   Calls Claude with the article + brief + quality_weights.
│   │   Output: { overallScore, breakdown, note }
│   │
│   │   If scoring throws: log, default to status: "published" with quality_note.
│   │   Score >= threshold → "published"; else "review" (lands in Review Queue).
│   │
├── 9. Build frontmatter + body
│      • Strips leading H1 from body (models sometimes include despite prompts)
│      • Serializes via gray-matter
│
└── return {
      status: "created",
      slug, path, qualityScore, articleStatus, generatedBy,
      _pendingArticle: { siteDomain, slug, content },
      _pendingAsset: { siteDomain, assetPath, data: <PNG bytes> },
    }
```

`_pendingArticle` and `_pendingAsset` are collected by `runContentGeneration` and committed in **one batch** at the end (single git commit per site batch).

---

## The image ladder

Lives at `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`.

Single function: `generateImageWithLadder(input)`. Returns `ImageLadderResult` (success with the image, or `{ ok: false, reason: "image_gen_exhausted", attempts: [...] }`).

### Mental model

Image generation is **mandatory**. There is no source-thumbnail fallback for the article's hero image — if the ladder returns exhausted, the article is abandoned and the outer loop tries a different source URL.

The thumbnail still has a role, but as a **style reference fed into Gemini's prompt**, not as a fallback for the final image.

### Flow chart

```
generateImageWithLadder(input)
│
├── (Optional) fetchThumbnail(input.sourceThumbnailUrl)        ← best-effort, 10s timeout
│       on success: reference = { data: base64, mimeType }
│       on failure: reference = undefined; ladder continues without it
│
├── geminiPrompt = buildImagePrompt(input, hasReference: !!reference)
│       prompt varies by whether we have a reference image:
│         • with ref: "Match the visual style (photo vs illustration) of the attached..."
│         • no ref:   "Create a professional editorial illustration..."
│
├──── TIER A: Gemini (gemini-2.5-flash-image) ────────────────────────────────────
│   │
│   │   if !GEMINI_API_KEY:
│   │     attempts.push({ provider: "gemini", reason: "api_key_not_configured" })
│   │     skip Tier A entirely
│   │
│   │   for attempt in 1..2:
│   │     log "Tier A: Gemini attempt {n}/2"
│   │     result = generateImageWithGemini(key, geminiPrompt, reference)
│   │
│   │     if result.ok:
│   │       return { ok: true, result: { data, altText, prompt } }
│   │
│   │     attempts.push({ provider: "gemini", reason: result.reason })
│   │
│   │     if !result.retriable:
│   │       break   ← skip remaining Gemini attempts (permanent failure)
│   │
│   └─── (fall through to Tier B if Gemini exhausted)
│
├──── TIER B: OpenAI (gpt-image-1) ───────────────────────────────────────────────
│   │
│   │   if !OPENAI_API_KEY:
│   │     attempts.push({ provider: "openai", reason: "api_key_not_configured" })
│   │     skip Tier B
│   │
│   │   openaiPrompt = buildImagePrompt(input, hasReference: false)   ← OpenAI prompt is text-only
│   │   result = generateImageWithOpenAI(key, openaiPrompt)            ← 1 attempt only
│   │
│   │   if result.ok:
│   │     return { ok: true, result: { data, altText, prompt: openaiPrompt } }
│   │
│   │   attempts.push({ provider: "openai", reason: result.reason })
│   │
└──── TIER C: Exhausted ──────────────────────────────────────────────────────────
        log error with full reason chain ("gemini:rate_limited:429, openai:client_error:400")
        return { ok: false, reason: "image_gen_exhausted", attempts }
```

### Why the tier shape is what it is

| Choice | Why |
|---|---|
| **Gemini gets 2 attempts, OpenAI gets 1** | Gemini is the primary (cheaper, accepts a reference image, faster). The retry catches transient blips. OpenAI is the fallback — by the time we get there, Gemini has already failed twice; one shot is enough to determine if it works at all. |
| **OpenAI prompt has no reference image** | gpt-image-1's API doesn't accept a reference image input; only text prompts. Gemini does (multimodal input). If we want reference-style matching, we have to use Gemini. |
| **Prompt differs based on `hasReference`** | With a reference: "match the source's style — photo if photo, illustration if illustration." Without: "professional editorial illustration." Lets the visual identity adapt to the source material. |
| **Retriable classification** | 5xx, 429, timeouts, network errors → `retriable: true` (transient). 4xx (auth, content policy, bad request) → `retriable: false` (permanent — won't get better with retry). |
| **No fallback to source thumbnail** | This is a deliberate change — image gen is now mandatory. Source thumbnail quality is unreliable; some are tiny / watermarked / wrong aspect ratio. Better to abandon and use a different source URL than ship a low-quality image. |

### What "transient" vs "permanent" means in the providers

`generateImageWithGemini` and `generateImageWithOpenAI` (in `lib/`) classify their own failures and return `ImageGenAttempt`:

```ts
type ImageGenAttempt =
  | { ok: true; data: Buffer }
  | { ok: false; retriable: boolean; reason: string };
```

Mapping (same logic in both provider files):

| HTTP / Error | retriable | Reason label | Ladder behavior |
|---|---|---|---|
| 200 + valid image | (success) | — | Return image immediately |
| 200 but no image in response | `false` | `no_image_in_response` | Skip remaining attempts in same tier |
| 429 (rate limit) | `true` | `rate_limited:429` | Retry within tier |
| 5xx server error | `true` | `server_error:5xx` | Retry within tier |
| 4xx (auth, content policy, bad request) | `false` | `client_error:4xx` | Skip remaining attempts in same tier |
| Network timeout | `true` | `timeout` | Retry within tier |
| Other network error (TypeError) | `true` | `<error message>` | Retry within tier |

In Tier A, "skip remaining attempts" still leaves Tier B to run. In Tier B (single attempt), there are no remaining attempts to skip — it falls through to Tier C either way.

---

## What happens when the ladder exhausts: the source-URL retry

This is the part that confuses people because it has no explicit retry code. Here's the actual mechanism:

```
runContentGeneration
│
├── pool = newItems (from aggregator, deduplicated)         e.g. 20 items
│
└── processWithConcurrency(pool, maxConc=3, target=5, processItem, isSuccess)
       │
       │   isSuccess = (result) => result.status === "created"
       │
       │   The runner keeps launching items from the pool. When `processItem`
       │   returns a non-success (skipped or error — including image_gen_exhausted),
       │   the success counter doesn't tick. The runner just launches the NEXT item
       │   to fill the concurrency slot.
       │
       │   Stops launching when:
       │     - successCount + inFlight.size >= targetCount (we have / will have enough)
       │     - nextIndex >= items.length (pool exhausted)
       │
       │   Returns: all results (mixed status — caller filters for "created")
       │
       └── Final cap: results.filter(r => r.status === "created").slice(0, targetCount)
```

So when an article hits image_gen_exhausted:

```
Time 0:  Pool has 20 candidates. Want 5 articles.
         Launch items A, B, C in parallel (maxConcurrency = 3).

Time 1:  Item A's image ladder exhausts (Gemini permanent + OpenAI permanent).
         processItem returns { status: "error", reason: "image_gen_exhausted" }.
         successCount stays at 0.

Time 1.1: Runner sees a free slot. Launches item D.
         Now in flight: B, C, D.

Time 2:  Item B succeeds. successCount = 1.
         Runner launches item E.
         In flight: C, D, E.

... etc until successCount = 5 OR pool runs out.
```

If the pool runs out before we hit `targetCount`, the result has `< targetCount` "created" entries. `runContentGeneration` returns them anyway — partial success is acceptable. Caller gets:

```ts
{
  siteDomain: "coolnews-atl",
  requested: 5,
  totalSourced: 20,
  duplicateCount: 4,
  availableNew: 16,
  results: [
    { status: "created", ... },     // ×3
    { status: "error", reason: "image_gen_exhausted", ... },  // ×N
    { status: "skipped", reason: "non-English: FR", ... },    // ×M
  ],
}
```

The scheduler reads this and writes per-site result `{ articlesCreated: 3, articlesRequested: 5, status: "partial" }` to scheduler-history.yaml.

**Practical implication for buffer sizing:** if Tier-C exhaustion is common, the agent burns through the 100-candidate pool faster than expected. Watch this metric in production. If it's >20% of articles hitting Tier C, raise `MAX_PAGES` from 5 to 7 or 10.

---

## Function reference (quick lookup)

### Orchestration

| Function | File | Purpose |
|---|---|---|
| `runContentGeneration(params, config)` | `agents/content-generation/agent.ts:662` | Top-level entry. Reads brief, paginates aggregator, runs concurrent processItem, batch-commits. |
| `processItem(item, ...)` | `agents/content-generation/agent.ts:471` | Per-article pipeline. Routes, generates body, runs image ladder, scores, builds frontmatter. |
| `processWithConcurrency(items, maxConc, targetCount, processor, isSuccess)` | `lib/concurrency.ts:11` | Generic concurrency runner with early-stop. The "abandon-and-try-next" mechanism. |
| `getAllExistingArticles(config, siteDomain, branch)` | `agents/content-generation/agent.ts` | Builds the dedup set from existing article frontmatter (URLs + normalized titles). |
| `resolveUniqueSlug(config, siteDomain, baseSlug, branch)` | `agents/content-generation/agent.ts` | Suffixes `-2`, `-3` etc. on collision. |
| `ensureTopicTag(generatedTags, briefTopics, articleTitle)` | `agents/content-generation/agent.ts:120` | Forces at least one tag to match a site topic (category page filtering). |

### Aggregator

| Function | File | Purpose |
|---|---|---|
| `getContent({ limit, page, language, category_ids, tag_ids })` | `agents/content-generation/api-client.ts` | Page-fetch from Content Aggregator. |
| `getSettings()` | `agents/content-generation/api-client.ts` | Fetches AggregatorSettings (used for factual classification). |
| `resolveTopicTagIds(topics)` | `agents/content-generation/api-client.ts` | Topic strings → aggregator tag IDs. |

### Routing & text generation

| Function | File | Purpose |
|---|---|---|
| `classifyContent(item, settings)` | `agents/content-generation/router.ts` | Returns `{ generator: "claude" \| "openai", isFactual, reason }`. |
| `claudeGenerator.generate(item, config)` | `agents/content-generation/generators/claude-generator.ts` | Article body via Claude (factual content). |
| `openaiGenerator.generate(item, config)` | `agents/content-generation/generators/openai-generator.ts` | Article body via OpenAI (general content). |

Both implement the `Generator` interface (`base-generator.ts`) → `{ generate(item, config): Promise<V2GeneratedArticle> }`. Cross-provider fallback inside `processItem` swaps primary↔fallback if primary throws.

### Image generation

| Function | File | Purpose |
|---|---|---|
| `generateImageWithLadder(input)` | `agents/content-generation/image-pipeline/generator.ts:115` | Three-tier orchestrator (Gemini ×2 → OpenAI ×1 → exhausted). |
| `buildImagePrompt(input, hasReference)` | `agents/content-generation/image-pipeline/generator.ts:33` | Builds the text prompt; varies by whether a reference image is attached. |
| `fetchThumbnail(url)` | `agents/content-generation/image-pipeline/generator.ts:64` | Downloads source thumbnail (best-effort), returns base64 + mime. |
| `generateAltText(input)` | `agents/content-generation/image-pipeline/generator.ts:104` | Builds alt text (`Image for: ${title}`). |
| `generateImageWithGemini(apiKey, prompt, reference?)` | `lib/gemini.ts:28` | Single Gemini API call. Returns `ImageGenAttempt`. |
| `generateImageWithOpenAI(apiKey, prompt)` | `lib/openai-image.ts` | Single gpt-image-1 API call. Returns `ImageGenAttempt`. |

### SEO + scoring

| Function | File | Purpose |
|---|---|---|
| `generateSEOMetadata(generated, item, isFactual, featuredImageUrl)` | `agents/content-generation/seo/metadata-generator.ts` | Meta description, og:image, reading time. |
| `generateSlug(title)` | `agents/content-generation/seo/slug-generator.ts` | URL-safe slug from title. |
| `scoreArticle(article, siteName, brief, weights)` | `agents/content-quality/scorer.ts` | Claude-based 5-dimension scoring. |
| `resolveQualityStatus(score, threshold)` | `agents/content-quality/scorer.ts` | Maps score + threshold to `"published"` or `"review"`. |

### Commit

| Function | File | Purpose |
|---|---|---|
| `writeArticleBatch(config, pendingArticles, pendingAssets, message)` | `lib/writer.ts:113` | Single atomic commit of N articles + N images via Git Data API. Falls back to local FS write if `LOCAL_NETWORK_PATH` set and no branch. |

---

## Worked example: image ladder cases

Real-life scenarios with what each path looks like in logs.

### Case 1 — Gemini succeeds first try (the happy path, ~85% of articles)

```
[img-gen] Fetching source thumbnail: https://example.com/thumb.jpg
[img-gen] Reference image loaded (47 KB)
[img-gen] Tier A: Gemini attempt 1/2 for "Lobsters Feel Pain..."
[gemini] POST .../gemini-2.5-flash-image:generateContent
[img-gen] Gemini succeeded (218 KB)
[agent] Generated image: assets/images/lobsters-feel-pain-...png
```

Returns `{ ok: true, result }`. processItem continues with SEO, scoring, batch commit.

### Case 2 — Gemini transient blip on first attempt, succeeds on second

```
[img-gen] Tier A: Gemini attempt 1/2 for "Climate Crisis..."
[gemini] POST .../gemini-2.5-flash-image:generateContent
[gemini] Image generation failed: 503 Service Unavailable
[img-gen] Gemini attempt 1 failed: server_error:503 (retriable=true)
[img-gen] Tier A: Gemini attempt 2/2 for "Climate Crisis..."
[gemini] POST .../gemini-2.5-flash-image:generateContent
[img-gen] Gemini succeeded (256 KB)
```

`retriable: true` triggered the second attempt. Article proceeds normally.

### Case 3 — Gemini permanent failure (content policy), OpenAI rescues

```
[img-gen] Tier A: Gemini attempt 1/2 for "Sensitive Topic Article"
[gemini] POST .../gemini-2.5-flash-image:generateContent
[gemini] Image generation failed: 400 Bad Request
[gemini] Response: {"error":{"message":"prompt blocked by safety filters"}}
[img-gen] Gemini attempt 1 failed: client_error:400 (retriable=false)
[img-gen] Tier B: OpenAI attempt for "Sensitive Topic Article"
[openai-img] POST https://api.openai.com/v1/images/generations model=gpt-image-1
[img-gen] OpenAI succeeded (412 KB)
```

`retriable: false` skipped Gemini's second attempt and dropped through to OpenAI immediately. Note the prompt sent to OpenAI is the no-reference variant.

### Case 4 — Both providers exhausted, article abandoned

```
[img-gen] Tier A: Gemini attempt 1/2 for "Edge Case Article"
[gemini] Image generation failed: 400 Bad Request
[img-gen] Gemini attempt 1 failed: client_error:400 (retriable=false)
[img-gen] Tier B: OpenAI attempt for "Edge Case Article"
[openai-img] Image generation failed: 400 Bad Request
[openai-img] Response: {"error":{"code":"content_policy_violation"...}}
[img-gen] OpenAI failed: client_error:400
[img-gen] Image generation exhausted for "Edge Case Article": gemini:client_error:400, openai:client_error:400
[agent] Image generation exhausted for "Edge Case Article": gemini:client_error:400, openai:client_error:400
```

`processItem` returns `{ status: "error", reason: "image_gen_exhausted", message: "Image generation failed: gemini:client_error:400, openai:client_error:400" }`. `processWithConcurrency` doesn't count it as a success → launches the next item from the pool. The article body that was generated is **discarded** (not written to disk; not committed).

### Case 5 — `OPENAI_API_KEY` missing in env, Gemini exhausted

```
[img-gen] Tier A: Gemini attempt 1/2
[gemini] Image generation failed: 500 Internal Server Error
[img-gen] Gemini attempt 1 failed: server_error:500 (retriable=true)
[img-gen] Tier A: Gemini attempt 2/2
[gemini] Image generation failed: 500 Internal Server Error
[img-gen] Gemini attempt 2 failed: server_error:500 (retriable=true)
[img-gen] Tier B skipped: OPENAI_API_KEY not set
[img-gen] Image generation exhausted: gemini:server_error:500, gemini:server_error:500, openai:api_key_not_configured
```

Without OpenAI as a fallback, Gemini outage = images fail = articles abandoned. The system degrades but doesn't crash; if Gemini is down for 30 minutes, generation runs return mostly-empty results during that window. **In practice: ensure `OPENAI_API_KEY` is set in production.**

### Case 6 — Source thumbnail URL is broken (best-effort, doesn't stop the ladder)

```
[img-gen] Fetching source thumbnail: https://example.com/missing.jpg
[img-gen] Thumbnail fetch failed: 404 https://example.com/missing.jpg
[img-gen] Tier A: Gemini attempt 1/2 for "Article"   ← no reference image attached
[img-gen] Gemini succeeded (198 KB)
```

Thumbnail fetch is not part of the ladder's success criteria. Without a reference, Gemini gets the no-reference prompt ("professional editorial illustration") and proceeds.

---

## Edge cases / gotchas

### Tier B is skipped if `OPENAI_API_KEY` is absent

The ladder gracefully skips Tier B with `attempts.push({ provider: "openai", reason: "api_key_not_configured" })`. But if Gemini is having a bad day, you lose your fallback. **Set the secret in production:**

```bash
cloudgrid secrets set atomic-content-platform OPENAI_API_KEY=sk-...
```

`OPENAI_API_KEY` is shared with the OpenAI text generator (`openai-generator.ts`). Same secret, two endpoints.

### Why do we keep `analyzer.ts` if it's unused?

Legacy from an earlier image-pipeline iteration that did vision-analysis on the source thumbnail before generating. Current ladder bypasses it — Gemini handles the reference image directly. **Safe to delete in a future cleanup PR**, kept for now to avoid churn.

### Retry token cost on image exhaustion

When `processItem` returns `image_gen_exhausted`, the article body that was generated is thrown away. That's typically $0.05-0.30 of LLM spend per abandoned article. At scale, this is the dominant cost of mandatory image generation.

If we observe Tier C exhaustion firing >5% of the time, two mitigations are available:
1. **Increase Gemini retry budget** (raise `MAX_GEMINI_ATTEMPTS` to 3) — costs more Gemini calls but lets transient bursts recover.
2. **Add a third tier** (e.g. Stable Diffusion via Replicate) — more code but a third provider.

Don't pre-optimize. Measure first.

### Prompt content policy is the silent killer

Both providers have content policy filters that reject prompts containing certain topics, names, or visual concepts. Articles about real public figures, sensitive medical/political topics, or violent events frequently trigger these.

If you see consistent Tier C exhaustion on a specific article topic, check the article title and description. The fix is usually editing the prompt builder (`buildImagePrompt`) to be more abstract — e.g. "a generic news scene" instead of "a photo of [specific person]".

### `_pendingAsset` always has data after a successful processItem

Pre-mandatory: `_pendingAsset` could be undefined if image gen failed but article still shipped (with thumbnail fallback). **Post-mandatory: if `processItem` returns `created`, `_pendingAsset` is always defined.** No more conditional handling at the batch-commit stage.

### Aggregator pagination buffer

`MAX_PAGES = 5, PAGE_SIZE = 20` → 100 candidate items max per generation run. With mandatory images, exhausted articles burn pool entries. If you want X articles and the exhaustion rate is Y%, you need at least `X / (1 - Y)` candidates.

For X=5, Y=20%: need at least 6.25 candidates. Comfortably within 100.
For X=10, Y=20%: 12.5. Still fine.
For X=50 (unusual single-batch), Y=20%: 62.5. Need full 100 candidates.

If we ever do truly large batch sizes (e.g. backfilling a new site with 100 articles in one run), bump `MAX_PAGES` to 10 or implement adaptive pagination.

---

## What changed recently (2026-05-03)

The previous flow had image generation as best-effort:
- `try { generateImage(...) } catch { /* log + continue with thumbnail */ }`
- Articles always shipped (with the source thumbnail as fallback if Gemini failed)
- `_pendingAsset` was optional

The new flow makes image generation **mandatory** and adds the OpenAI fallback tier:
- `generateImageWithLadder` returns either a guaranteed image or `image_gen_exhausted`
- On exhaustion, `processItem` returns `{ status: "error" }` — article is abandoned, batch continues with next source URL
- `_pendingAsset` is now guaranteed when status === "created"
- New file: `lib/openai-image.ts` (gpt-image-1 provider)
- `lib/gemini.ts` updated to return `ImageGenAttempt` (structured success/failure with retriable flag)
- New types in `image-pipeline/types.ts`: `ImageGenAttempt`, `ImageLadderResult`, `ImageLadderAttemptLog`

The change in `processItem` is concentrated at lines 518-548 of `agent.ts`.

---

## Companion docs

- `developer-guide-content-generation.md` — orchestration layer (queue, scheduler, dashboard, retry policy)
- `developer-guide-site-creation.md` — wizard / new-site flow
- `flow-map-he.md` (Hebrew) + memory's `flow_map_atl_network.md` (English) — cross-cutting flow maps for non-developer audiences

When you change article-pipeline behavior (add a tier, change classification, swap a provider), update **this** doc and confirm the worked-example log lines still match. The example log lines are the most fragile part of this doc — if logging strings change, this doc lies until updated.
