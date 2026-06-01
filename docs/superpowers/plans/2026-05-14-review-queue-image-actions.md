# Review-Queue Image Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Upload Image and Regenerate Image (with optional custom subject) actions to every review-queue card in the dashboard, plus the cross-service backend needed to invoke the cascade per article.

**Architecture:** Two new dashboard server actions (`uploadReviewImage`, `regenerateReviewImage`) live in `services/dashboard/src/actions/review-image.ts`. Upload runs entirely in the dashboard (R2 + GitHub commit). Regenerate calls a new internal HTTP endpoint `POST /image-regenerate` on the content-pipeline, which delegates to `generateImageWithCascade` — extended with an optional `customSubject` parameter that skips Stage 1 and the sanitizer. A new `ReviewImageCard` React component renders the per-card UI.

**Tech Stack:** TypeScript, Next.js 15 App Router server actions, vitest, raw Node http module on the pipeline side, existing R2 + GitHub helpers.

**Reference spec:** `docs/superpowers/specs/2026-05-14-review-queue-image-actions-design.md`

**Dependency:** Sub-project #1 (image cascade redesign) must be merged to main BEFORE starting this plan. The `image_provider`/`image_stage`/`image_attempts` frontmatter fields, the cascade signature, and the `notifyImageDroppedToReview` helper all come from #1.

---

## Pre-flight

- [ ] **Step 1: Verify sub-project #1 is merged**

Run from `/Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform`:
```bash
git checkout main
git pull
git log --oneline | grep -i "image-cascade\|generateImageWithCascade" | head
```
Expected: at least one commit from #1 (e.g., `feat(agent): wire image cascade...`) is visible. If empty, STOP — sub-project #1 has not landed yet and this plan cannot proceed.

- [ ] **Step 2: Create the feature branch**

Run:
```bash
git checkout -b feat/review-queue-image-actions
git status
```
Expected: on branch `feat/review-queue-image-actions`, working tree clean.

- [ ] **Step 3: Confirm baseline tests pass**

Run:
```bash
cd services/content-pipeline && pnpm test
cd ../dashboard && pnpm test 2>/dev/null || echo "(no test script in dashboard — that's fine)"
```
Expected: content-pipeline tests pass. Dashboard may or may not have a test script — if it does, those should pass too.

---

## Task 1: Surface image metadata in the review queue

**Files:**
- Modify: `services/dashboard/src/types/dashboard.ts`
- Modify: `services/dashboard/src/actions/review.ts`

- [ ] **Step 1: Extend `ArticleEntry` type**

In `services/dashboard/src/types/dashboard.ts`, find the `ArticleEntry` interface (around line 70) and add three optional fields after `reviewerNotes?:`:

```typescript
export interface ArticleEntry {
  slug: string;
  title: string;
  type: string;
  status: string;
  publishDate: string;
  score?: number;
  scoreBreakdown?: {
    seo_quality: number;
    tone_match: number;
    content_length: number;
    factual_accuracy: number;
    keyword_relevance: number;
  };
  qualityNote?: string;
  reviewerNotes?: string;
  /** Path or URL of the hero image, e.g. "/assets/images/<slug>.webp". */
  featuredImage?: string;
  /** Image provider that produced the current featuredImage (from the cascade). */
  image_provider?: "gemini" | "openai";
  /** Cascade stage that produced the current featuredImage (1=raw realism, 2=sanitized realism, 3=illustration). */
  image_stage?: 1 | 2 | 3;
  /** Full chain of image-generation attempts that led to the current state. */
  image_attempts?: Array<{ stage: 1 | 2 | 3; provider: "gemini" | "openai" | "sanitizer"; reason: string }>;
}
```

- [ ] **Step 2: Update `getReviewQueue` to read those fields from frontmatter**

In `services/dashboard/src/actions/review.ts`, find the `readArticles` consumer loop in `getReviewQueue` (around line 45). The current loop spreads `...article` from whatever `readArticles` returns. Open `services/dashboard/src/lib/github.ts` and find `readArticles` to see what shape it returns. If it already returns the raw frontmatter (`featuredImage`, `image_provider`, `image_stage`, `image_attempts` come through automatically), no code change is needed — the type widening in Step 1 is enough.

Run a quick verification:
```bash
grep -n "function readArticles\|export async function readArticles" services/dashboard/src/lib/github.ts | head -3
```
Inspect the implementation. If `readArticles` returns a typed `ArticleEntry[]` and explicitly maps fields, add the four new fields to that mapping. If it returns the raw parsed frontmatter, this step is a no-op.

If a mapping change is needed, the addition will look like:
```typescript
return {
  slug: fm.slug,
  title: fm.title,
  // ... existing fields ...
  featuredImage: fm.featuredImage,
  image_provider: fm.image_provider,
  image_stage: fm.image_stage,
  image_attempts: fm.image_attempts,
};
```

- [ ] **Step 3: Typecheck the dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: no errors. If there are errors in unrelated files, leave them — but errors in `review.ts` or `dashboard.ts` need to be fixed here.

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/types/dashboard.ts services/dashboard/src/actions/review.ts services/dashboard/src/lib/github.ts
git commit -m "feat(review-queue): surface image_provider, image_stage, image_attempts in ReviewArticle"
```

(Include `github.ts` in the commit only if Step 2 required edits there.)

---

## Task 2: Extend the cascade with `customSubject`

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`
- Modify: `services/content-pipeline/src/__tests__/image-cascade.test.ts`

- [ ] **Step 1: Write failing tests for `customSubject`**

Append to `services/content-pipeline/src/__tests__/image-cascade.test.ts`:

