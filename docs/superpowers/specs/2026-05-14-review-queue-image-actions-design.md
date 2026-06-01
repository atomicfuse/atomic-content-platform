# Review-Queue Image Actions — Design Spec

**Date:** 2026-05-14

**Goal:** Give reviewers in the dashboard review queue the ability to upload a replacement image or regenerate the article image (optionally with a custom subject), so that articles that arrived without a working image — or whose generated image needs a swap — can be rescued and published without leaving the queue.

---

## Problem

After the image-cascade redesign (sub-project #1), articles whose image generation fails at every cascade stage are routed to the review queue with `status: review`, no `featuredImage`, and a `quality_note` recording the failure. Today the review queue (`services/dashboard/src/app/review/ReviewQueueClient.tsx`) is approve/reject only. Reviewers have no way to attach an image — they can only approve (publishing an article with no hero) or reject (discarding fully-written content). The only out-of-band paths are direct git edits or the manual-import flow, both of which leave the review queue's normal contract.

The current limitation also blocks a useful secondary case: an article whose cascade succeeded but produced a low-quality image. Today there's no way to swap it from the review queue.

## Solution

Add two actions to every review-queue card:

1. **Upload Image** — a file picker that lets the reviewer upload a hero image directly. Uploaded to R2 (using the existing `uploadToR2` helper), then the article's frontmatter is patched in-place on the staging branch to set `featuredImage`.
2. **Regenerate Image** — re-run the image cascade for this article. A small text input next to the button lets the reviewer optionally provide a custom visual subject; when present, the cascade skips Stage 1 (raw prompt) and the sanitizer and uses the user-provided subject as the concept for Stage 2 (realism) then Stage 3 (illustration).

Both actions are synchronous server actions with clear in-card loading states. Neither auto-approves the article — the reviewer still clicks Approve to publish.

## Scope

**In scope:**
- Upload Image button on every review-queue card (file picker → R2 → patch frontmatter)
- Regenerate Image button + custom-subject text input on every review-queue card
- New dashboard API/server-action endpoints for upload and regenerate
- Cross-service call from dashboard → content-pipeline to invoke the cascade for a single article
- Extending `ReviewArticle` / `getReviewQueue` to surface `featuredImage`, `image_provider`, `image_stage`, `image_attempts`
- In-card image thumbnail preview (so reviewers see what they're replacing/regenerating)
- Loading states + per-card error display when an action fails
- Unit tests for the new server actions and the cascade-by-slug endpoint

**Out of scope:**
- Editing article title / body / tags / description (general content editor) — explicit Scope A boundary from brainstorming
- Backfilling existing review-queue articles with new metadata — forward-only after #1 ships
- Background-job / polling pattern for regenerate — synchronous for MVP; revisit if 3-minute server actions cause real UX pain
- A "regenerate as illustration" shortcut — explicitly cut during brainstorming
- Sanitizing user-provided subjects — pass through verbatim by design
- Showing the full `image_attempts` chain in the review-queue UI — out of scope here; the data lands in frontmatter via #1 and can be surfaced later

## Dependencies

This sub-project depends on **#1 (image cascade redesign)** for two reasons:
1. The Regenerate action needs `generateImageWithCascade` exposed callable per-article from a content-pipeline HTTP endpoint.
2. The frontmatter fields populated by #1 (`featuredImage`, `image_provider`, `image_stage`, `image_attempts`) are what the review queue surfaces so reviewers know what state each article is in.

Ship order is #1 first, then #2.

## UI design

Each review-queue card today shows: title, score badge, score breakdown, reviewer notes, preview link, GitHub link, Approve/Reject buttons.

This sub-project adds, in a new sub-section between the metadata and the Approve/Reject buttons:

```
┌───────────────────────────────────────────────────────┐
│  [Title]                              [Score]  [...]  │
│  Score breakdown bars                                 │
│  Reviewer notes                                       │
│  Preview link · GitHub link                           │
│                                                       │
│  ┌─Image─────────────────────────────────────┐        │
│  │ [thumbnail preview]    Provider: gemini   │        │
│  │ 160×90px               Stage: 2           │        │
│  │                                           │        │
│  │ [Upload…] [Describe subject (optional)…]  │        │
│  │           [Regenerate]                    │        │
│  └───────────────────────────────────────────┘        │
│                                                       │
│                          [Approve]  [Reject]          │
└───────────────────────────────────────────────────────┘
```

- **Thumbnail preview**: rendered from the article's `featuredImage` (resolved to its R2 URL). Placeholder graphic when none exists.
- **Provider / Stage metadata**: small text labels from frontmatter. Hidden when both are absent.
- **Upload button**: opens a native file picker. Accepted types match the existing manual-import flow (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). Max size matches the existing manual-import `MAX_IMG_SIZE` constant.
- **Custom-subject input**: ~40-char text field with placeholder `Describe the image (optional)`.
- **Regenerate button**: triggers the regenerate action with whatever subject is in the input (empty = no subject).
- **Loading state**: while an action runs, the whole sub-section dims and shows "Uploading…" or "Regenerating… this may take up to 3 minutes". Upload/Regenerate buttons disabled. Approve/Reject still enabled (the reviewer can still reject mid-regenerate if they want).
- **Error display**: a small inline error below the input on failure, dismissable. Shows the reason chain or the upload error.

## Upload flow

1. Reviewer clicks **Upload**, picks a file.
2. Browser sends a multipart POST to a new dashboard server action `uploadReviewImage({ domain, slug, file })`.
3. Server action validates MIME type and size (reusing the constants from `api/articles/upload/route.ts`).
4. Server uploads the file bytes to R2 at `<domain>/assets/images/<slug>.<ext>` via `uploadToR2`. Existing image (if any) is overwritten.
5. Server fetches the article's markdown from the staging branch (`readFileContent` in `lib/github.ts`), parses frontmatter, updates `featuredImage` to `/assets/images/<slug>.<ext>`, clears `image_provider` / `image_stage` / `image_attempts` (because the new image is human-supplied, not cascade-produced), serializes, and commits the file back to the staging branch via `commitSiteFiles`.
6. Server returns the new image URL. Client updates the card's thumbnail and metadata in place.

**Auth/permissions:** reuses the existing review-queue auth context — anyone who can approve/reject can also upload/regenerate. No new role.

## Regenerate flow

### Without a custom subject (input empty)

1. Reviewer clicks **Regenerate**.
2. Dashboard server action `regenerateReviewImage({ domain, slug })` is called.
3. Server fetches the article's markdown from staging, extracts `title`, `description`, `summary`, `tags`, and the source-item info needed to call the cascade.
4. Server makes an HTTP POST to a new content-pipeline endpoint `POST /image-regenerate` with the article context. (The pipeline already runs as an internal service at `http://content-pipeline-app`.)
5. The pipeline calls `generateImageWithCascade` exactly as it does today — full Stage 1 → Stage 2 → Stage 3.
6. Pipeline returns either `{ ok: true, data, provider, stage, attempts }` (image bytes + provenance) or `{ ok: false, attempts }`.
7. On success: dashboard uploads the bytes to R2, patches frontmatter (`featuredImage`, `image_provider`, `image_stage`, `image_attempts`), commits to staging.
8. On failure: **no frontmatter changes are persisted.** The card surfaces the latest failure reason inline (from the server-action response) so the reviewer can decide what to try next, but the article's `featuredImage` / `image_provider` / `image_stage` / `image_attempts` remain whatever they were before the regenerate attempt. Rationale: the persisted `image_attempts` should describe how the *current* `featuredImage` was produced, not include ephemeral failed retries. If the article currently has an image, that image and its provenance are preserved.

### With a custom subject (input has text)

Same as above, but the pipeline endpoint accepts an optional `customSubject` field. When present:

- Stage 1 is skipped entirely.
- The sanitizer is NOT called (the user-provided subject IS the concept).
- Stage 2 runs `buildStage2Prompt(customSubject, vertical, imageGuidelines)` → Gemini → OpenAI.
- If Stage 2 fails, Stage 3 runs `buildStage3Prompt(customSubject, ...)` → Gemini → OpenAI.
- On total failure, returns `{ ok: false }` with attempts limited to Stages 2 and 3.

This requires a new entry point in the content-pipeline image module (`generateImageWithCascade` accepts an optional `customSubject` parameter) — additive, doesn't change current behavior.

### What gets recorded in frontmatter on a successful regenerate

```yaml
featuredImage: /assets/images/<slug>.webp
image_provider: gemini       # or openai
image_stage: 2               # or 3
image_attempts:              # the chain from THIS regenerate run only — overwrites any prior chain
  - { stage: 2, provider: gemini, reason: "ok" }
```

(See spec #1 for the canonical shape.)

## Backend endpoints

### New: dashboard server actions

- `uploadReviewImage({ domain, slug, file })` — handles file upload + R2 + frontmatter patch + commit. Returns `{ ok: true, url } | { ok: false, error }`.
- `regenerateReviewImage({ domain, slug, customSubject? })` — orchestrates the call to content-pipeline + R2 + frontmatter patch + commit. Returns `{ ok: true, url, provider, stage } | { ok: false, error, attempts }`.

Both server actions:
- Validate `domain` against the dashboard index (reject unknown).
- Use the article's staging branch (resolved from the dashboard index, same as `getReviewQueue` does today).
- Invalidate the review-queue cache via `revalidatePath` after a successful patch so the next render picks up the change.

### New: content-pipeline HTTP endpoint

- `POST /image-regenerate`
  - Body: `{ articleTitle, articleDescription, articleSummary, vertical, sourceThumbnailUrl?, imageGuidelines?, customSubject? }`
  - Calls `generateImageWithCascade(input, notifications, siteDomain)`. When `customSubject` is present, the cascade entry point skips Stage 1 + sanitizer and uses the provided subject directly.
  - Response (success): `{ ok: true, imageBase64: string, provider: "gemini" | "openai", stage: 1|2|3, attempts: ImageCascadeAttemptLog[] }`
  - Response (failure): `{ ok: false, attempts: ImageCascadeAttemptLog[] }`
  - Returns image bytes inline as base64 so the dashboard can upload to R2 in one round trip. Image is small (post-optimization), so this is fine.

The endpoint lives in the content-pipeline service alongside the existing `/content-generate` and `/scheduled-publish` routes. Auth: same internal-only access as the existing routes (cluster DNS, no public path).

## Data flow

```
Dashboard (review-queue card)
   │
   ├─[Upload]──────────► uploadReviewImage(server action)
   │                          │
   │                          ├──► uploadToR2 (R2 bucket)
   │                          │
   │                          ├──► readFileContent + patch frontmatter (GitHub Git Data API)
   │                          │
   │                          ├──► commitSiteFiles (staging branch)
   │                          │
   │                          └──► revalidatePath('/review')
   │
   └─[Regenerate]──────► regenerateReviewImage(server action)
                              │
                              ├──► POST /image-regenerate (content-pipeline, internal)
                              │      │
                              │      └──► generateImageWithCascade (with or without customSubject)
                              │
                              ├──► uploadToR2 (R2 bucket)
                              │
                              ├──► readFileContent + patch frontmatter
                              │
                              ├──► commitSiteFiles (staging branch)
                              │
                              └──► revalidatePath('/review')
```

## Error handling

- **Upload size/MIME error** → server action returns `{ ok: false, error: "Unsupported image type" }` → card shows inline error.
- **R2 upload error** → returns `{ ok: false, error: "Storage error: <detail>" }` → card shows inline error, frontmatter NOT patched.
- **GitHub commit error** → returns `{ ok: false, error: "Commit failed: <detail>" }` → card shows inline error. If R2 already received the file, leave it (orphan blob — cheap, no harm).
- **Cascade failure** (Regenerate) → returns `{ ok: false, error: "Image generation failed", attempts }` → card surfaces the last reason inline; frontmatter is NOT changed (see Regenerate flow above for rationale).
- **Content-pipeline unreachable** → server action returns `{ ok: false, error: "Image service unavailable" }`.
- **Concurrent action on same article** → a per-card "in flight" lock in the client prevents double-clicks; on the server, the GitHub commit will fail if the SHA has changed mid-flight (existing optimistic-locking pattern in `commitSiteFiles`), which surfaces as a normal error.

## Files touched

```
services/dashboard/src/app/review/
  ReviewQueueClient.tsx          — add Image sub-section per card, wire Upload + Regenerate, loading/error states
  ReviewImageCard.tsx (NEW)      — extract image sub-section as its own component for clarity

services/dashboard/src/actions/
  review-image.ts (NEW)          — uploadReviewImage + regenerateReviewImage server actions

services/dashboard/src/actions/review.ts
                                — extend ReviewArticle to include featuredImage / image_provider / image_stage / image_attempts;
                                  update getReviewQueue to parse those from frontmatter

services/dashboard/src/types/dashboard.ts
                                — extend ArticleEntry with the same fields

services/dashboard/src/lib/article-upload.ts (existing)
                                — refactor/expose helpers reused by review-image.ts (image MIME validation, R2 key formation)
                                  ONLY if needed; the existing api/articles/upload/route.ts already has these inlined and we
                                  should extract them into article-upload.ts cleanly

services/content-pipeline/src/agents/content-generation/index.ts (or wherever HTTP routes are wired)
                                — add POST /image-regenerate route

services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts
                                — extend generateImageWithCascade signature with optional { customSubject?: string }
                                  on the input; when present, skip Stage 1 + sanitizer

services/dashboard/src/__tests__/ (new tests)
  review-image.test.ts (NEW)     — server actions: happy path, validation errors, GitHub failures

services/content-pipeline/src/__tests__/
  image-cascade.test.ts (existing) — add tests for customSubject path
```

R2 paths, GitHub commit patterns, and approve/reject flow are untouched.

## Testing strategy

**New unit tests — server actions (`review-image.test.ts`):**
- `uploadReviewImage` happy path: valid file → R2 upload mocked OK → frontmatter patched with `featuredImage` set, image_provider/stage/attempts cleared → commit OK
- `uploadReviewImage` invalid MIME → returns error, no R2 call
- `uploadReviewImage` oversize → returns error, no R2 call
- `uploadReviewImage` GitHub commit fails → returns error
- `regenerateReviewImage` empty subject → pipeline POST has no `customSubject` field
- `regenerateReviewImage` with subject → pipeline POST includes `customSubject`
- `regenerateReviewImage` pipeline success → R2 upload + frontmatter patch with new provider/stage/attempts
- `regenerateReviewImage` pipeline failure → frontmatter patched with new `image_attempts`, `featuredImage` left unset, server action returns error
- `regenerateReviewImage` pipeline unreachable → returns service-unavailable error

**Updated tests — cascade `customSubject` path (`image-cascade.test.ts`):**
- `customSubject` present → Stage 1 NOT called → sanitizer NOT called → Stage 2 Gemini called with prompt containing the custom subject
- `customSubject` present + Stage 2 fails → Stage 3 called with the same custom subject
- `customSubject` empty/undefined → existing cascade behavior unchanged

**New content-pipeline integration test:**
- `POST /image-regenerate` returns base64 + provider + stage on success
- `POST /image-regenerate` returns `{ ok: false, attempts }` on cascade failure
- `POST /image-regenerate` honors `customSubject` field

**Manual / smoke testing (documented in plan):**
- Visit `/review` with a real failed-image article → Upload Image → article gets a new image → Approve → published.
- Same article → Regenerate (empty) → real cascade runs → success or failure visible.
- Same article → Regenerate with subject "data center with blue lighting" → Stage 2 runs that subject → image appears.

## Decisions made

- **Buttons on every card, not only image-failed ones.** Allows reviewers to swap any image, not just failed ones.
- **Custom subject passes through verbatim — no sanitizer.** User typed it, user owns it; auto-sanitizing creates surprises.
- **Custom subject runs Stage 2 then Stage 3 — no Stage 1.** Stage 1's value is the article-title-derived prompt; once the user supplies a subject, Stage 1 is meaningless.
- **Successful regenerate does NOT auto-approve.** Keeps the review-queue contract clean: every article needs explicit human approval.
- **`image_attempts` overwrites on regenerate success; is unchanged on regenerate failure.** Frontmatter describes how the *current* `featuredImage` was produced — failed retry attempts are surfaced inline but not persisted.
- **Synchronous server action with in-card loading state.** Background-job + polling rejected for MVP.
- **Custom subject sent over the wire as a single string field**, not as a structured object. Simplifies the pipeline API.
- **Auth reuses review-queue auth.** No new role/permission gate.
