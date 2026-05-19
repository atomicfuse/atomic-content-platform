# Async Image Generation via n8n Webhook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Gemini/OpenAI image generation ladder with an async n8n webhook flow — articles are created immediately with a per-site default image, and real images arrive asynchronously via n8n without blocking article creation.

**Architecture:** Article creation in `processItem()` no longer calls `generateImageWithLadder()`. Instead, articles commit with `featuredImage` pointing to the site's existing R2 default (`{site-slug}-general-article`). After each article is committed, an n8n webhook request fires in the background. n8n returns the image inline (base64 in the HTTP response, ~46s). A background handler decodes the image, optimizes it, uploads to R2, and updates the article's Git frontmatter. If n8n fails or times out, a Slack alert fires and the article keeps the default image.

**Tech Stack:** Node.js, ioredis/BullMQ (existing), n8n webhook (external), sharp (existing image optimizer), Cloudflare R2 (existing), Octokit (existing Git client)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `services/content-pipeline/src/agents/content-generation/n8n-image.ts` | **Create** | n8n webhook client: `requestImageFromN8n()` fires POST, parses inline response. `processN8nImageResult()` optimizes + R2 upload + Git frontmatter update. |
| `services/content-pipeline/src/agents/content-generation/agent.ts` | **Modify** | Remove `generateImageWithLadder` call from `processItem()`. Set default image. Fire n8n request in background after batch commit. |
| `services/content-pipeline/src/lib/notifications.ts` | **Modify** | Add `notifyImageDefaultFallback()` — Slack alert when n8n fails for an article. |
| `services/content-pipeline/src/lib/config.ts` | **Modify** | Add `n8nImageWebhookUrl` to `AgentConfig` (env: `N8N_IMAGE_WEBHOOK_URL`). |
| `services/content-pipeline/src/__tests__/n8n-image.test.ts` | **Create** | Tests for n8n client: successful response, timeout, error, base64 decoding, Git update. |
| `services/content-pipeline/src/__tests__/agent-default-image.test.ts` | **Create** | Tests that `processItem` uses default image, does not call old image pipeline. |
| `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts` | **Delete** | Old Gemini→OpenAI ladder — replaced by n8n. |
| `services/content-pipeline/src/agents/content-generation/image-pipeline/analyzer.ts` | **Delete** | GPT-4o-mini thumbnail analysis — unused, not needed by n8n flow. |
| `services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts` | **Delete** | Old image pipeline types — replaced by n8n response types in `n8n-image.ts`. |
| `services/content-pipeline/src/lib/gemini.ts` | **Keep** | Still used by `agents/migration/orchestrator.ts` for WordPress migration image generation. Only the content-generation agent moves to n8n. |
| `services/content-pipeline/src/lib/openai-image.ts` | **Delete** | OpenAI image REST API client — only used by the old ladder. |
| `services/content-pipeline/src/__tests__/image-ladder.test.ts` | **Delete** | Tests for the old ladder. |
| `services/content-pipeline/src/__tests__/openai-image.test.ts` | **Delete** | Tests for OpenAI image client. |
| `services/content-pipeline/src/lib/notifications.ts` | **Modify** | Remove `notifyImageGeneration()` (dead code after ladder deletion). |

---

## Key Design Decisions

### Default image path

Per-site default images already exist in R2 with the naming convention `{site-slug}-general-article` (e.g., `financenewsbase-general-article`). The article frontmatter will reference this as:

```
featuredImage: /assets/images/{site-slug}-general-article.webp
```

The R2 key is `{site-slug}/assets/images/{site-slug}-general-article.webp`. These images are already uploaded — no code needed to create them.

### n8n webhook contract

**Request** (POST to `https://atomics.app.n8n.cloud/webhook/acn-image-generation`):
```json
{
  "request_id": "img_<nanoid>",
  "callback_url": "https://content-pipeline-app.apps.cloudgrid.io/image-callback",
  "site_domain": "muvizzcom",
  "slug": "cannes-2026-most-anticipated-films",
  "article": {
    "title": "Cannes 2026: 9 Must-Watch Films...",
    "description": "From Diego Luna's immigration drama...",
    "summary": "The 79th Cannes Film Festival opens...",
    "vertical": "Entertainment",
    "source_thumbnail_url": "https://example.com/img.jpg",
    "image_guidelines": null
  }
}
```