```typescript
describe("generateImageWithCascade — customSubject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
  });

  it("customSubject skips Stage 1 entirely AND does not call the sanitizer", async () => {
    mockGemini.mockResolvedValueOnce(ok("custom-stage2-image"));

    const result = await generateImageWithCascade({ ...INPUT, customSubject: "data center with blue lighting" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(2);
      expect(result.result.provider).toBe("gemini");
      expect(result.result.prompt).toContain("data center with blue lighting");
    }
    expect(mockSanitize).not.toHaveBeenCalled();
    // Only Stage 2 Gemini called — Stage 1 skipped
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("customSubject + Stage 2 fail → Stage 3 runs with the same subject", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response")) // Stage 2 Gemini
      .mockResolvedValueOnce(ok("custom-stage3-image"));          // Stage 3 Gemini
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400")); // Stage 2 OpenAI

    const result = await generateImageWithCascade({ ...INPUT, customSubject: "data center" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(3);
      expect(result.result.prompt.toLowerCase()).toContain("illustration");
      expect(result.result.prompt).toContain("data center");
    }
    expect(mockSanitize).not.toHaveBeenCalled();
  });

  it("customSubject + all stages fail → ok:false with attempts only from Stages 2 and 3", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400"))
      .mockResolvedValueOnce(fail(false, "client_error:400"));

    const result = await generateImageWithCascade({ ...INPUT, customSubject: "anything" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts.map((a) => a.stage)).toEqual([2, 2, 3, 3]);
      // No Stage 1 attempts in the chain
      expect(result.attempts.find((a) => a.stage === 1)).toBeUndefined();
    }
    expect(mockSanitize).not.toHaveBeenCalled();
  });

  it("customSubject undefined → existing cascade behavior unchanged (calls Stage 1)", async () => {
    mockGemini.mockResolvedValueOnce(ok("normal-cascade"));

    const result = await generateImageWithCascade(INPUT); // no customSubject

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(1);
    }
    expect(mockSanitize).not.toHaveBeenCalled(); // Stage 1 succeeded → sanitizer never needed
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: existing cascade tests pass; new `customSubject` tests fail because `customSubject` is not yet accepted on the input.

- [ ] **Step 3: Extend `ImageGenInput` and the cascade entry**

In `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`, find the `ImageGenInput` interface and add the optional field:

```typescript
export interface ImageGenInput {
  articleTitle: string;
  articleDescription: string;
  articleSummary: string;
  vertical: string;
  /** Source article thumbnail URL (if available). Used as reference for Stage 1 Gemini only. */
  sourceThumbnailUrl?: string;
  /** Image generation guidelines from site brief. */
  imageGuidelines?: string | string[];
  /** Optional user-provided subject. When present, Stage 1 and the sanitizer are skipped; this string is used as the concept for Stage 2 and Stage 3. */
  customSubject?: string;
}
```

Then in the `generateImageWithCascade` function body, immediately after the local `const ctx: StageContext = { ... };` line and BEFORE the `// ── Stage 1` comment, insert a fast-path:

```typescript
  // Fast path: user-provided subject. Skip Stage 1 and the sanitizer; run Stage 2 (realism) then Stage 3 (illustration) using the subject directly.
  if (input.customSubject && input.customSubject.trim().length > 0) {
    const subject = input.customSubject.trim();

    const stage2Prompt = buildStage2Prompt(subject, input.vertical, input.imageGuidelines);
    console.log(`[img-gen] (customSubject) Stage 2: Gemini for "${input.articleTitle}"`);
    const stage2Gemini = await runProvider(ctx, 2, "gemini", stage2Prompt, undefined, 1, geminiKey);
    if (stage2Gemini) {
      const optimized = await optimizeImage(stage2Gemini);
      return {
        ok: true,
        result: { data: optimized, altText: generateAltText(input), prompt: stage2Prompt, provider: "gemini", stage: 2 },
        attempts,
      };
    }
    console.log(`[img-gen] (customSubject) Stage 2: OpenAI for "${input.articleTitle}"`);
    const stage2OpenAI = await runProvider(ctx, 2, "openai", stage2Prompt, undefined, 1, openaiKey);
    if (stage2OpenAI) {
      const optimized = await optimizeImage(stage2OpenAI);
      return {
        ok: true,
        result: { data: optimized, altText: generateAltText(input), prompt: stage2Prompt, provider: "openai", stage: 2 },
        attempts,
      };
    }

    const stage3Prompt = buildStage3Prompt(subject, input.vertical, input.imageGuidelines);
    console.log(`[img-gen] (customSubject) Stage 3: Gemini for "${input.articleTitle}"`);
    const stage3Gemini = await runProvider(ctx, 3, "gemini", stage3Prompt, undefined, 1, geminiKey);
    if (stage3Gemini) {
      const optimized = await optimizeImage(stage3Gemini);
      return {
        ok: true,
        result: { data: optimized, altText: generateAltText(input), prompt: stage3Prompt, provider: "gemini", stage: 3 },
        attempts,
      };
    }
    console.log(`[img-gen] (customSubject) Stage 3: OpenAI for "${input.articleTitle}"`);
    const stage3OpenAI = await runProvider(ctx, 3, "openai", stage3Prompt, undefined, 1, openaiKey);
    if (stage3OpenAI) {
      const optimized = await optimizeImage(stage3OpenAI);
      return {
        ok: true,
        result: { data: optimized, altText: generateAltText(input), prompt: stage3Prompt, provider: "openai", stage: 3 },
        attempts,
      };
    }

    return { ok: false, reason: "image_gen_exhausted", attempts };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: all cascade tests pass — pre-existing + the four `customSubject` tests.

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts services/content-pipeline/src/__tests__/image-cascade.test.ts
git commit -m "feat(image-pipeline): add customSubject fast-path to cascade"
```

---

## Task 3: Add `POST /image-regenerate` endpoint

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/image-regenerate-handler.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`
- Create: `services/content-pipeline/src/__tests__/image-regenerate-handler.test.ts`

- [ ] **Step 1: Write failing tests for the handler**

Create `services/content-pipeline/src/__tests__/image-regenerate-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImageCascadeResult } from "../agents/content-generation/image-pipeline/types.js";

