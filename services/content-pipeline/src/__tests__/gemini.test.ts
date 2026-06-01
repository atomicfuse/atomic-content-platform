import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImageWithGemini } from "../lib/gemini.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("generateImageWithGemini", () => {
  it("returns { ok: true, data } when Gemini responds with image data", async () => {
    const fakeImageBase64 = Buffer.from("fake-png-data").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: fakeImageBase64 } }],
            },
          },
        ],
      }),
    });

    const result = await generateImageWithGemini("my-api-key", "A photo of a snake");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.toString()).toBe("fake-png-data");
    }
  });

  it("returns { ok: false, retriable: false } when no image in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "I cannot generate" }] } }],
      }),
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "no_image_in_response" });
  });

  it("returns { ok: false, retriable: false } when candidate has no content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "SAFETY" }],
      }),
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "no_image_in_response" });
  });

  it("returns { ok: false, retriable: false } when candidates array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [] }),
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "no_image_in_response" });
  });

  it("returns { ok: false, retriable: true } on 5xx server error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "server crash",
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "server_error:500" });
  });

  it("returns { ok: false, retriable: true } on 429 rate limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "rate_limited:429" });
  });

  it("returns { ok: false, retriable: false } on 4xx client error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "invalid key",
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "client_error:403" });
  });

  it("returns { ok: false, retriable: true } on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retriable).toBe(true);
      expect(result.reason).toContain("fetch failed");
    }
  });

  it("returns { ok: false, retriable: true } on timeout", async () => {
    const err = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(err);

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "timeout" });
  });

  it("returns { ok: false, retriable: false } on unexpected error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("unexpected"));

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "unexpected" });
  });
});