**Response** (inline, ~46s):
```json
{
  "request_id": "img_...",
  "status": "ok",
  "delivery": "inline",
  "mime_type": "image/jpeg",
  "data_base64": "/9j/4AAQ...",
  "alt_text": "Description of the generated image.",
  "meta": {
    "provider": "gemini-3.1-flash-image-preview",
    "prompt": "...",
    "duration_ms": 46000,
    "attempts": [{ "provider": "...", "reason": null, "ok": true, "attempt": 1 }]
  }
}
```

**Error response** (n8n returns non-200, or `status !== "ok"`):
The article keeps the default image. Slack alert fires.

### Background processing flow

After `writeArticleBatch()` commits all articles to Git, the agent fires n8n requests concurrently (max 5 in flight) using the existing `processWithConcurrency` utility. Each request:

1. POST to n8n webhook (90s timeout — headroom over ~46s typical)
2. Decode `data_base64` → Buffer
3. `optimizeImage()` (existing sharp pipeline — resize, WebP quality ladder)
4. `uploadToR2()` (existing — `{domain}/assets/images/{slug}.webp`)
5. Update article frontmatter in Git: `featuredImage: /assets/images/{slug}.webp`, add `image_alt` from n8n response
6. On failure: `notifyImageDefaultFallback()` → Slack

Git updates are individual `commitFile` calls (not batched) because they trickle in asynchronously. Each commit message: `feat(content): add generated image for {slug}`.

### What `runContentGeneration` returns

The function returns as soon as articles are committed (with default images). Image generation runs in the background — the caller (BullMQ worker or direct HTTP) does not wait for images. The `BatchContentGenerationResult` response is unchanged.

### Local dev mode

n8n image generation only fires when `branch` is set (i.e., GitHub mode). In local dev mode (`LOCAL_NETWORK_PATH` set, no branch), articles are written to local disk and n8n is **not** triggered. This respects the `shouldWriteLocal()` invariant in `writer.ts` — the background handler commits to Git, which would conflict with local-only workflows.

### `gemini.ts` is kept alive

The WordPress migration orchestrator (`agents/migration/orchestrator.ts`) imports `generateImageWithGemini` directly. That's a separate subsystem with a different image flow — it is not part of this change. `gemini.ts` stays. Only the content-generation agent's dependency on it (via `generator.ts`) is removed.

### Known limitations

**Fire-and-forget has no recovery.** The `void processWithConcurrency(...)` call is a background promise that is not tracked by BullMQ. If the worker process exits during a deployment or crash while n8n requests are in-flight, those image deliveries are silently lost. Articles keep the default image with no alert.

The risk window is ~46s after each content generation job completes (the time for the last n8n request to resolve). In practice this is acceptable: articles are functional with the default image, and n8n's own execution logs show which requests were sent. A future improvement could add a dedicated BullMQ "image-delivery" queue for persistence and retry.

---

## Tasks

### Task 1: Add `n8nImageWebhookUrl` to AgentConfig

**Files:**
- Modify: `services/content-pipeline/src/lib/config.ts:7-51`

- [ ] **Step 1: Add field to AgentConfig interface**

In `config.ts`, add `n8nImageWebhookUrl` to the `AgentConfig` interface:

```typescript
export interface AgentConfig {
  github: GitHubConfig;
  networkRepo: string;
  localNetworkPath: string | undefined;
  geminiApiKey: string | undefined;
  contentAggregatorUrl: string;
  port: number;
  redisUrl?: string;
  n8nImageWebhookUrl?: string;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
}
```

- [ ] **Step 2: Load from env in loadConfig()**

In the `loadConfig()` return object, add:

```typescript
n8nImageWebhookUrl: process.env.N8N_IMAGE_WEBHOOK_URL,
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS (no consumers use the field yet)

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/lib/config.ts
git commit -m "feat(config): add N8N_IMAGE_WEBHOOK_URL to AgentConfig"
```

---

### Task 2: Add `notifyImageDefaultFallback` to notifications

**Files:**
- Modify: `services/content-pipeline/src/lib/notifications.ts:96-134`

- [ ] **Step 1: Add the notification function**

Add after the existing `notifyImageGeneration` function (after line 134):