const mockCascade = vi.fn<(...args: unknown[]) => Promise<ImageCascadeResult>>();

vi.mock("../agents/content-generation/image-pipeline/generator.js", () => ({
  generateImageWithCascade: (...args: unknown[]): Promise<ImageCascadeResult> => mockCascade(...args),
}));

import { handleImageRegenerate } from "../agents/content-generation/image-regenerate-handler.js";

const REQ = {
  articleTitle: "Test",
  articleDescription: "Desc",
  articleSummary: "Summary",
  vertical: "Tech",
};

describe("handleImageRegenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base64 image + provider + stage on cascade success", async () => {
    mockCascade.mockResolvedValueOnce({
      ok: true,
      result: {
        data: Buffer.from("img-bytes"),
        altText: "alt",
        prompt: "p",
        provider: "gemini",
        stage: 1,
      },
      attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
    });

    const result = await handleImageRegenerate(REQ);

    expect(result).toEqual({
      ok: true,
      imageBase64: Buffer.from("img-bytes").toString("base64"),
      provider: "gemini",
      stage: 1,
      attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
    });
  });

  it("returns ok:false with attempts on cascade failure", async () => {
    mockCascade.mockResolvedValueOnce({
      ok: false,
      reason: "image_gen_exhausted",
      attempts: [
        { stage: 1, provider: "gemini", reason: "no_image_in_response" },
        { stage: 1, provider: "openai", reason: "client_error:400" },
      ],
    });

    const result = await handleImageRegenerate(REQ);

    expect(result).toEqual({
      ok: false,
      attempts: [
        { stage: 1, provider: "gemini", reason: "no_image_in_response" },
        { stage: 1, provider: "openai", reason: "client_error:400" },
      ],
    });
  });

  it("forwards customSubject to the cascade when provided", async () => {
    mockCascade.mockResolvedValueOnce({
      ok: true,
      result: { data: Buffer.from("x"), altText: "a", prompt: "p", provider: "gemini", stage: 2 },
      attempts: [{ stage: 2, provider: "gemini", reason: "ok" }],
    });

    await handleImageRegenerate({ ...REQ, customSubject: "data center" });

    expect(mockCascade).toHaveBeenCalledWith(
      expect.objectContaining({ customSubject: "data center" }),
      undefined,
      undefined,
    );
  });

  it("does NOT include customSubject in the cascade call when absent", async () => {
    mockCascade.mockResolvedValueOnce({
      ok: true,
      result: { data: Buffer.from("x"), altText: "a", prompt: "p", provider: "gemini", stage: 1 },
      attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
    });

    await handleImageRegenerate(REQ);

    const call = mockCascade.mock.calls[0];
    expect(call).toBeDefined();
    const input = call![0] as Record<string, unknown>;
    expect(input.customSubject).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-regenerate-handler
```
Expected: FAIL with "Cannot find module" (handler does not exist yet).

- [ ] **Step 3: Implement the handler**

Create `services/content-pipeline/src/agents/content-generation/image-regenerate-handler.ts`:

```typescript
/**
 * Handler for POST /image-regenerate. Pure function — no HTTP coupling here
 * so it's directly unit-testable. The route wiring in index.ts is a thin
 * adapter that parses the JSON body and calls this.
 */

import { generateImageWithCascade } from "./image-pipeline/generator.js";
import type { ImageCascadeAttemptLog } from "./image-pipeline/types.js";

export interface ImageRegenerateRequest {
  articleTitle: string;
  articleDescription: string;
  articleSummary: string;
  vertical: string;
  sourceThumbnailUrl?: string;
  imageGuidelines?: string | string[];
  customSubject?: string;
}

export type ImageRegenerateResponse =
  | {
      ok: true;
      imageBase64: string;
      provider: "gemini" | "openai";
      stage: 1 | 2 | 3;
      attempts: ImageCascadeAttemptLog[];
    }
  | {
      ok: false;
      attempts: ImageCascadeAttemptLog[];
    };

export async function handleImageRegenerate(
  req: ImageRegenerateRequest,
): Promise<ImageRegenerateResponse> {
  const result = await generateImageWithCascade({
    articleTitle: req.articleTitle,
    articleDescription: req.articleDescription,
    articleSummary: req.articleSummary,
    vertical: req.vertical,
    sourceThumbnailUrl: req.sourceThumbnailUrl,
    imageGuidelines: req.imageGuidelines,
    ...(req.customSubject ? { customSubject: req.customSubject } : {}),
  });

  if (result.ok) {
    return {
      ok: true,
      imageBase64: result.result.data.toString("base64"),
      provider: result.result.provider,
      stage: result.result.stage,
      attempts: result.attempts,
    };
  }
  return { ok: false, attempts: result.attempts };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-regenerate-handler
```
Expected: all 4 handler tests pass.

- [ ] **Step 5: Wire the HTTP route**

In `services/content-pipeline/src/agents/content-generation/index.ts`, find the `handleRequest` function. After the `/scheduled-publish` block (around line 65) and BEFORE the `/scheduler/active-run` block, insert:

```typescript
  // Image regenerate — called by dashboard's regenerateReviewImage server action
  if (req.method === "POST" && req.url === "/image-regenerate") {
    try {
      const body = await readJsonBody(req);
      const { handleImageRegenerate } = await import("./image-regenerate-handler.js");
      const result = await handleImageRegenerate(body as Parameters<typeof handleImageRegenerate>[0]);
      sendJson(res, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /image-regenerate error:", message);
      sendJson(res, 500, { ok: false, error: message });
    }
    return;
  }
```

Check whether `readJsonBody` already exists in `index.ts`. Run:
```bash
grep -n "readJsonBody\|function.*req.*Promise" services/content-pipeline/src/agents/content-generation/index.ts | head
```
If it exists, use it. If it does NOT exist, add this helper near the top of the file (after imports):

```typescript
async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
```

(Skip adding it if it already exists.)

- [ ] **Step 6: Typecheck**

Run:
```bash
cd services/content-pipeline && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-regenerate-handler.ts services/content-pipeline/src/agents/content-generation/index.ts services/content-pipeline/src/__tests__/image-regenerate-handler.test.ts
git commit -m "feat(content-pipeline): add POST /image-regenerate endpoint"
```

---

## Task 4: Extract image-upload constants for reuse

**Files:**
- Modify: `services/dashboard/src/lib/article-upload.ts`
- Modify: `services/dashboard/src/app/api/articles/upload/route.ts`

- [ ] **Step 1: Move `IMAGE_TYPES` and `MAX_IMG_SIZE` into `article-upload.ts`**

In `services/dashboard/src/lib/article-upload.ts`, after the existing exports, append:

```typescript
/** Allowed image MIME types and their canonical file extensions. */
export const IMAGE_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Maximum allowed image upload size (10 MB). */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** Validate an uploaded image file. Returns { ok: true, ext } or { ok: false, error }. */
export function validateImageUpload(file: { type: string; size: number }): { ok: true; ext: string } | { ok: false; error: string } {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { ok: false, error: `Image too large (max ${Math.round(MAX_IMAGE_SIZE_BYTES / 1024 / 1024)} MB)` };
  }
  const ext = IMAGE_MIME_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      error: `Unsupported image type: ${file.type}. Allowed: ${Object.keys(IMAGE_MIME_TYPES).join(", ")}`,
    };
  }
  return { ok: true, ext };
}
```

- [ ] **Step 2: Replace the inline constants in the existing upload route**

In `services/dashboard/src/app/api/articles/upload/route.ts`, find the local `IMAGE_TYPES` and `MAX_IMG_SIZE` (around lines 15 and 23) and remove them. Replace the import line that pulls helpers from `@/lib/article-upload` so it also imports the new exports:

Before:
```typescript
import {
  // existing helpers
} from "@/lib/article-upload";
```

After (preserve any existing helpers being imported):
```typescript
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  validateImageUpload,
  // ...existing helpers...
} from "@/lib/article-upload";
```

Then replace the inline file-validation logic in the handler. Find the block:
```typescript
if (imageFile.size > MAX_IMG_SIZE) {
  // ...returns error
}
const ext = IMAGE_TYPES[imageFile.type];
if (!ext) {
  // ...returns error
}
```

Replace with:
```typescript
const validation = validateImageUpload(imageFile);
if (!validation.ok) {
  return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
}
const ext = validation.ext;
```

(Adjust the return shape to match the existing handler's response style — if the existing handler uses `NextResponse.json` with a different status code or wrapper, match that.)

- [ ] **Step 3: Typecheck the dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Run the dashboard test suite if it exists**

Run:
```bash
cd services/dashboard && pnpm test 2>/dev/null || echo "(no test script — skipping)"
```
Expected: pass or "no test script."

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/article-upload.ts services/dashboard/src/app/api/articles/upload/route.ts
git commit -m "refactor(dashboard): extract image upload validation into article-upload.ts"
```

