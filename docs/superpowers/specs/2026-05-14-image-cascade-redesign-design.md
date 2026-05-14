# Image Cascade Redesign — Design Spec

**Date:** 2026-05-14

**Goal:** Reduce the rate at which generated articles fall back to the source thumbnail by adding a sanitization-and-style-escalation cascade, and replace the thumbnail fallback with a route to the review queue so failures become visible rather than silently degraded.

---

## Problem

The current image pipeline (`services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`) runs a three-tier ladder: Gemini → OpenAI → source thumbnail. Both image providers refuse on the same content-policy red lines (real named people, brand logos, lawsuits/scams/violent framing), which are common in news content. Refusals are returned as `no_image_in_response` (non-retriable), so Stage 1 fails fast and we cascade. OpenAI refuses on the same topic for the same reason, and the article ends up with a re-encoded copy of the source article's original thumbnail.

Two consequences:

1. **High Tier-C rate.** A significant fraction of articles ship with a thumbnail-derived image rather than an AI-generated one. The original article's thumbnail often contains the very content (faces, brand logos) that caused the AI refusal in the first place.
2. **No diagnostics.** The frontmatter records `featuredImage: <url>` but nothing about which tier produced it or why upstream tiers failed. `cloudgrid logs` only retain since the last deploy; Slack/Telegram notifications are transient and not aggregated. There is no way to count or categorize failures after the fact.

There is also a latent bug: when Gemini returns `no_image_in_response`, the code marks the failure non-retriable and `break`s out of the Gemini loop (`generator.ts:228`). So the documented "Tier A: 2 attempts" is effectively 1 attempt for the most common failure mode. OpenAI in Tier B gets only 1 attempt with no retry even on transient errors (5xx/429).

## Solution

Replace the three-tier ladder with a three-stage cascade. Each stage escalates by changing *the prompt* and/or *the style*, not just the provider. After all three stages fail, drop the article to the review queue with no `featuredImage` — never fall back to the source thumbnail.

The cascade also records per-stage attempts in the article frontmatter, giving permanent observability that survives redeploys.

## Scope

