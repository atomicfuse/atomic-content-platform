import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  triggerN8nImage,
  handleImageCallback,
  processN8nImageResult,
} from "../agents/content-generation/n8n-image.js";
import type {
  N8nTriggerRequest,
  N8nCallbackPayload,
  ProcessImageParams,
} from "../agents/content-generation/n8n-image.js";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../lib/image-optimizer.js", () => ({
  optimizeImage: vi.fn(async (buf: Buffer) => Buffer.from("optimized-" + buf.toString())),
}));

vi.mock("../lib/r2-upload.js", () => ({
  uploadToR2: vi.fn(async () => true),
  buildR2Key: vi.fn((siteId: string, slug: string, ext: string) =>
    `${siteId}/assets/images/${slug}.${ext}`,
  ),
}));

vi.mock("../lib/github.js", () => {
  const mock = vi.fn(() => ({ _mock: "octokit" }));
  return {
    createOctokit: mock,
    createGitHubClient: mock,
    readFile: vi.fn(async () => [
      "---",
      "title: Test Article",
      "slug: test-slug",
      "---",
      "",
      "Body content here.",
    ].join("\n")),
    commitFile: vi.fn(async () => "abc1234"),
    clearTreeCache: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocking (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { optimizeImage } from "../lib/image-optimizer.js";
import { uploadToR2, buildR2Key } from "../lib/r2-upload.js";
import { createOctokit, readFile, commitFile } from "../lib/github.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_IMAGE_BYTES = Buffer.from("fake-jpeg-image-data");
const FAKE_BASE64 = FAKE_IMAGE_BYTES.toString("base64");
const WEBHOOK_URL = "https://atomics.app.n8n.cloud/webhook/acn-image-generation";

const baseTriggerRequest: N8nTriggerRequest = {
  request_id: "img_test_001",
  callback_url: "https://content-pipeline-app.apps.cloudgrid.io/image-callback",
  job_id: "gen_test_job_001",
  site_domain: "muvizzcom",
  slug: "cannes-2026-most-anticipated-films",
  branch: "staging/muvizzcom",
  article: {
    title: "Cannes 2026: Most Anticipated Films",
    description: "A roundup of the most anticipated films at Cannes 2026.",
    summary: "What happened... Why it matters...",
    vertical: "Entertainment",
    source_thumbnail_url: "https://cdn.example.com/thumb.jpg",
    image_guidelines: null,
  },
};

const baseCallbackPayload: N8nCallbackPayload = {
  request_id: "img_test_001",
  job_id: "gen_test_job_001",
  site_domain: "muvizzcom",
  slug: "cannes-2026-most-anticipated-films",
  branch: "staging/muvizzcom",
  status: "ok",
  mime_type: "image/jpeg",
  data_base64: FAKE_BASE64,
  alt_text: "A poster showcasing the most anticipated films at Cannes 2026.",
  meta: {
    provider: "gemini-3.1-flash-image-preview",
    duration_ms: 46000,
  },
};

const github = { token: "ghp_test", repo: "atomicfuse/atomic-labs-network" };

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(optimizeImage).mockReset();
  vi.mocked(uploadToR2).mockReset();
  vi.mocked(buildR2Key).mockReset();
  vi.mocked(createOctokit).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(commitFile).mockReset();

  // Default implementations
  vi.mocked(optimizeImage).mockImplementation(async (buf: Buffer) =>
    Buffer.from("optimized-" + buf.toString()),
  );
  vi.mocked(uploadToR2).mockResolvedValue(true);
  vi.mocked(buildR2Key).mockImplementation(
    (siteId: string, slug: string, ext: string) =>
      `${siteId}/assets/images/${slug}.${ext}`,
  );
  vi.mocked(createOctokit).mockReturnValue({ _mock: "octokit" } as never);
  vi.mocked(readFile).mockResolvedValue(
    ["---", "title: Test Article", "slug: test-slug", "---", "", "Body content here."].join("\n"),
  );
  vi.mocked(commitFile).mockResolvedValue("abc1234");
});

// ---------------------------------------------------------------------------
// triggerN8nImage
// ---------------------------------------------------------------------------

describe("triggerN8nImage", () => {
  it("returns true when n8n accepts the request (200)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await triggerN8nImage(WEBHOOK_URL, baseTriggerRequest);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      WEBHOOK_URL,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("cannes-2026"),
      }),
    );
  });

  it("returns false when n8n returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

    const result = await triggerN8nImage(WEBHOOK_URL, baseTriggerRequest);

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await triggerN8nImage(WEBHOOK_URL, baseTriggerRequest);

    expect(result).toBe(false);
  });

  it("returns false on timeout", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    mockFetch.mockRejectedValueOnce(abortErr);

    const result = await triggerN8nImage(WEBHOOK_URL, baseTriggerRequest);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleImageCallback
// ---------------------------------------------------------------------------

describe("handleImageCallback", () => {
  it("processes a successful callback — optimize, R2, Git", async () => {
    const articleMd = [
      "---",
      "title: Cannes 2026",
      "slug: cannes-2026-most-anticipated-films",
      "status: published",
      "---",
      "",
      "Body text here.",
    ].join("\n");
    vi.mocked(readFile).mockResolvedValueOnce(articleMd);

    const result = await handleImageCallback(baseCallbackPayload, github);

    expect(result.ok).toBe(true);
    expect(optimizeImage).toHaveBeenCalled();
    expect(uploadToR2).toHaveBeenCalled();
    expect(commitFile).toHaveBeenCalledOnce();
  });

  it("returns error when n8n reports failure status", async () => {
    const result = await handleImageCallback(
      { ...baseCallbackPayload, status: "error", error: "Generation failed" },
      github,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Generation failed");
    expect(optimizeImage).not.toHaveBeenCalled();
  });

  it("returns error when data_base64 is missing", async () => {
    const result = await handleImageCallback(
      { ...baseCallbackPayload, data_base64: undefined },
      github,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("No image data");
  });

  it("returns error when required fields are missing", async () => {
    const result = await handleImageCallback(
      { ...baseCallbackPayload, branch: "" },
      github,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Missing required fields");
  });
});

// ---------------------------------------------------------------------------
// processN8nImageResult
// ---------------------------------------------------------------------------

describe("processN8nImageResult", () => {
  const baseParams: ProcessImageParams = {
    siteDomain: "muvizzcom",
    slug: "cannes-2026-most-anticipated-films",
    imageData: FAKE_IMAGE_BYTES,
    altText: "A cinematic poster for Cannes 2026.",
    branch: "staging/muvizzcom",
    github,
  };

  it("optimizes image, uploads to R2, and updates Git frontmatter", async () => {
    const articleMd = [
      "---",
      "title: Cannes 2026",
      "slug: cannes-2026-most-anticipated-films",
      "status: published",
      "---",
      "",
      "Body text here.",
    ].join("\n");

    vi.mocked(readFile).mockResolvedValueOnce(articleMd);

    await processN8nImageResult(baseParams);

    // 1. Image was optimized
    expect(optimizeImage).toHaveBeenCalledWith(FAKE_IMAGE_BYTES);

    // 2. R2 key was built correctly
    expect(buildR2Key).toHaveBeenCalledWith(
      "muvizzcom",
      "cannes-2026-most-anticipated-films",
      "webp",
    );

    // 3. Optimized image was uploaded to R2
    expect(uploadToR2).toHaveBeenCalledWith(
      "muvizzcom/assets/images/cannes-2026-most-anticipated-films.webp",
      expect.any(Buffer),
      "image/webp",
    );

    // 4. Article was read from Git on the correct branch
    expect(readFile).toHaveBeenCalledWith(
      expect.anything(),
      "atomicfuse/atomic-labs-network",
      "sites/muvizzcom/articles/cannes-2026-most-anticipated-films.md",
      "staging/muvizzcom",
    );

    // 5. Article was committed with updated frontmatter
    expect(commitFile).toHaveBeenCalledOnce();
    const commitCall = vi.mocked(commitFile).mock.calls[0]!;
    const commitArg = commitCall[2];
    expect(commitArg.branch).toBe("staging/muvizzcom");
    expect(commitArg.path).toBe(
      "sites/muvizzcom/articles/cannes-2026-most-anticipated-films.md",
    );

    // 6. Frontmatter uses relative path without siteId (seed-kv rewrites at sync time)
    const committed = commitArg.content;
    expect(committed).toContain("featuredImage:");
    expect(committed).toContain("image_alt:");
    expect(committed).toContain("/assets/images/cannes-2026-most-anticipated-films.webp");
    expect(committed).not.toContain("/muvizzcom/assets/");
  });

  it("throws when R2 upload fails — does not update Git", async () => {
    vi.mocked(uploadToR2).mockResolvedValueOnce(false);

    await expect(processN8nImageResult(baseParams)).rejects.toThrow(
      "R2 upload failed",
    );

    expect(optimizeImage).toHaveBeenCalled();
    expect(uploadToR2).toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(commitFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleImageCallback — R2 failure propagation
// ---------------------------------------------------------------------------

describe("handleImageCallback — R2 failure", () => {
  it("returns ok: false when R2 upload fails (image not persisted)", async () => {
    vi.mocked(uploadToR2).mockResolvedValueOnce(false);
    vi.mocked(readFile).mockResolvedValueOnce(
      ["---", "title: Test", "---", "", "Body."].join("\n"),
    );

    const result = await handleImageCallback(baseCallbackPayload, github);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("R2 upload failed");
    expect(commitFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleImageCallback — validation order (required fields before status)
// ---------------------------------------------------------------------------

describe("handleImageCallback — validation order", () => {
  it("rejects missing site_domain even when status is ok and data present", async () => {
    const result = await handleImageCallback(
      { ...baseCallbackPayload, site_domain: "" },
      github,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Missing required fields");
    expect(optimizeImage).not.toHaveBeenCalled();
  });

  it("rejects missing slug even when status is ok and data present", async () => {
    const result = await handleImageCallback(
      { ...baseCallbackPayload, slug: "" },
      github,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Missing required fields");
  });
});
