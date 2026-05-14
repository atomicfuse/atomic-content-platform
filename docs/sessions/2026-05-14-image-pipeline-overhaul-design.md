# Session: Image-pipeline overhaul — design + plan (no code yet)

**Date:** 2026-05-14
**Type:** Planning only — no implementation
**Duration:** single session
**Jira:** None

## What happened

User asked why many generated articles fall back to the source article's original thumbnail instead of an AI-generated image. We investigated the current three-tier image ladder in `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`, identified the structural reasons (safety-policy refusals on real names / brands / negative framing, plus a latent bug where Gemini's `no_image_in_response` is treated non-retriable and short-circuits the "2 attempts" intent), and confirmed there is no persistent diagnostic record — frontmatter only stores `featuredImage`, no provenance.

We then designed a replacement: a three-stage cascade with a sanitization step, no thumbnail fallback, and frontmatter provenance. Through brainstorming we considered (and rejected) Chinese image models (legal risk on real-people photography is the real blocker, not refusal rates), a sensitivity-pre-detector (unnecessary complexity), and an auto-illustration-only baseline (loses realism on benign articles). We landed on: try realism with raw prompt first, then realism with a sanitized concept, then illustration with the same sanitized concept, then route the article to the review queue with no `featuredImage`. The thumbnail fallback is removed entirely.

That motivated a second sub-project: the review queue today is approve/reject only, so dropped-to-review articles can't be rescued. Scope A (image-only actions: Upload + Regenerate with optional custom subject) was selected and designed.

Both designs were written up as specs, then implementation plans, all committed to git on this branch. No code has been written yet. The user wants to kick off execution in a follow-up session.

## Key outcomes

- **Spec #1 (image cascade redesign)** committed at `docs/superpowers/specs/2026-05-14-image-cascade-redesign-design.md`.
- **Plan #1 (image cascade redesign)** committed at `docs/superpowers/plans/2026-05-14-image-cascade-redesign.md` — 9 tasks, TDD per step, target branch `feat/image-cascade-redesign`.
- **Spec #2 (review-queue image actions)** committed at `docs/superpowers/specs/2026-05-14-review-queue-image-actions-design.md`.
- **Plan #2 (review-queue image actions)** committed at `docs/superpowers/plans/2026-05-14-review-queue-image-actions.md` — 9 tasks, TDD per step, target branch `feat/review-queue-image-actions`, **depends on #1 being merged first**.
- No code changes in this session.

## Decisions made

- **Three-stage cascade replaces the three-tier ladder.** Stage 1 (realism, raw prompt, Gemini ×2 with transient retry → OpenAI ×1 with transient retry) → Stage 2 (realism, sanitized concept, Gemini ×1 → OpenAI ×1) → Stage 3 (illustration, same sanitized concept, Gemini ×1 → OpenAI ×1) → drop to review queue. The source-thumbnail fallback is removed entirely.
- **Stage 1 OpenAI gains transient retry** (bug fix — current code gives OpenAI 1 attempt with no retry, even on 429/5xx).
- **Prompt sanitizer is a Claude call via the existing CloudGrid AI Gateway**, lazy (only after Stage 1 fails) and cached (Stage 3 reuses Stage 2's concept — never two sanitizer calls).
- **Frontmatter gains three new optional fields** — `image_provider`, `image_stage`, `image_attempts`. `image_attempts` is the persistent diagnostic record that survives redeploys (replaces the current observability gap where stdout logs are wiped on every cloudgrid deploy).
- **No pre-flight "is this sensitive?" detection.** The cascade does the work lazily.
- **No Chinese / FLUX / Qwen image providers.** Legal risk (right-of-publicity, defamation on real-people photography) lands on the publisher regardless of model permissiveness — providers' refusals aren't safety theatre.
- **On total cascade failure → article goes to review queue** with `status: review`, no `featuredImage`, `image_attempts` populated, and a new `notifyImageDroppedToReview` Slack/Telegram alert.
- **Sub-project #2 scope is image-only (Scope A)** — no body/title editor in the review queue.
- **Upload Image + Regenerate Image buttons render on every review-queue card**, not only image-failed ones.
- **Custom subject passes through verbatim.** No auto-sanitization of user input — user owns what they typed.
- **Custom subject skips Stage 1 + sanitizer entirely** and runs Stage 2 (realism) then Stage 3 (illustration) with the subject as the concept.
- **Successful regenerate does NOT auto-approve.** Reviewer still clicks Approve.
- **Regenerate failure does NOT mutate frontmatter** — `image_attempts` describes how the current `featuredImage` was produced, not ephemeral failed retries.
- **Synchronous server actions, in-card loading state.** Background-job + polling rejected for MVP.

## Files created this session

```
docs/superpowers/specs/2026-05-14-image-cascade-redesign-design.md
docs/superpowers/specs/2026-05-14-review-queue-image-actions-design.md
docs/superpowers/plans/2026-05-14-image-cascade-redesign.md
docs/superpowers/plans/2026-05-14-review-queue-image-actions.md
docs/sessions/2026-05-14-image-pipeline-overhaul-design.md   (this file)
```

## Next steps for a future session

1. **Kick off execution of Plan #1 (image cascade redesign)** via subagent-driven development. Branch `feat/image-cascade-redesign`. 9 tasks; commits per task. The plan is self-contained — a fresh subagent per task with the plan as the only context should work.
2. **Merge #1 to main**, observe real generation runs for a few days, gather data on which stages succeed (the new `image_attempts` field gives this for free).
3. **Kick off execution of Plan #2 (review-queue image actions)** via subagent-driven development. Branch `feat/review-queue-image-actions`. 9 tasks. The pre-flight step verifies #1 is merged — do not start before then.
4. (Optional, future scope) **Add a dashboard analytics view** for `image_attempts` so cascade failures can be reviewed in aggregate. Out of scope for #1 and #2 — surface the data, view it as a follow-up.

## Open questions / things not decided

- **Vertical lookup in regenerate flow** is currently defaulted to `"General"` in Plan #2 Task 6, because the article frontmatter doesn't carry the source vertical. If we want vertical-aware regeneration later, surface it from the site config in `getReviewQueue` and pass it through. Cheap to add later.
- **Backfilling existing review-queue articles** with the new metadata fields is explicitly out of scope. Only forward-generated articles get the new fields.
- **Whether to add an `image_source: "uploaded"` marker** on human-uploaded images (currently we just clear `image_provider`/`image_stage`/`image_attempts`). Not needed for MVP — "no provider + featuredImage set" implies upload — but could be added later for clarity.

## Learning notes

**Observability gap drove half the design.** The original "why are images failing?" question couldn't be answered from current state — cloudgrid logs only retain since last deploy, Slack/Telegram notifications are transient, and frontmatter has no provenance. The biggest single deliverable of Plan #1 is arguably not the cascade itself but `image_attempts` in frontmatter — once it lands, we can grep the network repo and answer the original question for every future article.

**Brainstorming caught a real architectural bug for free.** While designing Stage 1, we noticed the current code marks `no_image_in_response` non-retriable and `break`s the Gemini loop (`generator.ts:228`), so the documented "2 attempts" is effectively 1 for the most common failure mode. Plan #1 preserves the non-retriable-on-permanent semantics but adds a *different* second attempt (Stage 2 with a sanitized concept) — which is what the original two-retry intent should have been all along.