**In scope:**
- Three-stage cascade replacing the current ladder (Stage 1 realism-raw → Stage 2 realism-sanitized → Stage 3 illustration-sanitized)
- Prompt sanitizer module that produces a neutral visual concept from the article metadata
- New frontmatter fields: `image_provider`, `image_stage`, `image_attempts`
- "Drop to review" terminal behavior: `status: review`, `quality_note` populated, no `featuredImage`, no thumbnail fallback
- Stage 1 OpenAI gains retry-on-transient (matching Gemini's existing pattern) — fixes latent bug
- New distinctly-worded notification when an article is dropped to review for image failure
- Unit tests for the sanitizer and the new cascade behavior

**Out of scope:**
- Review-queue UI changes (upload/regenerate image actions) — separate sub-project, separate spec
- Backfilling existing articles with the new frontmatter fields — forward-only
- New providers (FLUX, Qwen, etc.)
- Pre-flight "is this article sensitive?" detection — explicitly rejected; cascade handles it lazily
- Dashboard aggregation/visualization of `image_attempts` data — out of scope here; a separate concern once data exists
- Body/title editing of articles in review — out of scope (this spec only changes how images are generated and how failures are recorded)

## Cascade structure

| Stage | Style | Prompt source | Providers (in order) | Reference image |
|------|-------|---------------|----------------------|-----------------|
| **1** | Realism | Raw article title + description (today's prompt) | Gemini ×2 (retry on transient) → OpenAI ×1 (retry on transient) | Source thumbnail attached to Gemini only |
| **2** | Realism | Sanitized visual concept | Gemini ×1 → OpenAI ×1 (no retry within stage) | None |
| **3** | Illustration | Sanitized visual concept (reused from Stage 2) | Gemini ×1 → OpenAI ×1 (no retry within stage) | None |
| **Fail** | — | — | — | Drop to review, no `featuredImage` |

**Stage 1 semantics:** identical to today's behavior except OpenAI now retries once on transient errors (5xx/429/timeout/network). Transient = retriable per existing classification in `lib/gemini.ts` and `lib/openai-image.ts`. Permanent refusals (`no_image_in_response`, 4xx) advance to the next provider, then the next stage.

**Stage 2 entry:** when Stage 1 exhausts all attempts. Calls the sanitizer first; on sanitizer success, builds a new prompt using the sanitized concept and the same realism instructions; runs Gemini once, then OpenAI once. Sanitizer failure short-circuits both Stage 2 and Stage 3 (since Stage 3 needs the concept too) and goes straight to drop-to-review.

**Stage 3 entry:** when Stage 2 exhausts. Reuses the cached sanitized concept from Stage 2 — never calls the sanitizer twice. Style changes to "clean modern editorial illustration." No reference image.

**Worst-case latency:** ~3 minutes (Gemini 60s × 3 + OpenAI 90s × 3 + sanitizer ~5s). Today's worst case is ~30s. Acceptable because content generation runs in BullMQ workers, not a request path.

## Prompt sanitizer

New module: `services/content-pipeline/src/agents/content-generation/image-pipeline/sanitizer.ts`.

**One Claude call** via the existing CloudGrid AI Gateway. Called **lazily** only after Stage 1 fails. Result is cached in memory within the cascade function so Stage 3 reuses it — never two sanitizer calls per article.

**Input:** `{ title, description, summary, vertical }` from the article being generated.

**Output:** a single sentence (≤ 25 words) describing a visual subject, subject to hard constraints:
- No proper nouns (no person names, no company/brand names, no specific product names)
- No negative or sensitive framing — words like "scheme," "lawsuit," "crash," "scandal," "fraud," "attack" must be reframed to a neutral domain reference
- No specific trademarked product appearances
- Focus on the *domain* and *abstract concept* rather than the *actors*

**Example transformations:**

| Article title | Sanitized concept |
|---|---|
| `Caitlyn Jenner Class-Action Crypto Scheme Lawsuit` | `Courtroom gavel resting beside cryptocurrency tokens on a desk, editorial photography style, neutral palette.` |
| `Coinbase Infrastructure Review AWS Outage` | `Modern data center server racks with status lights, editorial photography style.` |
| `Fed Survey: AI Financial Stability Risk` | `Abstract economic indicators chart with circuit-board overlay, editorial photography style.` |

**Failure handling:** sanitizer errors (Claude timeout, malformed response, content that can't be sanitized within constraints) are treated as a hard cascade failure and recorded as `{ stage: 2, provider: "sanitizer", reason: <error> }` in `image_attempts`. The cascade skips Stage 2 and Stage 3 (both need the concept) and goes directly to drop-to-review.

## Frontmatter changes

Three new optional fields, populated only on successful generation:

```yaml
featuredImage: /assets/images/<slug>.webp
image_provider: gemini       # or "openai"
image_stage: 1               # or 2, or 3
image_attempts:              # full chain — kept short, includes successful final entry
  - { stage: 1, provider: gemini,  reason: no_image_in_response }
  - { stage: 1, provider: openai,  reason: "client_error:400" }
  - { stage: 2, provider: gemini,  reason: ok }
```

On total cascade failure:

```yaml
status: review
quality_note: "image generation failed after 3 stages: <reason chain>"
# image_provider, image_stage, featuredImage all absent
image_attempts:
  - { stage: 1, provider: gemini, reason: no_image_in_response }
  - { stage: 1, provider: openai, reason: no_image_in_response }
  - { stage: 2, provider: gemini, reason: no_image_in_response }
  - { stage: 2, provider: openai, reason: no_image_in_response }
  - { stage: 3, provider: gemini, reason: no_image_in_response }
  - { stage: 3, provider: openai, reason: no_image_in_response }
```

`image_attempts` is the persistent diagnostic record that survives redeploys. Operators can grep the network repo to count cascade rates and categorize failure reasons.

## Error handling & retry semantics

- **Stage 1** preserves today's retry semantics for Gemini (2 attempts, retry only on transient) and adds the same pattern for OpenAI (was: 1 attempt no retry; now: 1 attempt + 1 retry on transient).
- **Stages 2 and 3** give each provider exactly 1 attempt, no transient retry within the stage. Keeps cost predictable when we're already on a difficult article.
- **Permanent errors** (`no_image_in_response`, 4xx other than 429) advance to the next provider, then the next stage.
- **Transient errors** in Stages 2/3 advance to the next provider immediately (no retry).
- **Sanitizer failure** → record reason, skip Stage 2 and Stage 3, drop to review.
- **All three stages fail** → drop to review: `status: review`, `quality_note` populated, no `featuredImage`, `image_attempts` includes full chain.

## Notifications

The existing `notifyImageGeneration` in `services/content-pipeline/src/lib/notifications.ts` is reused for per-stage transitions, with the stage number added to the provider label (e.g., `"Gemini Stage 2 (gemini-2.5-flash-image)"`). The final drop-to-review event fires a new, distinctly worded message so operators can filter for it:

```
Image generation FAILED for "<title>" (<site>) — article sent to review.
Reason chain: <comma-separated reasons>
```

Same channel as today (Slack + Telegram if configured).

## Files touched

```
services/content-pipeline/src/agents/content-generation/image-pipeline/
  generator.ts         — replace generateImageWithLadder with generateImageWithCascade
  sanitizer.ts         — NEW: prompt sanitization via Claude
  types.ts             — extend ImageLadderResult/AttemptLog with stage field

services/content-pipeline/src/agents/content-generation/
  agent.ts             — handle new result shape; on failure set status=review,
                         quality_note, image_attempts; on success set image_provider,
                         image_stage, image_attempts

services/content-pipeline/src/lib/
  notifications.ts     — add notifyImageDroppedToReview helper (new message string)

services/content-pipeline/src/__tests__/
  image-ladder.test.ts — rename to image-cascade.test.ts; update for new cascade
  sanitizer.test.ts    — NEW

packages/shared-types/src/   — add image_provider, image_stage, image_attempts to
                                ArticleFrontmatter type (and ArticleFrontmatterWithExtras)
```

R2 upload, writer, dedup-index, scheduler paths are untouched. Migration orchestrator (`agents/migration/orchestrator.ts`) is untouched — migration imports historical articles and has its own image flow that uses the source thumbnail by design.

## Testing strategy

**New unit tests (`sanitizer.test.ts`):**
- Returns a valid concept for a benign title
- Returns a valid concept for a sensitive title (real person + negative framing)
- Constraint enforcement: output contains no proper nouns when input did
- Constraint enforcement: output contains no banned framing words
- Returns structured failure on Claude error
- Returns structured failure on Claude returning unparseable content

**Updated cascade tests (`image-cascade.test.ts`):**
- Stage 1 happy path: Gemini succeeds first attempt → result has `image_stage: 1, image_provider: gemini`
- Stage 1 OpenAI succeeds after Gemini fails twice → `image_stage: 1, image_provider: openai`
- Stage 1 OpenAI retries on transient (new behavior)
- Stage 2 happy path: Stage 1 fails, sanitizer succeeds, Stage 2 Gemini succeeds → `image_stage: 2`
- Stage 3 happy path: Stages 1 and 2 fail, Stage 3 Gemini succeeds with illustration prompt → `image_stage: 3`
- Sanitizer failure: Stage 1 fails, sanitizer errors → result is `{ ok: false }`, attempts include sanitizer error, no Stage 2/3 calls made
- Total cascade failure: all stages fail → result is `{ ok: false }`, attempts has 6 entries
- Sanitizer is called at most once (verified via mock call count)
- Reference image is attached to Stage 1 Gemini, never to Stage 2/3

**Updated agent tests:**
- On total failure, agent sets `status: review`, `quality_note`, `image_attempts`, no `featuredImage`
- On success, agent sets `image_provider`, `image_stage`, `image_attempts` correctly

Existing tests for `gemini.ts` and `openai-image.ts` are unchanged — those modules' interfaces don't change.

## Decisions made

- **Sanitizer uses Claude, not OpenAI.** CloudGrid AI Gateway is already configured for Claude (no `ANTHROPIC_API_KEY` env needed per `cloudgrid.yaml`). One less moving piece.
- **Sanitizer called lazily, after Stage 1 fails.** Skips the cost when Stage 1 succeeds (which is most of the time on benign articles).
- **No transient retry in Stage 2/3.** Keeps cost bounded. Stage 1 already covers transient-error recovery.
- **No reference image in Stage 2/3.** The reference image amplifies Gemini refusals when it contains faces; once we've reached Stage 2 we want maximum permissiveness.
- **Source thumbnail fallback removed entirely.** Replaced by drop-to-review.
- **`image_attempts` includes a successful final entry** so the data shape is uniform — last entry's `reason: ok` marks success.