---

## Task 5: `uploadReviewImage` server action

**Files:**
- Create: `services/dashboard/src/actions/review-image.ts`
- Create: `services/dashboard/src/__tests__/review-image.test.ts`

- [ ] **Step 1: Write failing tests**

Create `services/dashboard/src/__tests__/review-image.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFileContent = vi.fn();
const mockCommitSiteFiles = vi.fn();
const mockUploadToR2 = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("@/lib/github", () => ({
  readFileContent: (...args: unknown[]) => mockReadFileContent(...args),
  commitSiteFiles: (...args: unknown[]) => mockCommitSiteFiles(...args),
}));

vi.mock("@/lib/r2-upload", () => ({
  uploadToR2: (...args: unknown[]) => mockUploadToR2(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { uploadReviewImage } from "@/actions/review-image";

const SAMPLE_MD = `---
title: Test
slug: test-slug
status: review
---

Body here.
`;

function makeFile(opts: { type: string; size?: number; bytes?: string }): { type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } {
  const bytes = opts.bytes ?? "fake-image-content";
  const buf = Buffer.from(bytes);
  return {
    type: opts.type,
    size: opts.size ?? buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

describe("uploadReviewImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileContent.mockResolvedValue(SAMPLE_MD);
    mockCommitSiteFiles.mockResolvedValue(undefined);
    mockUploadToR2.mockResolvedValue(true);
  });

  it("happy path: uploads to R2, patches frontmatter, commits, revalidates", async () => {
    const file = makeFile({ type: "image/png" });

    const result = await uploadReviewImage({
      domain: "example.com",
      slug: "test-slug",
      branch: "staging/example.com",
      file: file as unknown as File,
    });

    expect(result).toEqual({ ok: true, url: "/assets/images/test-slug.png" });
    expect(mockUploadToR2).toHaveBeenCalledWith(
      "example.com/assets/images/test-slug.png",
      expect.any(Buffer),
      "image/png",
    );
    expect(mockCommitSiteFiles).toHaveBeenCalledTimes(1);
    const [, files, , branch] = mockCommitSiteFiles.mock.calls[0]!;
    expect(branch).toBe("staging/example.com");
    expect((files as Array<{ path: string; content: string }>)[0]!.content).toContain("featuredImage: /assets/images/test-slug.png");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/review");
  });

  it("clears image_provider/image_stage/image_attempts when uploaded image replaces cascade-generated one", async () => {
    mockReadFileContent.mockResolvedValueOnce(
      `---
title: Test
slug: test-slug
status: review
featuredImage: /assets/images/test-slug.webp
image_provider: gemini
image_stage: 1
image_attempts:
  - { stage: 1, provider: gemini, reason: ok }
---

