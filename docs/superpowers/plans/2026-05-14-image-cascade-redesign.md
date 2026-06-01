# Image Cascade Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-tier image ladder (Gemini → OpenAI → source thumbnail) with a three-stage cascade that escalates through prompt sanitization and style changes, and route final failures to the review queue instead of using a thumbnail fallback.

**Architecture:** A new `generateImageWithCascade` function in `image-pipeline/generator.ts` orchestrates three stages — (1) realism with raw prompt, (2) realism with a sanitized concept produced by a new `sanitizer.ts` Claude call, (3) illustration with the same sanitized concept. The agent at `agents/content-generation/agent.ts` interprets the new result shape: on success it records `image_provider`/`image_stage`/`image_attempts` in the frontmatter; on total failure it sets `status: review` with a `quality_note` and no `featuredImage`. The source-thumbnail fallback is removed entirely.

**Tech Stack:** TypeScript, Node 20, vitest, `@cloudgrid-io/ai` (Claude via gateway) with `@anthropic-ai/sdk` fallback, existing Gemini and OpenAI REST clients.

**Reference spec:** `docs/superpowers/specs/2026-05-14-image-cascade-redesign-design.md`

---

## Pre-flight

- [ ] **Step 1: Create a feature branch**

Run from `/Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform`:
```bash
git checkout -b feat/image-cascade-redesign
git status
```
Expected: on branch `feat/image-cascade-redesign`, working tree clean (the design spec already committed or untracked).

- [ ] **Step 2: Confirm test runner works**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-ladder
```
Expected: existing `image-ladder.test.ts` tests pass. This is the baseline before we change anything.

---

## Task 1: Extend shared frontmatter types

**Files:**
- Modify: `packages/shared-types/src/article.ts` (insert after `quality_note?` field, around line 64)

- [ ] **Step 1: Add the three new optional fields to `ArticleFrontmatter`**

In `packages/shared-types/src/article.ts`, inside the `ArticleFrontmatter` interface, after the `quality_note?: string;` line and before `scripts?: ArticleScript[];`, add:

```typescript
  /** Which provider produced the featured image. Unset when image generation failed. */
  image_provider?: "gemini" | "openai";

  /** Which cascade stage produced the featured image (1=raw realism, 2=sanitized realism, 3=illustration). */
  image_stage?: 1 | 2 | 3;

  /** Full chain of image-generation attempts (across all stages). Last entry is the successful one when the image was generated. */
  image_attempts?: Array<{
    stage: 1 | 2 | 3;
    provider: "gemini" | "openai" | "sanitizer";
    reason: string;
  }>;
```

- [ ] **Step 2: Build shared-types to verify**

Run:
```bash
cd packages/shared-types && pnpm build
```
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/article.ts
git commit -m "feat(shared-types): add image_provider, image_stage, image_attempts to ArticleFrontmatter"
```

---

## Task 2: Extend image-pipeline types

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts`

- [ ] **Step 1: Update the types file**

Replace the contents of `services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts` with:

```typescript
/**
 * Types for the image generation pipeline.
 */

/** Result of analyzing a source thumbnail with a vision model. */
export interface ImageAnalysis {
  subject: string;
  mood: string;
  palette: string[];
  composition: string;
  style: string;
}

/** Cascade stage that produced an image (or attempt). */
export type ImageStage = 1 | 2 | 3;

/** Provider that produced an image (or attempted to). "sanitizer" is used to record sanitizer failures. */
export type ImageProvider = "gemini" | "openai" | "sanitizer";

/** Result of generating an original image. */
export interface ImageGenerationResult {
  /** Raw image data (PNG/WebP). */
  data: Buffer;
  /** Alt text for accessibility + SEO. */
  altText: string;
  /** Prompt used for generation (for debugging). */
  prompt: string;
  /** Provider that produced the image. */
  provider: "gemini" | "openai";
  /** Cascade stage that produced the image. */
  stage: ImageStage;
}

// ---------------------------------------------------------------------------
// Cascade types
// ---------------------------------------------------------------------------

/** Result of a single image-generation attempt (Gemini or OpenAI). */
export type ImageGenAttempt =
  | { ok: true; data: Buffer }
  | { ok: false; retriable: boolean; reason: string };

/** Log entry for a single provider attempt within the cascade. */
export interface ImageCascadeAttemptLog {
  stage: ImageStage;
  provider: ImageProvider;
  /** Either "ok" (success) or a structured reason like "no_image_in_response" / "client_error:400". */
  reason: string;
}

/** Result of the three-stage image generation cascade. */
export type ImageCascadeResult =
  | {
      ok: true;
      result: ImageGenerationResult;
      /** Full chain including the successful final entry (reason = "ok"). */
      attempts: ImageCascadeAttemptLog[];
    }
  | {
      ok: false;
      reason: "image_gen_exhausted";
      /** Full chain of failure attempts across all stages. */
      attempts: ImageCascadeAttemptLog[];
    };
```

The legacy `ImageLadderResult` and `ImageLadderAttemptLog` names are removed — callers will be updated in Task 9.

- [ ] **Step 2: Verify the file compiles**

Run:
```bash
cd services/content-pipeline && pnpm typecheck
```
Expected: TypeScript will report errors in `generator.ts` and `agent.ts` (they still reference the old types). That's expected — we fix them in later tasks. Do NOT proceed until you confirm the errors are ONLY about `ImageLadderResult` / `ImageLadderAttemptLog` references. Any other error means something is wrong with this task's change.

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts
git commit -m "refactor(image-pipeline): introduce ImageCascadeResult types with stage + provider"
```

---

## Task 3: Build the prompt sanitizer

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/image-pipeline/sanitizer.ts`
- Create: `services/content-pipeline/src/__tests__/sanitizer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/content-pipeline/src/__tests__/sanitizer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("../lib/ai.js", () => ({
  generateContent: (...args: unknown[]): Promise<string> => mockGenerateContent(...args),
}));

import { sanitizeImageConcept } from "../agents/content-generation/image-pipeline/sanitizer.js";