```typescript
/**
 * Send a notification when n8n image generation fails and the article
 * falls back to the default site image.
 */
export async function notifyImageDefaultFallback(
  config: NotificationConfig,
  params: {
    site: string;
    articleTitle: string;
    slug: string;
    reason: string;
  },
): Promise<void> {
  const articleUrl = `https://${params.site}/articles/${params.slug}`;
  const message =
    `⚠️ Image generation failed for site: ${params.site}\n` +
    `Article: "${params.articleTitle}" (${articleUrl})\n` +
    `Reason: ${params.reason}\n` +
    `The article is using the default site image.`;

  await Promise.allSettled([
    config.telegramBotToken
      ? sendTelegram(config, message)
      : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/lib/notifications.ts
git commit -m "feat(notifications): add image default fallback alert"
```

---

### Task 3: Create n8n image client with tests (TDD)

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/n8n-image.ts`
- Create: `services/content-pipeline/src/__tests__/n8n-image.test.ts`

This is the core new module. It has two functions:
- `requestImageFromN8n()` — POST to webhook, parse response
- `processN8nImageResult()` — optimize + R2 upload + Git frontmatter update

- [ ] **Step 1: Write the test file**

```typescript
// services/content-pipeline/src/__tests__/n8n-image.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockOptimizeImage = vi.fn<(buf: Buffer) => Promise<Buffer>>();
vi.mock("../lib/image-optimizer.js", () => ({
  optimizeImage: (buf: Buffer): Promise<Buffer> => mockOptimizeImage(buf),
}));

const mockUploadToR2 = vi.fn<(key: string, data: Buffer, ct?: string) => Promise<boolean>>();
vi.mock("../lib/r2-upload.js", () => ({
  uploadToR2: (key: string, data: Buffer, ct?: string): Promise<boolean> =>
    mockUploadToR2(key, data, ct),
  buildR2Key: (siteId: string, slug: string, ext: string): string =>
    `${siteId}/assets/images/${slug}.${ext}`,
}));

const mockCommitFile = vi.fn();
const mockReadFile = vi.fn();
vi.mock("../lib/github.js", () => ({
  createGitHubClient: () => "mock-octokit",
  commitFile: (...args: unknown[]) => mockCommitFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Stub fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  requestImageFromN8n,
  processN8nImageResult,
  type N8nImageRequest,
  type N8nImageResponse,
} from "../agents/content-generation/n8n-image.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_REQUEST: N8nImageRequest = {
  webhookUrl: "https://atomics.app.n8n.cloud/webhook/acn-image-generation",
  requestId: "img_test123",
  siteDomain: "travelswire",
  slug: "best-travel-destinations",
  article: {
    title: "Best Travel Destinations 2026",
    description: "Top picks for travelers this year.",
    summary: "A roundup of the best destinations.",
    vertical: "Travel",
    source_thumbnail_url: undefined,
    image_guidelines: null,
  },
  callbackUrl: "https://content-pipeline-app.apps.cloudgrid.io/image-callback",
};

function makeOkResponse(): N8nImageResponse {
  return {
    request_id: "img_test123",
    status: "ok",
    delivery: "inline",
    mime_type: "image/jpeg",
    data_base64: Buffer.from("fake-image-bytes").toString("base64"),
    alt_text: "A beautiful travel destination.",
    meta: {
      provider: "gemini-3.1-flash-image-preview",
      prompt: "test prompt",
      duration_ms: 46000,
      attempts: [{ provider: "gemini-3.1-flash-image-preview", reason: null, ok: true, attempt: 1 }],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: requestImageFromN8n
// ---------------------------------------------------------------------------
describe("requestImageFromN8n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with decoded image buffer on 200 + status ok", async () => {
    const n8nResponse = makeOkResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(n8nResponse),
    });

    const result = await requestImageFromN8n(BASE_REQUEST);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.toString()).toBe("fake-image-bytes");
      expect(result.altText).toBe("A beautiful travel destination.");
      expect(result.meta.provider).toBe("gemini-3.1-flash-image-preview");
    }

    // Verify POST payload
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(BASE_REQUEST.webhookUrl);
    const body = JSON.parse(init.body as string);
    expect(body.request_id).toBe("img_test123");
    expect(body.slug).toBe("best-travel-destinations");
    expect(body.article.title).toBe("Best Travel Destinations 2026");
  });

  it("returns failure when n8n returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("n8n error"),
    });

    const result = await requestImageFromN8n(BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("500");
    }
  });

  it("returns failure when n8n response has status !== ok", async () => {
    const n8nResponse = { ...makeOkResponse(), status: "error" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(n8nResponse),
    });

    const result = await requestImageFromN8n(BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("status: error");
    }
  });

  it("returns failure on fetch timeout", async () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    mockFetch.mockRejectedValueOnce(err);

    const result = await requestImageFromN8n(BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("timeout");
    }
  });

  it("returns failure when data_base64 is missing", async () => {
    const n8nResponse = { ...makeOkResponse(), data_base64: "" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(n8nResponse),
    });

    const result = await requestImageFromN8n(BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("empty image data");
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: processN8nImageResult
// ---------------------------------------------------------------------------
describe("processN8nImageResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOptimizeImage.mockImplementation((buf) => Promise.resolve(buf));
    mockUploadToR2.mockResolvedValue(true);
    // Mock readFile to return an existing article with default image
    mockReadFile.mockResolvedValue(
      [
        "---",
        "title: Best Travel Destinations 2026",
        "featuredImage: /assets/images/travelswire-general-article.webp",
        "---",
        "Article body here.",
      ].join("\n"),
    );
    mockCommitFile.mockResolvedValue(undefined);
  });

  it("optimizes image, uploads to R2, and updates Git frontmatter", async () => {
    const imageData = Buffer.from("optimized-image");

    await processN8nImageResult({
      siteDomain: "travelswire",
      slug: "best-travel-destinations",
      imageData,
      altText: "A beautiful travel destination.",
      branch: "staging/travelswire",
      github: { token: "test-token", repo: "atomicfuse/atomic-labs-network" },
    });

    // Verify optimize was called
    expect(mockOptimizeImage).toHaveBeenCalledWith(imageData);

    // Verify R2 upload
    expect(mockUploadToR2).toHaveBeenCalledWith(
      "travelswire/assets/images/best-travel-destinations.webp",
      imageData,
      "image/webp",
    );

    // Verify Git frontmatter update
    expect(mockCommitFile).toHaveBeenCalledTimes(1);
    const [, , commitArgs] = mockCommitFile.mock.calls[0]!;
    expect(commitArgs.path).toBe("sites/travelswire/articles/best-travel-destinations.md");
    expect(commitArgs.content).toContain("featuredImage: /assets/images/best-travel-destinations.webp");
    expect(commitArgs.content).toContain("image_alt: A beautiful travel destination.");
    expect(commitArgs.branch).toBe("staging/travelswire");
  });

  it("skips Git update if R2 upload fails", async () => {
    mockUploadToR2.mockResolvedValue(false);

    await processN8nImageResult({
      siteDomain: "travelswire",
      slug: "best-travel-destinations",
      imageData: Buffer.from("img"),
      altText: "alt",
      branch: "staging/travelswire",
      github: { token: "t", repo: "r" },
    });

    expect(mockCommitFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && npx vitest run src/__tests__/n8n-image.test.ts`
Expected: FAIL — module `n8n-image.ts` does not exist yet

- [ ] **Step 3: Write the n8n-image module**

```typescript
// services/content-pipeline/src/agents/content-generation/n8n-image.ts
/**
 * n8n Image Generation Client — async webhook-based image generation.
 *
 * Replaces the old Gemini → OpenAI → thumbnail ladder. Articles are created
 * with a default site image; this module fires n8n webhooks that return
 * generated images inline. Results are processed in the background:
 * optimize → R2 upload → Git frontmatter update.
 */

import matter from "gray-matter";
import { optimizeImage } from "../../lib/image-optimizer.js";
import { uploadToR2, buildR2Key } from "../../lib/r2-upload.js";
import { createGitHubClient, readFile, commitFile } from "../../lib/github.js";
import type { GitHubConfig } from "../../lib/github.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface N8nImageRequest {
  webhookUrl: string;
  requestId: string;
  siteDomain: string;
  slug: string;
  article: {
    title: string;
    description: string;
    summary: string;
    vertical: string;
    source_thumbnail_url?: string;
    image_guidelines: string | string[] | null;
  };
  callbackUrl: string;
}

export interface N8nImageResponse {
  request_id: string;
  status: string;
  delivery: string;
  mime_type: string;
  data_base64: string;
  alt_text: string;
  meta: {
    provider: string;
    prompt: string;
    duration_ms: number;
    attempts: Array<{
      provider: string;
      reason: string | null;
      ok: boolean;
      attempt: number;
    }>;
  };
}

export type N8nRequestResult =
  | { ok: true; data: Buffer; altText: string; meta: N8nImageResponse["meta"] }
  | { ok: false; reason: string };

/** Timeout for the n8n webhook call (90s — headroom over ~46s typical). */
const N8N_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Webhook client
// ---------------------------------------------------------------------------

/**
 * POST to the n8n image generation webhook and wait for the inline response.
 *
 * n8n generates the image (using whatever provider is configured in the
 * workflow) and returns it as base64 in the response body.
 */
export async function requestImageFromN8n(
  req: N8nImageRequest,
): Promise<N8nRequestResult> {
  try {
    const response = await fetch(req.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: req.requestId,
        callback_url: req.callbackUrl,
        site_domain: req.siteDomain,
        slug: req.slug,
        article: req.article,
      }),
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        ok: false,
        reason: `n8n returned ${response.status} ${response.statusText}: ${errorText.slice(0, 200)}`,
      };
    }

    const body = (await response.json()) as N8nImageResponse;

    if (body.status !== "ok") {
      return { ok: false, reason: `n8n status: ${body.status}` };
    }

    if (!body.data_base64) {
      return { ok: false, reason: "n8n returned empty image data" };
    }

    const imageBuffer = Buffer.from(body.data_base64, "base64");

    return {
      ok: true,
      data: imageBuffer,
      altText: body.alt_text ?? `Image for: ${req.article.title}`,
      meta: body.meta,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      return { ok: false, reason: `n8n webhook timeout (${N8N_TIMEOUT_MS}ms)` };
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Result processor — optimize + R2 + Git
// ---------------------------------------------------------------------------

export interface ProcessImageParams {
  siteDomain: string;
  slug: string;
  imageData: Buffer;
  altText: string;
  branch: string;
  github: GitHubConfig;
}

/**
 * Process a successful n8n image response:
 * 1. Optimize image (resize + WebP conversion via sharp)
 * 2. Upload to R2
 * 3. Update article frontmatter in Git (swap default image → real image)
 */
export async function processN8nImageResult(
  params: ProcessImageParams,
): Promise<void> {
  const { siteDomain, slug, imageData, altText, branch, github } = params;

  // Step 1: Optimize
  const optimized = await optimizeImage(imageData);

  // Step 2: Upload to R2
  const r2Key = buildR2Key(siteDomain, slug, "webp");
  const uploaded = await uploadToR2(r2Key, optimized, "image/webp");

  if (!uploaded) {
    console.error(`[n8n-image] R2 upload failed for ${r2Key} — skipping Git update`);
    return;
  }

  // Step 3: Update article frontmatter in Git
  const articlePath = `sites/${siteDomain}/articles/${slug}.md`;
  const octokit = createGitHubClient(github);

  const raw = await readFile(octokit, github.repo, articlePath, branch);
  const { data: frontmatter, content: body } = matter(raw);

  frontmatter.featuredImage = `/assets/images/${slug}.webp`;
  frontmatter.image_alt = altText;

  const updated = matter.stringify(body, frontmatter);

  await commitFile(octokit, github.repo, {
    path: articlePath,
    content: updated,
    message: `feat(content): add generated image for ${slug}`,
    branch,
  });

  console.log(`[n8n-image] Image delivered for ${siteDomain}/${slug} (${(optimized.length / 1024).toFixed(0)} KB)`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && npx vitest run src/__tests__/n8n-image.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/n8n-image.ts \
      services/content-pipeline/src/__tests__/n8n-image.test.ts
git commit -m "feat(n8n-image): add webhook client and result processor with tests"
```

---

### Task 4: Modify `processItem()` to use default image + fire n8n webhook

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:31,529-562,830-866`

This is the critical change: decouple image generation from article creation.

- [ ] **Step 1: Replace the image-pipeline import with n8n-image import**

At the top of `agent.ts`, change:

```typescript
// Remove this line:
import { generateImageWithLadder } from "./image-pipeline/generator.js";

// Add this line:
import { requestImageFromN8n, processN8nImageResult } from "./n8n-image.js";
import { notifyImageDefaultFallback } from "../../lib/notifications.js";
```

Also add `crypto` import for request IDs:

```typescript
import { randomUUID } from "node:crypto";
```

- [ ] **Step 2: Replace image generation block in `processItem()` (lines 528–562)**

Replace the entire `// Step 4: Image pipeline` block with:

```typescript
    // Step 4: Default image — real image generated async by n8n after commit
    const defaultImagePath = `/assets/images/${siteDomain}-general-article.webp`;
    const featuredImageUrl = defaultImagePath;
```

Remove the `let pendingImageAsset` and `let featuredImageUrl` declarations above this block. The `featuredImageUrl` is now a const.

- [ ] **Step 3: Remove `_pendingAsset` from the return value and the interface**

In `ContentGenerationResult`, remove the `_pendingAsset` field from the interface:

```typescript
  // Remove this line from ContentGenerationResult:
  // _pendingAsset?: PendingAsset;
```

Also remove the `PendingAsset` import if it's no longer used anywhere in `agent.ts`.

In the `processItem` return statement (around line 645), remove `_pendingAsset`:

```typescript
    return {
      status: "created",
      slug,
      path: filePath,
      qualityScore,
      articleStatus,
      generatedBy: actualGenerator,
      _pendingArticle: { siteDomain, slug, content: markdown },
      // _pendingAsset removed — images handled async by n8n
    };
```

- [ ] **Step 4: Add n8n image request metadata to the return type**

Add to `ContentGenerationResult` interface:

```typescript
export interface ContentGenerationResult {
  // ... existing fields ...
  /** @internal n8n image request data — used to fire background image generation. */
  _imageRequest?: {
    requestId: string;
    siteDomain: string;
    slug: string;
    articleTitle: string;
    articleDescription: string;
    articleSummary: string;
    vertical: string;
    sourceThumbnailUrl?: string;
    imageGuidelines: string | string[] | null;
  };
}
```

- [ ] **Step 5: Populate `_imageRequest` in the `processItem` return**

Add to the return object:

```typescript
      _imageRequest: {
        requestId: `img_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        siteDomain,
        slug,
        articleTitle: generated.title,
        articleDescription: generated.description,
        articleSummary: item.summary,
        vertical: item.vertical?.name ?? "General",
        sourceThumbnailUrl: item.thumbnail?.url,
        imageGuidelines: brief.image_guidelines ?? null,
      },
```

- [ ] **Step 6: Add background image generation after `writeArticleBatch()` in `runContentGeneration()` (after line 866)**

After the `writeArticleBatch()` call and before the `cleanResults` line, add the background n8n image generation:

```typescript
    // Step 7: Fire n8n image generation in the background (non-blocking).
    // Only in GitHub mode (branch set) — local dev mode writes to disk,
    // and the background handler commits to Git which would conflict.
    if (config.n8nImageWebhookUrl && branch) {
      const imageRequests = created
        .filter((r) => r._imageRequest)
        .map((r) => r._imageRequest!);

      if (imageRequests.length > 0) {
        const webhookUrl = config.n8nImageWebhookUrl;
        const callbackUrl = "https://content-pipeline-app.apps.cloudgrid.io/image-callback";
        const github = config.github;
        const notifications = config.notifications;
        const effectiveBranch = branch ?? `staging/${siteDomain}`;

        console.log(`[agent] Firing ${imageRequests.length} n8n image request(s) in background`);

        // Fire-and-forget — don't await. Images arrive asynchronously.
        void processWithConcurrency(
          imageRequests,
          5, // max 5 concurrent n8n requests
          imageRequests.length,
          async (req) => {
            const result = await requestImageFromN8n({
              webhookUrl,
              requestId: req.requestId,
              siteDomain: req.siteDomain,
              slug: req.slug,
              article: {
                title: req.articleTitle,
                description: req.articleDescription,
                summary: req.articleSummary,
                vertical: req.vertical,
                source_thumbnail_url: req.sourceThumbnailUrl,
                image_guidelines: req.imageGuidelines,
              },
              callbackUrl,
            });

            if (result.ok) {
              await processN8nImageResult({
                siteDomain: req.siteDomain,
                slug: req.slug,
                imageData: result.data,
                altText: result.altText,
                branch: effectiveBranch,
                github,
              });
            } else {
              console.error(`[agent] n8n image failed for ${req.slug}: ${result.reason}`);
              void notifyImageDefaultFallback(notifications, {
                site: req.siteDomain,
                articleTitle: req.articleTitle,
                slug: req.slug,
                reason: result.reason,
              });
            }

            return result.ok;
          },
          () => true, // process all items, don't stop early
        );
      }
    }
```

- [ ] **Step 7: Clean up — remove `pendingAssets` from the batch write call**

In the `writeArticleBatch` call (around line 860), change the assets parameter to empty:

```typescript
      await writeArticleBatch(
        { localNetworkPath: config.localNetworkPath, github: config.github, branch },
        pendingArticles,
        [], // images handled async by n8n — no pending assets
        commitMsg,
        [dedupIndexFile],
      );
```

And remove the `pendingAssets` collection above it:

```typescript
      // Remove these lines:
      const pendingAssets = created
        .map((r) => r._pendingAsset)
        .filter((a): a is PendingAsset => !!a);
```

- [ ] **Step 8: Strip `_imageRequest` from API response**

Update the `cleanResults` line to strip `_imageRequest` (note: `_pendingAsset` was removed from the interface in Step 3):

```typescript
    const cleanResults = results.map(({ _pendingArticle, _imageRequest, ...rest }) => rest);
```

- [ ] **Step 9: Run typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts
git commit -m "feat(agent): replace image ladder with async n8n webhook flow"
```

---

### Task 5: Delete old image generation code

**Important:** `gemini.ts` is **kept** — it's still imported by `agents/migration/orchestrator.ts:15` for WordPress migration. Only the content-generation agent's ladder is removed.

**Files:**
- Delete: `services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts`
- Delete: `services/content-pipeline/src/agents/content-generation/image-pipeline/analyzer.ts`
- Delete: `services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts`
- Delete: `services/content-pipeline/src/lib/openai-image.ts`
- Delete: `services/content-pipeline/src/__tests__/image-ladder.test.ts`
- Delete: `services/content-pipeline/src/__tests__/openai-image.test.ts`
- Modify: `services/content-pipeline/src/lib/notifications.ts` (remove dead `notifyImageGeneration`)

- [ ] **Step 1: Delete the files**

```bash
rm services/content-pipeline/src/agents/content-generation/image-pipeline/generator.ts
rm services/content-pipeline/src/agents/content-generation/image-pipeline/analyzer.ts
rm services/content-pipeline/src/agents/content-generation/image-pipeline/types.ts
rm services/content-pipeline/src/lib/openai-image.ts
rm services/content-pipeline/src/__tests__/image-ladder.test.ts
rm services/content-pipeline/src/__tests__/openai-image.test.ts
```

Note: `gemini.ts` and `gemini.test.ts` are **kept** (used by migration orchestrator).

- [ ] **Step 2: Check if the `image-pipeline/` directory is now empty and can be removed**

```bash
ls services/content-pipeline/src/agents/content-generation/image-pipeline/
```

If empty, remove it:

```bash
rmdir services/content-pipeline/src/agents/content-generation/image-pipeline
```

- [ ] **Step 3: Check for any remaining imports of deleted modules**

Search for `from.*openai-image`, `from.*image-pipeline/generator`, `from.*image-pipeline/analyzer`, `from.*image-pipeline/types` across the codebase. If any remain (other than in `agent.ts` which was already updated in Task 4), fix them.

Note: `from.*gemini` will still appear in `orchestrator.ts` — that's expected and correct.

- [ ] **Step 4: Remove `notifyImageGeneration` from notifications.ts**

The `notifyImageGeneration` function (lines 101-134 in `notifications.ts`) is now dead code — its only caller was `generator.ts` which is deleted. Remove the function entirely.

- [ ] **Step 5: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Verify tests pass**

Run: `cd services/content-pipeline && pnpm test`
Expected: PASS — deleted tests are gone, remaining tests still pass. The `process-generate-job.test.ts` and `agent.test.ts` tests may need mock updates if they reference the old image pipeline.

- [ ] **Step 7: Commit**

```bash
git add -A services/content-pipeline/src/agents/content-generation/image-pipeline/ \
        services/content-pipeline/src/lib/openai-image.ts \
        services/content-pipeline/src/lib/notifications.ts \
        services/content-pipeline/src/__tests__/image-ladder.test.ts \
        services/content-pipeline/src/__tests__/openai-image.test.ts
git commit -m "refactor: remove old image ladder code (keep gemini.ts for migration)"
```

---

### Task 6: Fix remaining tests that mock the old image pipeline

**Files:**
- Modify: `services/content-pipeline/src/__tests__/agent.test.ts`
- Modify: `services/content-pipeline/src/__tests__/process-generate-job.test.ts`

These tests mock `generateImageWithLadder` which no longer exists. They need to:
1. Remove the old mock
2. Mock `requestImageFromN8n` if the test exercises the background image path (unlikely — these tests mostly focus on article creation logic)
3. Verify articles now have the default image path in frontmatter

- [ ] **Step 1: Read the existing test files to identify what needs changing**

Read `agent.test.ts` and `process-generate-job.test.ts`. Find all references to `generateImageWithLadder`, `image-pipeline`, `gemini`, `openai-image`.

- [ ] **Step 2: Update mocks in agent.test.ts**

Replace:
```typescript
vi.mock("../agents/content-generation/image-pipeline/generator.js", () => ({
  generateImageWithLadder: vi.fn().mockResolvedValue({ ok: false, ... }),
}));
```

With:
```typescript
vi.mock("../agents/content-generation/n8n-image.js", () => ({
  requestImageFromN8n: vi.fn().mockResolvedValue({ ok: false, reason: "test" }),
  processN8nImageResult: vi.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 3: Update any assertions that check for generated images**

If tests assert `featuredImage` contains a slug-specific path, update them to assert the default image path pattern: `/assets/images/{site-slug}-general-article.webp`.

- [ ] **Step 4: Run all tests**

Run: `cd services/content-pipeline && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/content-pipeline/src/__tests__/agent.test.ts \
      services/content-pipeline/src/__tests__/process-generate-job.test.ts
git commit -m "test: update tests for n8n async image generation"
```

---

### Task 7: Update CLAUDE.md and environment documentation

**Files:**
- Modify: `CLAUDE.md` (repo root: `atomic-content-platform/CLAUDE.md`)

- [ ] **Step 1: Update the agent step description**

In CLAUDE.md's Layout section, update the content-pipeline agent description. The image pipeline step should reflect n8n:

Replace references to "Gemini Flash" / "OpenAI" image generation with:
> Image pipeline: fire n8n webhook for async image generation (articles use default image until delivery)

- [ ] **Step 2: Add `N8N_IMAGE_WEBHOOK_URL` to the env var table**

Add to the Key Environment Variables table:

```
| `N8N_IMAGE_WEBHOOK_URL` | content-pipeline | n8n webhook for async image generation. If not set, articles are created without triggering image generation. |
```

- [ ] **Step 3: Update the Known Landmines section**

Remove or update any landmines referencing Gemini/OpenAI image generation. Add:

> **n8n image generation is fire-and-forget.** Articles are created with a default site image (`{site-slug}-general-article`). n8n webhooks fire in the background after article commit. If n8n is down or slow, articles are unaffected — they just keep the default image. Slack alerts fire on failure.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for n8n async image generation"
```

---

## Summary of changes

| What | Before | After |
|------|--------|-------|
| Image generation | Inline Gemini → OpenAI → thumbnail ladder (~90s per article) | Async n8n webhook, fire-and-forget (~46s per image, non-blocking) |
| Article creation speed | Blocked by image generation | Immediate — default image, real image arrives later |
| Featured image on creation | AI-generated or none | Per-site default (`{site-slug}-general-article.webp`) |
| Image provider selection | Hardcoded in TypeScript | Controlled in n8n workflow (no-code) |
| Failure mode | Article created without image, no alert | Article keeps default image, Slack alert fires |
| Cost control | Direct API token spend | Managed through n8n (swap providers, use free models, etc.) |
| Files removed | — | 6 files (openai-image.ts, generator.ts, analyzer.ts, types.ts, 2 test files). `gemini.ts` kept for migration orchestrator. |
| Files added | — | 2 files (n8n-image.ts, n8n-image.test.ts) |
