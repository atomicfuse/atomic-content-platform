import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requestImageFromN8n,
  processN8nImageResult,
} from "../agents/content-generation/n8n-image.js";
import type {
  N8nImageRequest,
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

vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => ({ _mock: "octokit" })),
  readFile: vi.fn(async () => [
    "---",
    "title: Test Article",
    "slug: test-slug",
    "---",
    "",
    "Body content here.",
  ].join("\n")),
  commitFile: vi.fn(async () => "abc1234"),
}));

// ---------------------------------------------------------------------------
// Imports after mocking (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { optimizeImage } from "../lib/image-optimizer.js";
import { uploadToR2, buildR2Key } from "../lib/r2-upload.js";
import { createGitHubClient, readFile, commitFile } from "../lib/github.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_IMAGE_BYTES = Buffer.from("fake-jpeg-image-data");
const FAKE_BASE64 = FAKE_IMAGE_BYTES.toString("base64");

const baseRequest: N8nImageRequest = {
  request_id: "img_test_001",
  callback_url: "https://example.com/callback",
  site_domain: "muvizzcom",
  slug: "cannes-2026-most-anticipated-films",
  article: {
    title: "Cannes 2026: Most Anticipated Films",
    description: "A roundup of the most anticipated films at Cannes 2026.",
    summary: "What happened... Why it matters...",
    vertical: "Entertainment",
    source_thumbnail_url: "https://cdn.example.com/thumb.jpg",
    image_guidelines: null,
  },
};

const successResponse = {
  request_id: "img_test_001",
  status: "ok",
  delivery: "inline",
  mime_type: "image/jpeg",
  data_base64: FAKE_BASE64,
  alt_text: "A poster showcasing the most anticipated films at Cannes 2026.",
  meta: {
    provider: "gemini-3.1-flash-image-preview",
    prompt: "Create a cinematic poster...",
    duration_ms: 46000,
    attempts: [{ provider: "gemini", reason: null, ok: true, attempt: 1 }],
  },
};

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(optimizeImage).mockReset();
  vi.mocked(uploadToR2).mockReset();
  vi.mocked(buildR2Key).mockReset();
  vi.mocked(createGitHubClient).mockReset();
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
  vi.mocked(createGitHubClient).mockReturnValue({ _mock: "octokit" } as never);
  vi.mocked(readFile).mockResolvedValue(
    ["---", "title: Test Article", "slug: test-slug", "---", "", "Body content here."].join("\n"),
  );
  vi.mocked(commitFile).mockResolvedValue("abc1234");
});

// ---------------------------------------------------------------------------
// requestImageFromN8n
// ---------------------------------------------------------------------------

describe("requestImageFromN8n", () => {
  it("returns success with decoded image buffer on 200 + status ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => successResponse,
    });

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.equals(FAKE_IMAGE_BYTES)).toBe(true);
      expect(result.altText).toBe(successResponse.alt_text);
      expect(result.meta.provider).toBe("gemini-3.1-flash-image-preview");
      expect(result.meta.duration_ms).toBe(46000);
    }
  });

  it("returns failure when n8n returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/500/);
    }
  });

  it("returns failure when response status !== 'ok'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...successResponse,
        status: "error",
        data_base64: "",
      }),
    });

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/error/);
    }
  });

  it("returns failure when data_base64 is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ...successResponse,
        data_base64: "",
      }),
    });

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/empty/i);
    }
  });

  it("returns failure on fetch timeout (AbortError)", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    mockFetch.mockRejectedValueOnce(abortErr);

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/timeout/i);
    }
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await requestImageFromN8n(baseRequest);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ECONNREFUSED");
    }
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
    github: {
      token: "ghp_test",
      repo: "atomicfuse/atomic-labs-network",
    },
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
    const optimizedBuf = Buffer.from("optimized-fake-jpeg-image-data");
    expect(uploadToR2).toHaveBeenCalledWith(
      "muvizzcom/assets/images/cannes-2026-most-anticipated-films.webp",
      expect.any(Buffer),
      "image/webp",
    );

    // 4. Article was read from Git on the correct branch
    expect(readFile).toHaveBeenCalledWith(
      expect.anything(), // octokit
      "atomicfuse/atomic-labs-network",
      "sites/muvizzcom/articles/cannes-2026-most-anticipated-films.md",
      "staging/muvizzcom",
    );

    // 5. Article was committed with updated frontmatter
    expect(commitFile).toHaveBeenCalledOnce();
    const commitCall = vi.mocked(commitFile).mock.calls[0]!;
    const commitArg = commitCall[2]; // FileCommit argument
    expect(commitArg.branch).toBe("staging/muvizzcom");
    expect(commitArg.path).toBe(
      "sites/muvizzcom/articles/cannes-2026-most-anticipated-films.md",
    );

    // 6. Frontmatter in committed content includes featuredImage and image_alt
    const committed = commitArg.content;
    expect(committed).toContain("featuredImage:");
    expect(committed).toContain("image_alt:");
    expect(committed).toContain("cannes-2026-most-anticipated-films.webp");
    expect(committed).toContain("A cinematic poster for Cannes 2026.");
  });

  it("skips Git update if R2 upload fails", async () => {
    vi.mocked(uploadToR2).mockResolvedValueOnce(false);

    await processN8nImageResult(baseParams);

    // optimizeImage and uploadToR2 should have been called
    expect(optimizeImage).toHaveBeenCalled();
    expect(uploadToR2).toHaveBeenCalled();

    // But Git operations should NOT have been called
    expect(readFile).not.toHaveBeenCalled();
    expect(commitFile).not.toHaveBeenCalled();
  });
});