const INPUT = {
  title: "Caitlyn Jenner Class-Action Crypto Scheme Lawsuit",
  description: "Allegations against a celebrity over a crypto fraud scheme.",
  summary: "A class-action lawsuit alleges a public figure promoted a fraudulent crypto scheme.",
  vertical: "Finance",
};

describe("sanitizeImageConcept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with the sanitized concept on success", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      "Courtroom gavel resting beside cryptocurrency tokens on a desk, editorial photography style, neutral palette.",
    );

    const result = await sanitizeImageConcept(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.concept).toContain("gavel");
      expect(result.concept.length).toBeGreaterThan(0);
      expect(result.concept.length).toBeLessThanOrEqual(300);
    }
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("strips surrounding whitespace and quotes from the model response", async () => {
    mockGenerateContent.mockResolvedValueOnce('  "Modern data center server racks with status lights."  ');

    const result = await sanitizeImageConcept(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.concept).toBe("Modern data center server racks with status lights.");
    }
  });

  it("returns ok:false with reason when the model errors", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("CloudGrid AI Gateway timeout"));

    const result = await sanitizeImageConcept(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("CloudGrid AI Gateway timeout");
    }
  });

  it("returns ok:false when the model returns an empty string", async () => {
    mockGenerateContent.mockResolvedValueOnce("   ");

    const result = await sanitizeImageConcept(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty_response");
    }
  });

  it("passes article context into the Claude prompt", async () => {
    mockGenerateContent.mockResolvedValueOnce("A neutral concept.");

    await sanitizeImageConcept(INPUT);

    const [callArgs] = mockGenerateContent.mock.calls;
    expect(callArgs).toBeDefined();
    const args = callArgs![0] as { systemPrompt: string; userPrompt: string };
    expect(args.userPrompt).toContain(INPUT.title);
    expect(args.userPrompt).toContain(INPUT.vertical);
    expect(args.systemPrompt.toLowerCase()).toContain("no proper nouns");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd services/content-pipeline && pnpm test -- sanitizer
```
Expected: FAIL with "Cannot find module" (sanitizer.ts does not exist yet).

- [ ] **Step 3: Implement the sanitizer**

Create `services/content-pipeline/src/agents/content-generation/image-pipeline/sanitizer.ts`:

```typescript
/**
 * Prompt sanitizer for the image-generation cascade.
 *
 * Converts an article's metadata into a neutral visual concept suitable for
 * image generation, removing proper nouns, brand names, and negative framing
 * that commonly trigger content-policy refusals from Gemini and OpenAI.
 */

import { generateContent } from "../../../lib/ai.js";

export interface SanitizerInput {
  title: string;
  description: string;
  summary: string;
  vertical: string;
}

export type SanitizerResult =
  | { ok: true; concept: string }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = [
  "You convert news article metadata into a neutral visual concept for AI image generation.",
  "Output a single sentence describing a visual subject, no more than 25 words.",
  "Hard constraints:",
  "- No proper nouns (no person names, no company or brand names, no specific product names).",
  "- No negative or sensitive framing. Words like 'scheme', 'lawsuit', 'crash', 'scandal', 'fraud', 'attack', 'crisis', 'hack' must be reframed to a neutral domain reference.",
  "- No specific trademarked product appearances.",
  "- Focus on the domain and abstract concept, not the actors.",
  "- End with an editorial photography style cue (for example, 'editorial photography style, neutral palette').",
  "Reply with ONLY the sentence — no labels, no quotes, no preamble.",
].join("\n");

/**
 * Generate a sanitized visual concept for the given article context.
 *
 * Returns a structured result rather than throwing — sanitizer failures are a
 * recoverable failure mode in the cascade.
 */
export async function sanitizeImageConcept(
  input: SanitizerInput,
): Promise<SanitizerResult> {
  const userPrompt = [
    `Article title: ${input.title}`,
    `Description: ${input.description}`,
    `Summary: ${input.summary}`,
    `Vertical: ${input.vertical}`,
    "",
    "Produce the sanitized visual concept now.",
  ].join("\n");

  try {
    const raw = await generateContent({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 200,
    });

    const concept = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (concept.length === 0) {
      return { ok: false, reason: "empty_response" };
    }
    return { ok: true, concept };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd services/content-pipeline && pnpm test -- sanitizer
```
Expected: all 5 tests in `sanitizer.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/sanitizer.ts services/content-pipeline/src/__tests__/sanitizer.test.ts
git commit -m "feat(image-pipeline): add prompt sanitizer for cascade Stage 2/3"
```

---

## Task 4: Rewrite cascade — Stage 1 (raw realism)

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`
- Create: `services/content-pipeline/src/__tests__/image-cascade.test.ts`
- Delete: `services/content-pipeline/src/__tests__/image-ladder.test.ts` (replaced)

- [ ] **Step 1: Delete the old test file**

Run:
```bash
git rm services/content-pipeline/src/__tests__/image-ladder.test.ts
```

- [ ] **Step 2: Write failing tests for Stage 1**

Create `services/content-pipeline/src/__tests__/image-cascade.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImageGenAttempt } from "../agents/content-generation/image-pipeline/types.js";

const mockGemini = vi.fn<(...args: unknown[]) => Promise<ImageGenAttempt>>();
const mockOpenAI = vi.fn<(...args: unknown[]) => Promise<ImageGenAttempt>>();
const mockSanitize = vi.fn<(...args: unknown[]) => Promise<{ ok: true; concept: string } | { ok: false; reason: string }>>();

vi.mock("../lib/gemini.js", () => ({
  generateImageWithGemini: (...args: unknown[]): Promise<ImageGenAttempt> => mockGemini(...args),
}));

vi.mock("../lib/openai-image.js", () => ({
  generateImageWithOpenAI: (...args: unknown[]): Promise<ImageGenAttempt> => mockOpenAI(...args),
}));

vi.mock("../lib/image-optimizer.js", () => ({
  optimizeImage: (buf: Buffer): Promise<Buffer> => Promise.resolve(buf),
}));

vi.mock("../agents/content-generation/image-pipeline/sanitizer.js", () => ({
  sanitizeImageConcept: (...args: unknown[]) => mockSanitize(...args),
}));

vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no thumbnail in test")));

import { generateImageWithCascade } from "../agents/content-generation/image-pipeline/generator.js";

const INPUT = {
  articleTitle: "Test Article",
  articleDescription: "A test description",
  articleSummary: "A test summary for the article",
  vertical: "Tech",
};

function ok(data = "image-bytes"): ImageGenAttempt {
  return { ok: true, data: Buffer.from(data) };
}

function fail(retriable: boolean, reason: string): ImageGenAttempt {
  return { ok: false, retriable, reason };
}

describe("generateImageWithCascade — Stage 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
  });

  it("Stage 1: Gemini succeeds on first attempt → image_stage=1, image_provider=gemini", async () => {
    mockGemini.mockResolvedValueOnce(ok("stage1-gemini"));

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(1);
      expect(result.result.provider).toBe("gemini");
      expect(result.result.data.toString()).toBe("stage1-gemini");
      expect(result.attempts.at(-1)).toEqual({ stage: 1, provider: "gemini", reason: "ok" });
    }
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).not.toHaveBeenCalled();
    expect(mockSanitize).not.toHaveBeenCalled();
  });

  it("Stage 1: Gemini retries once on transient failure, then succeeds", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(true, "server_error:500"))
      .mockResolvedValueOnce(ok("retry-image"));

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(1);
      expect(result.result.provider).toBe("gemini");
      expect(result.attempts).toEqual([
        { stage: 1, provider: "gemini", reason: "server_error:500" },
        { stage: 1, provider: "gemini", reason: "ok" },
      ]);
    }
    expect(mockGemini).toHaveBeenCalledTimes(2);
  });

  it("Stage 1: Gemini hits permanent failure (no_image_in_response) — falls to OpenAI without retrying Gemini", async () => {
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(ok("openai-image"));

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(1);
      expect(result.result.provider).toBe("openai");
    }
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
  });

  it("Stage 1: OpenAI retries once on transient failure (NEW behavior — fixes today's bug)", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response")); // not called, but guard against re-attempt
    mockOpenAI
      .mockResolvedValueOnce(fail(true, "rate_limited:429"))
      .mockResolvedValueOnce(ok("openai-retry"));

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.provider).toBe("openai");
      expect(result.result.stage).toBe(1);
    }
    expect(mockOpenAI).toHaveBeenCalledTimes(2);
  });

  it("Stage 1: OpenAI permanent failure does NOT retry OpenAI", async () => {
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400"));
    // Stage 2 will run; mock sanitizer to fail so we stop there
    mockSanitize.mockResolvedValueOnce({ ok: false, reason: "sanitizer_test_skip" });

    const result = await generateImageWithCascade(INPUT);

    expect(mockOpenAI).toHaveBeenCalledTimes(1); // no retry on permanent
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: FAIL with "Cannot find module" (generator.ts still exports the old `generateImageWithLadder`).

- [ ] **Step 4: Rewrite generator.ts with Stage 1 only (other stages stubbed to fail)**

Replace the contents of `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts` with:

```typescript
/**
 * Image Generator — three-stage cascade.
 *
 * Stage 1: Realism with raw article prompt — Gemini ×2 (retry on transient) → OpenAI ×1 (retry on transient).
 *          Reference image (source thumbnail) attached to Gemini only.
 * Stage 2: Realism with sanitized concept — Gemini ×1 → OpenAI ×1 (no transient retry).
 * Stage 3: Illustration with sanitized concept (reused from Stage 2) — Gemini ×1 → OpenAI ×1.
 *
 * On total failure, returns { ok: false, attempts } and the caller routes
 * the article to the review queue with no featuredImage.
 */

import { generateImageWithGemini, type GeminiImageInput } from "../../../lib/gemini.js";
import { generateImageWithOpenAI } from "../../../lib/openai-image.js";
import { optimizeImage } from "../../../lib/image-optimizer.js";
import { notifyImageGeneration, type NotificationConfig } from "../../../lib/notifications.js";
import { sanitizeImageConcept } from "./sanitizer.js";
import type {
  ImageCascadeAttemptLog,
  ImageCascadeResult,
  ImageGenAttempt,
  ImageStage,
} from "./types.js";

const GEMINI_MODEL = "gemini-2.5-flash-image";
const OPENAI_MODEL = "gpt-image-2";

export interface ImageGenInput {
  articleTitle: string;
  articleDescription: string;
  articleSummary: string;
  vertical: string;
  /** Source article thumbnail URL (if available). Used as reference for Stage 1 Gemini only. */
  sourceThumbnailUrl?: string;
  /** Image generation guidelines from site brief. */
  imageGuidelines?: string | string[];
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatImageGuidelines(guidelines?: string | string[]): string | undefined {
  if (!guidelines) return undefined;
  const items = Array.isArray(guidelines)
    ? guidelines.filter(Boolean)
    : guidelines.split("\n").filter(Boolean);
  if (items.length === 0) return undefined;
  return `Additional style guidelines: ${items.map((g) => `- ${g}`).join(" ")}`;
}

/** Stage 1 prompt: raw article context, realistic editorial style. */
function buildStage1Prompt(input: ImageGenInput, hasReference: boolean): string {
  const topicSummary = input.articleDescription || input.articleSummary.slice(0, 200);
  const guidelinesBlock = formatImageGuidelines(input.imageGuidelines);

  if (hasReference) {
    const parts = [
      `I'm attaching the thumbnail from the source article as a style reference.`,
      `Create a NEW, ORIGINAL hero image for an article titled: "${input.articleTitle}".`,
      `Topic: ${topicSummary}.`,
      `Match the visual style of the reference image:`,
      `- If it is a realistic photograph, generate a candid photograph with natural lighting.`,
      `- If it is an illustration, graphic, or low-quality image, generate a clean, modern editorial illustration.`,
      `Wide landscape format (16:9). Web-optimized, moderate detail.`,
      `Do NOT copy the reference image. Create something new that matches its style.`,
      `Do NOT include any text, watermarks, logos, or identifiable real people.`,
    ];
    if (guidelinesBlock) parts.push(guidelinesBlock);
    return parts.join(" ");
  }

  const parts = [
    `Create a professional editorial illustration for a ${input.vertical} article.`,
    `Article title: "${input.articleTitle}".`,
    `Topic: ${topicSummary}.`,
    `Style: clean, modern hero image for a news/content website.`,
    `Wide landscape format (16:9). Web-optimized, moderate detail.`,
    `Do NOT include any text, watermarks, logos, or identifiable real people.`,
  ];
  if (guidelinesBlock) parts.push(guidelinesBlock);
  return parts.join(" ");
}

/** Stage 2 prompt: sanitized concept, realistic editorial photography. */
function buildStage2Prompt(concept: string, vertical: string, guidelines?: string | string[]): string {
  const parts = [
    `Create a realistic editorial hero photograph for a ${vertical} article.`,
    `Visual subject: ${concept}`,
    `Style: candid editorial photograph with natural lighting.`,
    `Wide landscape format (16:9). Web-optimized, moderate detail.`,
    `Do NOT include any text, watermarks, logos, or identifiable real people.`,
  ];
  const g = formatImageGuidelines(guidelines);
  if (g) parts.push(g);
  return parts.join(" ");
}

/** Stage 3 prompt: sanitized concept, clean modern illustration. */
function buildStage3Prompt(concept: string, vertical: string, guidelines?: string | string[]): string {
  const parts = [
    `Create a clean, modern editorial illustration for a ${vertical} article.`,
    `Visual subject: ${concept}`,
    `Style: flat or semi-flat editorial illustration, neutral palette, news-website aesthetic.`,
    `Wide landscape format (16:9). Web-optimized, moderate detail.`,
    `Do NOT include any text, watermarks, logos, or identifiable real people.`,
  ];
  const g = formatImageGuidelines(guidelines);
  if (g) parts.push(g);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Thumbnail helpers (Stage 1 reference image only)
// ---------------------------------------------------------------------------

async function fetchThumbnail(url: string): Promise<GeminiImageInput | undefined> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AtomicBot/1.0)",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!response.ok) {
      console.warn(`[img-gen] Thumbnail fetch failed: ${response.status} ${url}`);
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 5_000) return undefined;
    const mimeType = contentType.split(";")[0]!.trim();
    return { data: buffer.toString("base64"), mimeType };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[img-gen] Thumbnail fetch error: ${msg}`);
    return undefined;
  }
}

function generateAltText(input: ImageGenInput): string {
  return `Image for: ${input.articleTitle}`;
}

// ---------------------------------------------------------------------------
// Stage runners
// ---------------------------------------------------------------------------

interface StageContext {
  input: ImageGenInput;
  notifications?: NotificationConfig;
  siteDomain?: string;
  attempts: ImageCascadeAttemptLog[];
}

/**
 * Run one provider with optional transient retries. Pushes attempts into the
 * shared attempts log. Returns the successful image data, or undefined if the
 * provider failed all its attempts.
 */
async function runProvider(
  ctx: StageContext,
  stage: ImageStage,
  provider: "gemini" | "openai",
  prompt: string,
  reference: GeminiImageInput | undefined,
  maxAttempts: number,
  apiKey: string | undefined,
): Promise<Buffer | undefined> {
  if (!apiKey) {
    ctx.attempts.push({ stage, provider, reason: "api_key_not_configured" });
    return undefined;
  }

  for (let i = 0; i < maxAttempts; i++) {
    const attempt: ImageGenAttempt =
      provider === "gemini"
        ? await generateImageWithGemini(apiKey, prompt, reference)
        : await generateImageWithOpenAI(apiKey, prompt);

    if (attempt.ok) {
      ctx.attempts.push({ stage, provider, reason: "ok" });
      return attempt.data;
    }

    ctx.attempts.push({ stage, provider, reason: attempt.reason });
    const modelLabel =
      provider === "gemini" ? `Gemini Stage ${stage} (${GEMINI_MODEL})` : `OpenAI Stage ${stage} (${OPENAI_MODEL})`;
    console.error(`[img-gen] ${modelLabel} failed: ${attempt.reason}`);
    if (ctx.notifications) {
      void notifyImageGeneration(ctx.notifications, {
        article: ctx.input.articleTitle,
        site: ctx.siteDomain,
        provider: modelLabel,
        success: false,
        reason: attempt.reason,
      });
    }

    if (!attempt.retriable) return undefined;
    // else: loop to next attempt
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main cascade entry point
// ---------------------------------------------------------------------------

export async function generateImageWithCascade(
  input: ImageGenInput,
  notifications?: NotificationConfig,
  siteDomain?: string,
): Promise<ImageCascadeResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const attempts: ImageCascadeAttemptLog[] = [];
  const ctx: StageContext = { input, notifications, siteDomain, attempts };

  // ── Stage 1: realism, raw prompt ──────────────────────────────────────
  let reference: GeminiImageInput | undefined;
  if (input.sourceThumbnailUrl) {
    console.log(`[img-gen] Fetching source thumbnail (Stage 1 reference): ${input.sourceThumbnailUrl}`);
    reference = await fetchThumbnail(input.sourceThumbnailUrl);
  }

  const stage1Prompt = buildStage1Prompt(input, !!reference);

  console.log(`[img-gen] Stage 1: Gemini for "${input.articleTitle}"`);
  const stage1Gemini = await runProvider(ctx, 1, "gemini", stage1Prompt, reference, 2, geminiKey);
  if (stage1Gemini) {
    const optimized = await optimizeImage(stage1Gemini);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage1Prompt,
        provider: "gemini",
        stage: 1,
      },
      attempts,
    };
  }

  console.log(`[img-gen] Stage 1: OpenAI for "${input.articleTitle}"`);
  const stage1OpenAI = await runProvider(ctx, 1, "openai", stage1Prompt, undefined, 2, openaiKey);
  if (stage1OpenAI) {
    const optimized = await optimizeImage(stage1OpenAI);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage1Prompt,
        provider: "openai",
        stage: 1,
      },
      attempts,
    };
  }

  // ── Stage 2: realism, sanitized concept ──────────────────────────────
  console.log(`[img-gen] Stage 1 exhausted — running sanitizer for "${input.articleTitle}"`);
  const sanitized = await sanitizeImageConcept({
    title: input.articleTitle,
    description: input.articleDescription,
    summary: input.articleSummary,
    vertical: input.vertical,
  });

  if (!sanitized.ok) {
    attempts.push({ stage: 2, provider: "sanitizer", reason: sanitized.reason });
    console.error(`[img-gen] Sanitizer failed: ${sanitized.reason} — dropping to review`);
    return { ok: false, reason: "image_gen_exhausted", attempts };
  }

  // Stage 2 + Stage 3 are implemented in later tasks; for now, return failure.
  return { ok: false, reason: "image_gen_exhausted", attempts };
}
```

- [ ] **Step 5: Run the Stage 1 tests to verify they pass**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: all 5 Stage 1 tests pass. (The cascade only runs through Stage 1 + sanitizer-failure short-circuit, which is exactly what the tests exercise.)

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts services/content-pipeline/src/__tests__/image-cascade.test.ts services/content-pipeline/src/__tests__/image-ladder.test.ts
git commit -m "feat(image-pipeline): rewrite Stage 1 of cascade with OpenAI transient retry"
```

---

## Task 5: Cascade Stage 2 (sanitized realism)

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`
- Modify: `services/content-pipeline/src/__tests__/image-cascade.test.ts`

- [ ] **Step 1: Append Stage 2 tests**

Append to `services/content-pipeline/src/__tests__/image-cascade.test.ts`, after the existing `describe` block:

```typescript
describe("generateImageWithCascade — Stage 2 (sanitized realism)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
  });

  it("Stage 2 Gemini succeeds → image_stage=2, image_provider=gemini, sanitizer called once", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))   // Stage 1 Gemini
      .mockResolvedValueOnce(ok("stage2-gemini"));                  // Stage 2 Gemini
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400")); // Stage 1 OpenAI
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Clean concept" });

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(2);
      expect(result.result.provider).toBe("gemini");
      expect(result.result.prompt).toContain("Clean concept");
      expect(result.result.prompt.toLowerCase()).toContain("photograph");
    }
    expect(mockSanitize).toHaveBeenCalledTimes(1);
    expect(mockGemini).toHaveBeenCalledTimes(2);
  });

  it("Stage 2 OpenAI succeeds when Stage 2 Gemini fails → image_stage=2, image_provider=openai", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response")) // Stage 1 Gemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response")); // Stage 2 Gemini
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400")) // Stage 1 OpenAI
      .mockResolvedValueOnce(ok("stage2-openai"));            // Stage 2 OpenAI
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Clean concept" });

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(2);
      expect(result.result.provider).toBe("openai");
    }
    expect(mockOpenAI).toHaveBeenCalledTimes(2);
  });

  it("Stage 2 providers get NO transient retry — single attempt each", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response")) // Stage 1 Gemini
      .mockResolvedValueOnce(fail(true, "server_error:500"));     // Stage 2 Gemini — transient, but should NOT retry
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400"))     // Stage 1 OpenAI
      .mockResolvedValueOnce(fail(true, "rate_limited:429"));     // Stage 2 OpenAI — transient, but should NOT retry
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Clean concept" });
    // Stage 3 will run; make it fail too to avoid hitting later tests
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "no_image_in_response"));

    await generateImageWithCascade(INPUT);

    // Stage 1: gemini 1 + openai 1 (permanent, no retry). Stage 2: gemini 1 + openai 1 (transient but no retry). Stage 3: gemini 1 + openai 1.
    expect(mockGemini).toHaveBeenCalledTimes(3);
    expect(mockOpenAI).toHaveBeenCalledTimes(3);
  });

  it("Stage 2 does NOT pass a reference image to Gemini", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(ok("stage2-image"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400"));
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Clean concept" });

    await generateImageWithCascade(INPUT);

    // Second Gemini call (Stage 2) — third arg is reference image
    const stage2Call = mockGemini.mock.calls[1];
    expect(stage2Call).toBeDefined();
    expect(stage2Call![2]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: existing Stage 1 tests still pass; new Stage 2 tests fail (cascade returns `ok: false` after sanitizer succeeds — Stage 2 not yet wired).

- [ ] **Step 3: Wire Stage 2 in `generator.ts`**

In `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`, replace the comment line `// Stage 2 + Stage 3 are implemented in later tasks; for now, return failure.` and the subsequent `return { ok: false, ... };` with:

```typescript
  const stage2Prompt = buildStage2Prompt(sanitized.concept, input.vertical, input.imageGuidelines);

  console.log(`[img-gen] Stage 2: Gemini (sanitized realism) for "${input.articleTitle}"`);
  const stage2Gemini = await runProvider(ctx, 2, "gemini", stage2Prompt, undefined, 1, geminiKey);
  if (stage2Gemini) {
    const optimized = await optimizeImage(stage2Gemini);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage2Prompt,
        provider: "gemini",
        stage: 2,
      },
      attempts,
    };
  }

  console.log(`[img-gen] Stage 2: OpenAI (sanitized realism) for "${input.articleTitle}"`);
  const stage2OpenAI = await runProvider(ctx, 2, "openai", stage2Prompt, undefined, 1, openaiKey);
  if (stage2OpenAI) {
    const optimized = await optimizeImage(stage2OpenAI);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage2Prompt,
        provider: "openai",
        stage: 2,
      },
      attempts,
    };
  }

  // Stage 3 implemented in next task — placeholder failure for now.
  return { ok: false, reason: "image_gen_exhausted", attempts };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: all Stage 1 + Stage 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts services/content-pipeline/src/__tests__/image-cascade.test.ts
git commit -m "feat(image-pipeline): wire Stage 2 (sanitized realism) of cascade"
```

---

## Task 6: Cascade Stage 3 (sanitized illustration)

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`
- Modify: `services/content-pipeline/src/__tests__/image-cascade.test.ts`

- [ ] **Step 1: Append Stage 3 + total-failure tests**

Append to `services/content-pipeline/src/__tests__/image-cascade.test.ts`:

```typescript
describe("generateImageWithCascade — Stage 3 + total failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
  });

  it("Stage 3 Gemini succeeds with illustration prompt → image_stage=3, sanitizer called only once", async () => {
    // Stage 1 (gem + oa) + Stage 2 (gem + oa) all fail; Stage 3 Gemini succeeds.
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(ok("stage3-illustration"));
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400"))
      .mockResolvedValueOnce(fail(false, "client_error:400"));
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Concept X" });

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.stage).toBe(3);
      expect(result.result.provider).toBe("gemini");
      expect(result.result.prompt).toContain("Concept X");
      expect(result.result.prompt.toLowerCase()).toContain("illustration");
    }
    expect(mockSanitize).toHaveBeenCalledTimes(1);
  });

  it("All stages fail → ok:false with full attempts chain across 3 stages", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400"))
      .mockResolvedValueOnce(fail(false, "client_error:400"))
      .mockResolvedValueOnce(fail(false, "client_error:400"));
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Concept X" });

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("image_gen_exhausted");
      // 6 attempts: 3 stages × (gemini + openai)
      expect(result.attempts).toHaveLength(6);
      expect(result.attempts.map((a) => a.stage)).toEqual([1, 1, 2, 2, 3, 3]);
      expect(result.attempts.map((a) => a.provider)).toEqual([
        "gemini", "openai", "gemini", "openai", "gemini", "openai",
      ]);
    }
  });

  it("Sanitizer failure short-circuits Stage 2 and Stage 3", async () => {
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400"));
    mockSanitize.mockResolvedValueOnce({ ok: false, reason: "claude_timeout" });

    const result = await generateImageWithCascade(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // attempts: Stage 1 gemini, Stage 1 openai, sanitizer failure. No Stage 2 or 3 provider calls.
      expect(result.attempts).toEqual([
        { stage: 1, provider: "gemini", reason: "no_image_in_response" },
        { stage: 1, provider: "openai", reason: "client_error:400" },
        { stage: 2, provider: "sanitizer", reason: "claude_timeout" },
      ]);
    }
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
  });

  it("Stage 3 does NOT pass a reference image to Gemini", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(fail(false, "no_image_in_response"))
      .mockResolvedValueOnce(ok("stage3-img"));
    mockOpenAI
      .mockResolvedValueOnce(fail(false, "client_error:400"))
      .mockResolvedValueOnce(fail(false, "client_error:400"));
    mockSanitize.mockResolvedValueOnce({ ok: true, concept: "Concept" });

    await generateImageWithCascade(INPUT);

    const stage3Call = mockGemini.mock.calls[2];
    expect(stage3Call).toBeDefined();
    expect(stage3Call![2]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: existing tests pass; the four new Stage 3 tests fail (cascade still returns `ok: false` immediately after Stage 2 fails).

- [ ] **Step 3: Wire Stage 3 in `generator.ts`**

In `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`, replace the comment line `// Stage 3 implemented in next task — placeholder failure for now.` and the subsequent `return { ok: false, ... };` with:

```typescript
  const stage3Prompt = buildStage3Prompt(sanitized.concept, input.vertical, input.imageGuidelines);

  console.log(`[img-gen] Stage 3: Gemini (sanitized illustration) for "${input.articleTitle}"`);
  const stage3Gemini = await runProvider(ctx, 3, "gemini", stage3Prompt, undefined, 1, geminiKey);
  if (stage3Gemini) {
    const optimized = await optimizeImage(stage3Gemini);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage3Prompt,
        provider: "gemini",
        stage: 3,
      },
      attempts,
    };
  }

  console.log(`[img-gen] Stage 3: OpenAI (sanitized illustration) for "${input.articleTitle}"`);
  const stage3OpenAI = await runProvider(ctx, 3, "openai", stage3Prompt, undefined, 1, openaiKey);
  if (stage3OpenAI) {
    const optimized = await optimizeImage(stage3OpenAI);
    return {
      ok: true,
      result: {
        data: optimized,
        altText: generateAltText(input),
        prompt: stage3Prompt,
        provider: "openai",
        stage: 3,
      },
      attempts,
    };
  }

  // All stages exhausted → caller routes article to review queue.
  console.error(
    `[img-gen] Cascade exhausted for "${input.articleTitle}": ` +
    attempts.map((a) => `${a.stage}/${a.provider}:${a.reason}`).join(", "),
  );
  return { ok: false, reason: "image_gen_exhausted", attempts };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd services/content-pipeline && pnpm test -- image-cascade
```
Expected: all cascade tests pass (Stage 1 + Stage 2 + Stage 3 + total failure).

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts services/content-pipeline/src/__tests__/image-cascade.test.ts
git commit -m "feat(image-pipeline): wire Stage 3 (sanitized illustration) and total-failure path"
```

---

## Task 7: Drop-to-review notification helper

**Files:**
- Modify: `services/content-pipeline/src/lib/notifications.ts`
- Modify: `services/content-pipeline/src/__tests__/notifications.test.ts` (if it exists; otherwise create)

- [ ] **Step 1: Check whether a notifications test file exists**

Run:
```bash
ls services/content-pipeline/src/__tests__/notifications.test.ts 2>/dev/null || echo "MISSING"
```
Expected: either prints the path or `MISSING`. Skip Step 2 if the file exists; create it if missing.

- [ ] **Step 2: Write the failing test**

Create or append to `services/content-pipeline/src/__tests__/notifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { notifyImageDroppedToReview } from "../lib/notifications.js";

describe("notifyImageDroppedToReview", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it("sends a distinctly worded Slack message containing the reason chain", async () => {
    await notifyImageDroppedToReview(
      { slackWebhookUrl: "https://hooks.slack.com/test" },
      {
        article: "Test Article",
        site: "example.com",
        reasonChain: "1/gemini:no_image_in_response, 1/openai:client_error:400",
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.text).toContain("FAILED");
    expect(body.text).toContain("Test Article");
    expect(body.text).toContain("example.com");
    expect(body.text).toContain("review");
    expect(body.text).toContain("1/gemini:no_image_in_response");
  });

  it("does nothing when no notification config is provided", async () => {
    await notifyImageDroppedToReview({}, { article: "T", reasonChain: "x" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd services/content-pipeline && pnpm test -- notifications
```
Expected: FAIL with "`notifyImageDroppedToReview` is not exported" (or similar).

- [ ] **Step 4: Add `notifyImageDroppedToReview` to notifications.ts**

In `services/content-pipeline/src/lib/notifications.ts`, before the `sendTelegram` helper (around line 136), add:

```typescript
/**
 * Send a high-signal alert that an article was sent to the review queue because
 * image generation failed at every cascade stage. Worded distinctly so operators
 * can filter for this event vs the per-stage progress notifications.
 */
export async function notifyImageDroppedToReview(
  config: NotificationConfig,
  params: {
    article: string;
    site?: string;
    reasonChain: string;
  },
): Promise<void> {
  const message =
    `Image generation FAILED for "${params.article}"` +
    (params.site ? ` (${params.site})` : "") +
    ` — article sent to review.\nReason chain: ${params.reasonChain}`;

  await Promise.allSettled([
    config.telegramBotToken ? sendTelegram(config, message) : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd services/content-pipeline && pnpm test -- notifications
```
Expected: both `notifyImageDroppedToReview` tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/lib/notifications.ts services/content-pipeline/src/__tests__/notifications.test.ts
git commit -m "feat(notifications): add notifyImageDroppedToReview helper"
```

---

## Task 8: Wire the agent to the new cascade

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts`

This is the integration step. The agent now (a) calls `generateImageWithCascade` instead of `generateImageWithLadder`, (b) populates `image_provider`, `image_stage`, `image_attempts` in the frontmatter on success, (c) on failure routes the article to review with a `quality_note` and `image_attempts`, no `featuredImage`, and fires `notifyImageDroppedToReview`.

- [ ] **Step 1: Update the import and call site**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, find the import of `generateImageWithLadder` and change it. Look for:

```typescript
import { generateImageWithLadder } from "./image-pipeline/generator.js";
```

Replace with:

```typescript
import { generateImageWithCascade } from "./image-pipeline/generator.js";
import { notifyImageDroppedToReview } from "../../lib/notifications.js";
```

If `notifyImageDroppedToReview` is already imported from somewhere, do not duplicate; otherwise the second line is new.

- [ ] **Step 2: Replace the ladder call and failure handling**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, find the block starting `// Step 4: Image pipeline — four-tier ladder` (around line 528). Replace lines 528 through 562 (the whole `const ladderResult = await generateImageWithLadder(...)` block, the `if (ladderResult.ok)` block, and the `else` warn block) with:

```typescript
    // Step 4: Image pipeline — three-stage cascade
    const cascadeResult = await generateImageWithCascade(
      {
        articleTitle: generated.title,
        articleDescription: generated.description,
        articleSummary: item.summary,
        vertical: item.vertical?.name ?? "General",
        sourceThumbnailUrl: item.thumbnail?.url,
        imageGuidelines: brief.image_guidelines,
      },
      config.notifications,
      siteDomain,
    );

    let pendingImageAsset: PendingAsset | undefined;
    let featuredImageUrl: string | undefined;
    let imageProvider: "gemini" | "openai" | undefined;
    let imageStage: 1 | 2 | 3 | undefined;
    let imageFailureReasonChain: string | undefined;

    if (cascadeResult.ok) {
      const assetPath = `assets/images/${slug}.webp`;
      pendingImageAsset = {
        siteDomain,
        assetPath,
        data: cascadeResult.result.data,
      };
      featuredImageUrl = `/assets/images/${slug}.webp`;
      imageProvider = cascadeResult.result.provider;
      imageStage = cascadeResult.result.stage;
      console.log(
        `[agent] Generated image: ${assetPath} (stage ${imageStage}, ${imageProvider})`,
      );
    } else {
      imageFailureReasonChain = cascadeResult.attempts
        .map((a) => `${a.stage}/${a.provider}:${a.reason}`)
        .join(", ");
      console.warn(
        `[agent] Image cascade exhausted for "${item.title}": ${imageFailureReasonChain}. ` +
        `Routing article to review queue.`,
      );
      if (config.notifications) {
        void notifyImageDroppedToReview(config.notifications, {
          article: generated.title,
          site: siteDomain,
          reasonChain: imageFailureReasonChain,
        });
      }
    }
```

- [ ] **Step 3: Force `status: review` and set `quality_note` on image-drop**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, find the block where `articleStatus` is set after quality scoring (around line 583-613). After the quality-scoring `try/catch` block and BEFORE the `// Step 9: Build frontmatter` comment, insert:

```typescript
    // If the image cascade failed, force the article to review regardless of quality score.
    if (imageFailureReasonChain) {
      articleStatus = "review";
      const imageNote = `image generation failed after 3 stages: ${imageFailureReasonChain}`;
      qualityNote = qualityNote ? `${qualityNote} | ${imageNote}` : imageNote;
    }
```

- [ ] **Step 4: Add the new fields to the frontmatter object**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, find the `const frontmatter: ArticleFrontmatterWithExtras = { ... }` block (around line 618). Add three new optional spreads right after the `...(featuredImageUrl ? { featuredImage: featuredImageUrl } : {}),` line. The block should now read:

```typescript
    const frontmatter: ArticleFrontmatterWithExtras = {
      title: generated.title,
      description: seo.metaDescription,
      type: articleType,
      status: articleStatus,
      publishDate,
      author: author || "Editorial Team",
      tags,
      slug,
      reviewer_notes: articleStatus === "review" ? (qualityNote ?? "") : "",
      source_url: item.url,
      source_item_id: item.id,
      generated_by: actualGenerator,
      ...(featuredImageUrl ? { featuredImage: featuredImageUrl } : {}),
      ...(imageProvider ? { image_provider: imageProvider } : {}),
      ...(imageStage ? { image_stage: imageStage } : {}),
      ...(cascadeResult.attempts.length > 0 ? { image_attempts: cascadeResult.attempts } : {}),
      ...(qualityScore !== undefined ? { quality_score: qualityScore } : {}),
      ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
      ...(qualityNote ? { quality_note: qualityNote } : {}),
      ...(seo.readingTime ? { reading_time: seo.readingTime } : {}),
    };
```

- [ ] **Step 5: Typecheck the package**

Run:
```bash
cd services/content-pipeline && pnpm typecheck
```
Expected: no errors. If there are errors, they should be obviously local to this task's edits — fix in place.

- [ ] **Step 6: Run the full content-pipeline test suite**

Run:
```bash
cd services/content-pipeline && pnpm test
```
Expected: all tests pass — including the existing `agent.test.ts`, the new `image-cascade.test.ts`, `sanitizer.test.ts`, and `notifications.test.ts`. The pre-existing `agent.test.ts` mocks `generateImageWithLadder` — it will need updating in the next step if it now fails.

- [ ] **Step 7: If `agent.test.ts` failed, update its mock to the new function name**

Open `services/content-pipeline/src/__tests__/agent.test.ts`. Search for `generateImageWithLadder`. If found, replace every occurrence with `generateImageWithCascade`. Also update the mock return value to the new shape: the success case must include `provider: "gemini"` and `stage: 1` and `attempts: [{ stage: 1, provider: "gemini", reason: "ok" }]`.

Find the existing mock — it likely looks like:
```typescript
vi.mock("../agents/content-generation/image-pipeline/generator.js", () => ({
  generateImageWithLadder: vi.fn().mockResolvedValue({
    ok: true,
    result: { data: Buffer.from("img"), altText: "Alt", prompt: "p" },
  }),
}));
```

Replace with:
```typescript
vi.mock("../agents/content-generation/image-pipeline/generator.js", () => ({
  generateImageWithCascade: vi.fn().mockResolvedValue({
    ok: true,
    result: {
      data: Buffer.from("img"),
      altText: "Alt",
      prompt: "p",
      provider: "gemini",
      stage: 1,
    },
    attempts: [{ stage: 1, provider: "gemini", reason: "ok" }],
  }),
}));
```

Re-run `pnpm test` after editing. Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/__tests__/agent.test.ts
git commit -m "feat(agent): wire image cascade — record provenance, route failures to review"
```

---

## Task 9: Final verification

**Files:** (no edits — verification only)

- [ ] **Step 1: Run the full test suite from the package root**

Run:
```bash
cd services/content-pipeline && pnpm test
```
Expected: all tests pass. Specifically the following test files must all be green:
- `image-cascade.test.ts` — cascade behavior
- `sanitizer.test.ts` — sanitizer
- `notifications.test.ts` — notify helper
- `agent.test.ts` — agent integration
- All other pre-existing tests

- [ ] **Step 2: Typecheck the whole monorepo**

Run from the repo root:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform && pnpm -r typecheck
```
Expected: no TypeScript errors anywhere. If shared-types changes broke a consumer outside the content-pipeline, fix the import path.

- [ ] **Step 3: Confirm the old function is fully removed**

Run:
```bash
grep -rn "generateImageWithLadder\|ImageLadderResult\|ImageLadderAttemptLog" services/content-pipeline/src/ packages/ 2>/dev/null || echo "CLEAN"
```
Expected: `CLEAN` (no matches). If matches appear, replace them with the new names (`generateImageWithCascade`, `ImageCascadeResult`, `ImageCascadeAttemptLog`).

- [ ] **Step 4: Confirm thumbnail-fallback code is fully removed**

Run:
```bash
grep -n "downloadThumbnailBuffer\|Tier C\|source thumbnail.*fallback" services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts || echo "CLEAN"
```
Expected: `CLEAN`. The only remaining thumbnail reference should be `fetchThumbnail` used as a Stage 1 *reference image* for Gemini.

- [ ] **Step 5: Final summary commit (only if any cleanup was needed)**

If Steps 3 or 4 required edits, commit them:
```bash
git add -A
git commit -m "chore(image-pipeline): remove leftover ladder/thumbnail-fallback references"
```

If no edits were needed, skip this commit.

- [ ] **Step 6: Push the branch**

Run:
```bash
git push -u origin feat/image-cascade-redesign
```
Expected: branch pushed; output includes a PR-creation URL.

---

## Self-review notes

**Spec coverage check:**
- Cascade structure (Stage 1/2/3) → Tasks 4, 5, 6
- Stage 1 OpenAI transient retry (bug fix) → Task 4, Step 4 (`runProvider` uses `maxAttempts=2` for OpenAI; tests in Step 2)
- Sanitizer module → Task 3
- Sanitizer cached for Stage 3 → Task 6 implementation reuses `sanitized.concept` directly (verified by "sanitizer called only once" test)
- Frontmatter fields `image_provider` / `image_stage` / `image_attempts` → Task 1 (types) + Task 8 (population)
- Drop-to-review: `status=review`, `quality_note`, no `featuredImage` → Task 8 Steps 4 and 5
- Source thumbnail fallback removed → Task 4 (new generator.ts has no `downloadThumbnailBuffer`); verified in Task 9 Step 4
- Per-stage notifications reused → Task 4 (`runProvider` calls `notifyImageGeneration`)
- New drop-to-review notification → Task 7
- Reference image attached to Stage 1 Gemini only → Task 4 Step 4 (`runProvider(..., 1, "gemini", ..., reference, ...)` passes reference only for Stage 1 Gemini, `undefined` otherwise) + tests in Tasks 5/6 assert this

**Type consistency:** the cascade uses `ImageCascadeResult` / `ImageCascadeAttemptLog` / `ImageStage` consistently. The agent uses `imageProvider`/`imageStage` local variables matching the frontmatter field names. The notification helper takes a string `reasonChain` (not the structured attempts array) — the agent formats it before calling.

**Out-of-scope reminders:**
- No review-queue UI changes (sub-project #2)
- No backfill of existing articles
- No new providers (FLUX/Qwen)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-image-cascade-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with isolated context per step.

**2. Inline Execution** — I execute tasks in this session using the executing-plans skill, batched with checkpoints for review.

Which approach?
