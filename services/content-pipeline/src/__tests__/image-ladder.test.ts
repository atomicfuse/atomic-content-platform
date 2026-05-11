import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImageGenAttempt } from "../agents/content-generation/image-pipeline/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGemini = vi.fn<(...args: unknown[]) => Promise<ImageGenAttempt>>();
const mockOpenAI = vi.fn<(...args: unknown[]) => Promise<ImageGenAttempt>>();

vi.mock("../lib/gemini.js", () => ({
  generateImageWithGemini: (...args: unknown[]): Promise<ImageGenAttempt> =>
    mockGemini(...args),
}));

vi.mock("../lib/openai-image.js", () => ({
  generateImageWithOpenAI: (...args: unknown[]): Promise<ImageGenAttempt> =>
    mockOpenAI(...args),
}));

vi.mock("../lib/image-optimizer.js", () => ({
  optimizeImage: (buf: Buffer): Promise<Buffer> => Promise.resolve(buf),
}));

// Stub global fetch for thumbnail fetcher (inside generator.ts)
vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no thumbnail in test")));

import { generateImageWithLadder } from "../agents/content-generation/image-pipeline/generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("generateImageWithLadder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Both keys available by default
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
  });

  // ── Tier A: Gemini ─────────────────────────────────────────────────────

  it("returns success when Gemini succeeds on first attempt", async () => {
    mockGemini.mockResolvedValueOnce(ok("gemini-image"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.data.toString()).toBe("gemini-image");
      expect(result.result.altText).toContain("Test Article");
    }
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it("retries Gemini on transient failure, succeeds on attempt 2", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(true, "server_error:500"))
      .mockResolvedValueOnce(ok("retry-image"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.data.toString()).toBe("retry-image");
    }
    expect(mockGemini).toHaveBeenCalledTimes(2);
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it("skips Gemini retry on permanent failure, falls through to OpenAI", async () => {
    mockGemini.mockResolvedValueOnce(fail(false, "client_error:403"));
    mockOpenAI.mockResolvedValueOnce(ok("openai-image"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.data.toString()).toBe("openai-image");
    }
    // Gemini: 1 attempt (no retry because permanent)
    expect(mockGemini).toHaveBeenCalledTimes(1);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
  });

  // ── Tier B: OpenAI ─────────────────────────────────────────────────────

  it("falls through to OpenAI after 2 Gemini transient failures", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(true, "rate_limited:429"))
      .mockResolvedValueOnce(fail(true, "timeout"));
    mockOpenAI.mockResolvedValueOnce(ok("openai-fallback"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.data.toString()).toBe("openai-fallback");
    }
    expect(mockGemini).toHaveBeenCalledTimes(2);
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
  });

  // ── Tier C: Exhausted ──────────────────────────────────────────────────

  it("returns exhausted when both Gemini and OpenAI fail (no thumbnail)", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(true, "server_error:500"))
      .mockResolvedValueOnce(fail(true, "server_error:502"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "client_error:400"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("image_gen_exhausted");
      expect(result.attempts).toEqual([
        { provider: "gemini", reason: "server_error:500" },
        { provider: "gemini", reason: "server_error:502" },
        { provider: "openai", reason: "client_error:400" },
        { provider: "thumbnail", reason: "no_source_url" },
      ]);
    }
  });

  it("returns exhausted with permanent Gemini + OpenAI failure (no thumbnail)", async () => {
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(fail(false, "no_image_in_response"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("image_gen_exhausted");
      // gemini + openai + thumbnail fallback
      expect(result.attempts).toHaveLength(3);
    }
  });

  // ── Missing API keys ──────────────────────────────────────────────────

  it("skips Gemini tier when GEMINI_API_KEY not set, OpenAI succeeds", async () => {
    delete process.env.GEMINI_API_KEY;
    mockOpenAI.mockResolvedValueOnce(ok("openai-only"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.data.toString()).toBe("openai-only");
    }
    expect(mockGemini).not.toHaveBeenCalled();
  });

  it("skips OpenAI tier when OPENAI_API_KEY not set, Gemini fails → exhausted", async () => {
    delete process.env.OPENAI_API_KEY;
    mockGemini.mockResolvedValueOnce(fail(false, "client_error:403"));

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toEqual([
        { provider: "gemini", reason: "client_error:403" },
        { provider: "openai", reason: "api_key_not_configured" },
        { provider: "thumbnail", reason: "no_source_url" },
      ]);
    }
  });

  it("returns exhausted with both keys missing", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await generateImageWithLadder(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toEqual([
        { provider: "gemini", reason: "api_key_not_configured" },
        { provider: "openai", reason: "api_key_not_configured" },
        { provider: "thumbnail", reason: "no_source_url" },
      ]);
    }
    expect(mockGemini).not.toHaveBeenCalled();
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it("does not call OpenAI when Gemini succeeds on second attempt", async () => {
    mockGemini
      .mockResolvedValueOnce(fail(true, "timeout"))
      .mockResolvedValueOnce(ok());

    await generateImageWithLadder(INPUT);

    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  it("includes image guidelines in the prompt when provided", async () => {
    mockGemini.mockResolvedValueOnce(ok("guided-image"));

    const inputWithGuidelines = {
      ...INPUT,
      imageGuidelines: ["Use warm tones", "Photorealistic style"],
    };
    const result = await generateImageWithLadder(inputWithGuidelines);

    expect(result.ok).toBe(true);
    // Verify guidelines are in the prompt passed to Gemini
    const geminiPrompt = mockGemini.mock.calls[0]![1] as string;
    expect(geminiPrompt).toContain("Use warm tones");
    expect(geminiPrompt).toContain("Photorealistic style");
    expect(geminiPrompt).toContain("Additional style guidelines");
  });

  it("omits image guidelines section when not provided", async () => {
    mockGemini.mockResolvedValueOnce(ok("plain-image"));

    await generateImageWithLadder(INPUT);

    const geminiPrompt = mockGemini.mock.calls[0]![1] as string;
    expect(geminiPrompt).not.toContain("Additional style guidelines");
  });

  it("passes thumbnail reference to Gemini but not OpenAI", async () => {
    // Gemini fails → falls to OpenAI
    mockGemini.mockResolvedValueOnce(fail(false, "no_image_in_response"));
    mockOpenAI.mockResolvedValueOnce(ok());

    await generateImageWithLadder({ ...INPUT, sourceThumbnailUrl: "https://example.com/img.jpg" });

    // OpenAI prompt should NOT contain "style reference" wording
    // (OpenAI gets hasReference=false prompt)
    const openaiPrompt = mockOpenAI.mock.calls[0]![1] as string;
    expect(openaiPrompt).not.toContain("style reference");
    expect(openaiPrompt).toContain("professional editorial illustration");
  });
});