Body
`,
    );
    const file = makeFile({ type: "image/png" });

    await uploadReviewImage({ domain: "example.com", slug: "test-slug", branch: "staging/example.com", file: file as unknown as File });

    const [, files] = mockCommitSiteFiles.mock.calls[0]!;
    const content = (files as Array<{ path: string; content: string }>)[0]!.content;
    expect(content).not.toContain("image_provider");
    expect(content).not.toContain("image_stage");
    expect(content).not.toContain("image_attempts");
    expect(content).toContain("featuredImage: /assets/images/test-slug.png");
  });

  it("rejects unsupported MIME type", async () => {
    const file = makeFile({ type: "image/svg+xml" });

    const result = await uploadReviewImage({ domain: "example.com", slug: "test-slug", branch: null, file: file as unknown as File });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unsupported");
    expect(mockUploadToR2).not.toHaveBeenCalled();
  });

  it("rejects oversize file", async () => {
    const file = makeFile({ type: "image/png", size: 50 * 1024 * 1024 });

    const result = await uploadReviewImage({ domain: "example.com", slug: "test-slug", branch: null, file: file as unknown as File });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("too large");
    expect(mockUploadToR2).not.toHaveBeenCalled();
  });

  it("returns error on R2 upload failure", async () => {
    mockUploadToR2.mockResolvedValueOnce(false);
    const file = makeFile({ type: "image/png" });

    const result = await uploadReviewImage({ domain: "example.com", slug: "test-slug", branch: null, file: file as unknown as File });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("storage");
    expect(mockCommitSiteFiles).not.toHaveBeenCalled();
  });

  it("returns error on GitHub commit failure", async () => {
    mockCommitSiteFiles.mockRejectedValueOnce(new Error("commit conflict"));
    const file = makeFile({ type: "image/png" });

    const result = await uploadReviewImage({ domain: "example.com", slug: "test-slug", branch: null, file: file as unknown as File });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("commit");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/dashboard && pnpm test -- review-image
```
Expected: FAIL with "Cannot find module" (review-image.ts does not exist).

- [ ] **Step 3: Implement `uploadReviewImage`**

Create `services/dashboard/src/actions/review-image.ts`:

```typescript
"use server";

import { readFileContent, commitSiteFiles } from "@/lib/github";
import { uploadToR2 } from "@/lib/r2-upload";
import {
  validateImageUpload,
  parseFrontmatter,
  buildArticlePath,
  buildImageR2Key,
  buildImageFrontmatterPath,
} from "@/lib/article-upload";
import { stringify as stringifyYaml } from "yaml";
import { revalidatePath } from "next/cache";

export interface UploadReviewImageInput {
  domain: string;
  slug: string;
  branch: string | null;
  file: File;
}

export type UploadReviewImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload a replacement image for an article in the review queue.
 * Patches frontmatter: sets `featuredImage`, clears cascade provenance fields
 * (image_provider, image_stage, image_attempts) since the new image is human-supplied.
 */
export async function uploadReviewImage(
  input: UploadReviewImageInput,
): Promise<UploadReviewImageResult> {
  const { domain, slug, branch, file } = input;

  // Validate the uploaded file
  const validation = validateImageUpload(file);
  if (!validation.ok) return { ok: false, error: validation.error };
  const { ext } = validation;

  // Upload to R2
  const r2Key = buildImageR2Key(domain, slug, ext);
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadToR2(r2Key, buffer, file.type);
  if (!uploaded) {
    return { ok: false, error: "Storage upload failed" };
  }

  // Fetch + patch frontmatter
  const articlePath = buildArticlePath(domain, slug);
  let markdown: string;
  try {
    markdown = await readFileContent(articlePath, branch ?? undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not read article: ${msg}` };
  }

  const parsed = parseFrontmatter(markdown);
  if (!parsed) {
    return { ok: false, error: "Could not parse article frontmatter" };
  }
  const fm = parsed.frontmatter;
  fm.featuredImage = buildImageFrontmatterPath(slug, ext);
  delete fm.image_provider;
  delete fm.image_stage;
  delete fm.image_attempts;

  const newMarkdown = `---\n${stringifyYaml(fm)}---\n${parsed.body}`;

  // Commit
  try {
    await commitSiteFiles(
      domain,
      [{ path: articlePath, content: newMarkdown }],
      `review: replace image for ${slug}`,
      branch ?? "main",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Commit failed: ${msg}` };
  }

  revalidatePath("/review");
  return { ok: true, url: buildImageFrontmatterPath(slug, ext) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/dashboard && pnpm test -- review-image
```
Expected: all 6 `uploadReviewImage` tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/actions/review-image.ts services/dashboard/src/__tests__/review-image.test.ts
git commit -m "feat(dashboard): add uploadReviewImage server action"
```

---

## Task 6: `regenerateReviewImage` server action

**Files:**
- Modify: `services/dashboard/src/actions/review-image.ts`
- Modify: `services/dashboard/src/__tests__/review-image.test.ts`

- [ ] **Step 1: Add the regenerate tests**

Append to `services/dashboard/src/__tests__/review-image.test.ts`:

```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { regenerateReviewImage } from "@/actions/review-image";

describe("regenerateReviewImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileContent.mockResolvedValue(`---
title: Test
description: A test description
slug: test-slug
status: review
tags: [a, b]
---

Summary line.

Body content.
`);
    mockCommitSiteFiles.mockResolvedValue(undefined);
    mockUploadToR2.mockResolvedValue(true);
    process.env.CONTENT_AGENT_URL = "http://pipeline";
  });

  it("happy path (no subject): pipeline success → R2 upload + frontmatter patch + commit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        imageBase64: Buffer.from("regen-bytes").toString("base64"),
        provider: "gemini",
        stage: 1,
        attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
      }),
    });

    const result = await regenerateReviewImage({
      domain: "example.com",
      slug: "test-slug",
      branch: "staging/example.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("/assets/images/test-slug.webp");
      expect(result.provider).toBe("gemini");
      expect(result.stage).toBe(1);
    }
    // Pipeline call has no customSubject
    const pipelineBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(pipelineBody.customSubject).toBeUndefined();
    // Frontmatter updated with new provenance
    const [, files] = mockCommitSiteFiles.mock.calls[0]!;
    const content = (files as Array<{ path: string; content: string }>)[0]!.content;
    expect(content).toContain("featuredImage: /assets/images/test-slug.webp");
    expect(content).toContain("image_provider: gemini");
    expect(content).toContain("image_stage: 1");
  });

  it("with customSubject: pipeline call includes the subject", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        imageBase64: Buffer.from("custom-bytes").toString("base64"),
        provider: "gemini",
        stage: 2,
        attempts: [{ stage: 2, provider: "gemini", reason: "ok" }],
      }),
    });

    await regenerateReviewImage({
      domain: "example.com",
      slug: "test-slug",
      branch: null,
      customSubject: "data center with blue lighting",
    });

    const pipelineBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(pipelineBody.customSubject).toBe("data center with blue lighting");
  });

  it("pipeline cascade failure → no frontmatter change, returns error with attempts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        attempts: [
          { stage: 1, provider: "gemini", reason: "no_image_in_response" },
          { stage: 1, provider: "openai", reason: "client_error:400" },
        ],
      }),
    });

    const result = await regenerateReviewImage({
      domain: "example.com",
      slug: "test-slug",
      branch: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("image generation failed");
      expect(result.attempts).toHaveLength(2);
    }
    expect(mockUploadToR2).not.toHaveBeenCalled();
    expect(mockCommitSiteFiles).not.toHaveBeenCalled();
  });

  it("pipeline unreachable → returns service-unavailable error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const result = await regenerateReviewImage({
      domain: "example.com",
      slug: "test-slug",
      branch: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("image service");
    expect(mockUploadToR2).not.toHaveBeenCalled();
    expect(mockCommitSiteFiles).not.toHaveBeenCalled();
  });

  it("R2 upload failure on regenerate → returns error, no commit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        imageBase64: Buffer.from("bytes").toString("base64"),
        provider: "gemini",
        stage: 1,
        attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
      }),
    });
    mockUploadToR2.mockResolvedValueOnce(false);

    const result = await regenerateReviewImage({ domain: "example.com", slug: "test-slug", branch: null });

    expect(result.ok).toBe(false);
    expect(mockCommitSiteFiles).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/dashboard && pnpm test -- review-image
```
Expected: existing `uploadReviewImage` tests pass; new `regenerateReviewImage` tests fail.

- [ ] **Step 3: Implement `regenerateReviewImage`**

In `services/dashboard/src/actions/review-image.ts`, append after the existing `uploadReviewImage` function:

```typescript
export interface RegenerateReviewImageInput {
  domain: string;
  slug: string;
  branch: string | null;
  customSubject?: string;
}

export type RegenerateReviewImageResult =
  | { ok: true; url: string; provider: "gemini" | "openai"; stage: 1 | 2 | 3 }
  | { ok: false; error: string; attempts?: Array<{ stage: 1 | 2 | 3; provider: "gemini" | "openai" | "sanitizer"; reason: string }> };

const PIPELINE_URL = process.env.CONTENT_AGENT_URL ?? "http://content-pipeline-app";

/**
 * Re-run the image cascade for a single review-queue article and patch the
 * article's frontmatter on success. On failure, no frontmatter changes are
 * persisted (the caller surfaces the failure to the reviewer inline).
 */
export async function regenerateReviewImage(
  input: RegenerateReviewImageInput,
): Promise<RegenerateReviewImageResult> {
  const { domain, slug, branch, customSubject } = input;

  // Fetch the article to build the cascade request
  const articlePath = buildArticlePath(domain, slug);
  let markdown: string;
  try {
    markdown = await readFileContent(articlePath, branch ?? undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not read article: ${msg}` };
  }

  const parsed = parseFrontmatter(markdown);
  if (!parsed) return { ok: false, error: "Could not parse article frontmatter" };
  const fm = parsed.frontmatter;

  // Call the content-pipeline regenerate endpoint.
  // Note: article frontmatter does NOT carry the vertical (it's on the aggregator item, not the saved article).
  // For the regenerate use case we default to "General" — the cascade still works, just less topically tuned.
  // If a more specific vertical is desired in the future, surface it via getReviewQueue from the site config.
  const requestBody: Record<string, unknown> = {
    articleTitle: String(fm.title ?? ""),
    articleDescription: String(fm.description ?? ""),
    articleSummary: parsed.body.slice(0, 500),
    vertical: "General",
  };
  if (customSubject && customSubject.trim()) {
    requestBody.customSubject = customSubject.trim();
  }

  let pipelineResponse: { ok: true; imageBase64: string; provider: "gemini" | "openai"; stage: 1 | 2 | 3; attempts: Array<{ stage: 1 | 2 | 3; provider: "gemini" | "openai" | "sanitizer"; reason: string }> } | { ok: false; attempts: Array<{ stage: 1 | 2 | 3; provider: "gemini" | "openai" | "sanitizer"; reason: string }> };
  try {
    const res = await fetch(`${PIPELINE_URL}/image-regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    pipelineResponse = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Image service unavailable: ${msg}` };
  }

  if (!pipelineResponse.ok) {
    return { ok: false, error: "Image generation failed", attempts: pipelineResponse.attempts };
  }

  // Upload to R2
  const r2Key = buildImageR2Key(domain, slug, "webp");
  const buffer = Buffer.from(pipelineResponse.imageBase64, "base64");
  const uploaded = await uploadToR2(r2Key, buffer, "image/webp");
  if (!uploaded) {
    return { ok: false, error: "Storage upload failed" };
  }

  // Patch frontmatter
  fm.featuredImage = buildImageFrontmatterPath(slug, "webp");
  fm.image_provider = pipelineResponse.provider;
  fm.image_stage = pipelineResponse.stage;
  fm.image_attempts = pipelineResponse.attempts;

  const newMarkdown = `---\n${stringifyYaml(fm)}---\n${parsed.body}`;

  try {
    await commitSiteFiles(
      domain,
      [{ path: articlePath, content: newMarkdown }],
      `review: regenerate image for ${slug} (stage ${pipelineResponse.stage}, ${pipelineResponse.provider})`,
      branch ?? "main",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Commit failed: ${msg}` };
  }

  revalidatePath("/review");
  return {
    ok: true,
    url: buildImageFrontmatterPath(slug, "webp"),
    provider: pipelineResponse.provider,
    stage: pipelineResponse.stage,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/dashboard && pnpm test -- review-image
```
Expected: all `uploadReviewImage` + `regenerateReviewImage` tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/actions/review-image.ts services/dashboard/src/__tests__/review-image.test.ts
git commit -m "feat(dashboard): add regenerateReviewImage server action"
```

---

## Task 7: Build `ReviewImageCard` component

**Files:**
- Create: `services/dashboard/src/app/review/ReviewImageCard.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/app/review/ReviewImageCard.tsx`:

```typescript
"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { uploadReviewImage, regenerateReviewImage } from "@/actions/review-image";
import { useToast } from "@/components/ui/Toast";

interface ReviewImageCardProps {
  domain: string;
  slug: string;
  branch: string | null;
  featuredImage?: string;
  imageProvider?: "gemini" | "openai";
  imageStage?: 1 | 2 | 3;
  /** Public base URL where R2 assets are served from for this site, e.g. "https://example.com". Used to build the thumbnail src. */
  assetBaseUrl?: string;
}

export function ReviewImageCard({
  domain,
  slug,
  branch,
  featuredImage,
  imageProvider,
  imageStage,
  assetBaseUrl,
}: ReviewImageCardProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"upload" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const thumbnailSrc = featuredImage
    ? assetBaseUrl
      ? `${assetBaseUrl}${featuredImage}`
      : featuredImage
    : null;

  function onUploadClick(): void {
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy("upload");
    startTransition(async () => {
      const result = await uploadReviewImage({ domain, slug, branch, file });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        toast(result.error, "error");
      } else {
        toast("Image uploaded", "success");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function onRegenerateClick(): void {
    setError(null);
    setBusy("regenerate");
    startTransition(async () => {
      const result = await regenerateReviewImage({
        domain,
        slug,
        branch,
        customSubject: subject.trim() || undefined,
      });
      setBusy(null);
      if (!result.ok) {
        const msg = result.error + (result.attempts?.length ? ` (last: ${result.attempts.at(-1)!.reason})` : "");
        setError(msg);
        toast(msg, "error");
      } else {
        toast(`Image regenerated (stage ${result.stage}, ${result.provider})`, "success");
        setSubject("");
      }
    });
  }

  const disabled = isPending || busy !== null;

  return (
    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] p-3 my-3">
      <div className="flex gap-4 items-start">
        {/* Thumbnail */}
        <div className="shrink-0 w-40 h-24 rounded bg-[var(--bg-surface)] flex items-center justify-center overflow-hidden border border-[var(--border-secondary)]">
          {thumbnailSrc ? (
            <img src={thumbnailSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-[var(--text-muted)]">No image</span>
          )}
        </div>

        {/* Metadata + actions */}
        <div className="flex-1 min-w-0 space-y-2">
          {(imageProvider || imageStage) && (
            <div className="text-xs text-[var(--text-muted)]">
              {imageProvider && <>Provider: <span className="text-[var(--text-secondary)]">{imageProvider}</span></>}
              {imageProvider && imageStage && " · "}
              {imageStage && <>Stage: <span className="text-[var(--text-secondary)]">{imageStage}</span></>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onFileChosen}
            />
            <Button onClick={onUploadClick} disabled={disabled} variant="secondary" size="sm">
              {busy === "upload" ? "Uploading…" : "Upload"}
            </Button>

            <input
              type="text"
              value={subject}
              onChange={(e): void => setSubject(e.target.value)}
              placeholder="Describe the image (optional)"
              disabled={disabled}
              className="flex-1 min-w-[160px] px-2 py-1 text-sm rounded-md bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-cyan disabled:opacity-50"
            />
            <Button onClick={onRegenerateClick} disabled={disabled} variant="secondary" size="sm">
              {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
            </Button>
          </div>

          {busy === "regenerate" && (
            <p className="text-xs text-[var(--text-muted)]">This may take up to 3 minutes.</p>
          )}
          {error && (
            <p className="text-xs text-red-400 break-words">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: no errors. If `Button` / `useToast` / `assetBaseUrl` cause errors, verify the actual import paths and prop names by grepping for similar usage in `ReviewQueueClient.tsx`. Adjust the import paths to match what already works there.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/review/ReviewImageCard.tsx
git commit -m "feat(dashboard): add ReviewImageCard component (upload + regenerate UI)"
```

---

## Task 8: Wire `ReviewImageCard` into the review queue

**Files:**
- Modify: `services/dashboard/src/app/review/ReviewQueueClient.tsx`

- [ ] **Step 1: Import the component**

In `services/dashboard/src/app/review/ReviewQueueClient.tsx`, near the top of the file with the other imports, add:

```typescript
import { ReviewImageCard } from "./ReviewImageCard";
```

- [ ] **Step 2: Render `ReviewImageCard` on each review card**

In `services/dashboard/src/app/review/ReviewQueueClient.tsx`, find the JSX block that renders each review-queue card. Look for the section that includes the reviewer notes / preview link / Approve / Reject buttons — typically after the score breakdown and before the action buttons.

Insert the `ReviewImageCard` component right before the Approve/Reject button row. The exact insertion point is the line just before the row containing the `Approve` button. The new JSX:

```tsx
<ReviewImageCard
  domain={article.domain}
  slug={article.slug}
  branch={article.branch}
  featuredImage={article.featuredImage}
  imageProvider={article.image_provider}
  imageStage={article.image_stage}
/>
```

(If the review queue has a known asset base URL per article in `article`, pass it as `assetBaseUrl`. If not, omit — the thumbnail will fall back to the raw `featuredImage` path which works when the dashboard is served from the same origin as the assets, or when the user is on a domain that resolves the absolute path.)

- [ ] **Step 3: Typecheck the dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Manual smoke check — start the dashboard locally**

Run from `services/dashboard`:
```bash
pnpm dev
```

Open `http://localhost:3000/review` (or the port the dev server reports). Expected:
1. Each review-queue card renders an image sub-section between the metadata and the Approve/Reject buttons.
2. Cards with `featuredImage` show a thumbnail; cards without show "No image".
3. "Provider: ... Stage: ..." metadata appears below the thumbnail when present.
4. The Upload button opens a file picker.
5. The custom-subject input is editable; the Regenerate button is enabled.

(Don't actually click Upload/Regenerate yet against production data; the next step covers the real integration test.)

- [ ] **Step 5: Manual integration test against a real failed article**

Pick an article in the review queue whose image cascade failed (no `featuredImage`). Click **Upload**, choose a small PNG. Expected: card refreshes within a few seconds; thumbnail appears; toast says "Image uploaded". Approve the article. Verify the staging branch on GitHub has the new image path in the article's frontmatter.

Pick another image-failed article. Type a subject ("data center with blue lighting") and click **Regenerate**. Expected: card shows "Regenerating… this may take up to 3 minutes"; after some seconds, the thumbnail appears with new provider/stage labels. If it fails, the failure reason renders inline.

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/app/review/ReviewQueueClient.tsx
git commit -m "feat(dashboard): wire ReviewImageCard into review queue"
```

---

## Task 9: Final verification

**Files:** (no edits — verification only)

- [ ] **Step 1: Run the full test suites**

Run from the repo root:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
cd services/content-pipeline && pnpm test
cd ../dashboard && pnpm test 2>/dev/null || echo "(no dashboard test script — skipping)"
```
Expected: all content-pipeline tests pass (including the new `image-regenerate-handler.test.ts` and the extended `image-cascade.test.ts`); dashboard tests pass if the test script exists.

- [ ] **Step 2: Typecheck the whole monorepo**

Run:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform && pnpm -r typecheck
```
Expected: no TypeScript errors anywhere.

- [ ] **Step 3: Confirm no leftover references to the old upload constants**

Run:
```bash
grep -rn "MAX_IMG_SIZE\|^const IMAGE_TYPES" services/dashboard/src/ 2>/dev/null || echo "CLEAN"
```
Expected: `CLEAN`. (The old local constants in `api/articles/upload/route.ts` were extracted to `article-upload.ts` in Task 4.)

- [ ] **Step 4: Push the branch**

Run:
```bash
git push -u origin feat/review-queue-image-actions
```
Expected: branch pushed; output includes a PR-creation URL.

- [ ] **Step 5: Manual end-to-end check on the deployed branch**

Open the CloudGrid preview URL for the dashboard service (or `pnpm dev` locally if preview isn't enabled). Test the three flows on real review-queue articles:
1. Upload a PNG on an image-failed article → frontmatter patched → approve → published with the uploaded image.
2. Regenerate (empty subject) on an image-failed article → cascade re-runs → either succeeds (record provenance) or surfaces failure inline (no frontmatter change).
3. Regenerate with a custom subject on an image-failed article → Stage 2/3 cascade runs with the subject → succeeds or surfaces failure inline.

---

## Self-review notes

**Spec coverage check:**
- Upload Image button + flow → Tasks 4 (constants), 5 (server action), 7 (component), 8 (wiring)
- Regenerate Image button + custom subject input → Tasks 2 (cascade extension), 3 (pipeline endpoint), 6 (server action), 7 (component), 8 (wiring)
- Buttons on every review card → Task 8 (renders unconditionally per card)
- Custom subject passes through verbatim — no sanitizer → Task 2 implementation (sanitizer never called when `customSubject` set; verified by Stage 2 test that asserts `mockSanitize` not called)
- Custom subject runs Stage 2 then Stage 3 — no Stage 1 → Task 2 implementation
- Regenerate failure → no frontmatter change → Task 6 implementation (early return before R2 upload and commit on `pipelineResponse.ok === false`)
- Successful upload clears cascade provenance → Task 5 implementation
- `image_attempts` overwrites on regenerate success, unchanged on failure → Task 6 implementation
- Synchronous server action with in-card loading state → Task 7 (useTransition + busy state + "may take up to 3 minutes" copy)
- Successful regenerate does NOT auto-approve → Task 6/7 — no `status` change is ever written
- Thumbnail preview in review card → Task 7 component
- ReviewArticle / ArticleEntry extended with new fields → Task 1
- Per-card image upload validation reuses existing helpers → Task 4 extraction

**Type consistency:**
- `customSubject?: string` is consistently optional on `ImageGenInput` (Task 2), `ImageRegenerateRequest` (Task 3), `RegenerateReviewImageInput` (Task 6), and `regenerateReviewImage` is called with it from `ReviewImageCard` (Task 7).
- `provider: "gemini" | "openai"` and `stage: 1 | 2 | 3` are consistent across cascade types (from #1), the pipeline endpoint response (Task 3), and the server action response (Task 6).
- `branch: string | null` is consistent across `uploadReviewImage` and `regenerateReviewImage` (both server actions take it; `null` falls back to `"main"`).
- Thumbnail / metadata fields on `ReviewArticle` use the same snake_case (`image_provider`, `image_stage`, `image_attempts`) as the frontmatter and shared-types from #1.

**Out-of-scope reminders:**
- No title/body editing
- No backfill of existing review-queue articles
- No background-job + polling pattern
- No auto-approve on successful regenerate
- No sanitization of user-provided subjects

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-review-queue-image-actions.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with isolated context per step.

**2. Inline Execution** — I execute tasks in this session using the executing-plans skill, batched with checkpoints for review.

Which approach?
