import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImageWithGemini } from "../lib/gemini.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("generateImageWithGemini", () => {
  it("returns a Buffer when Gemini responds with image data", async () => {
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
    expect(result).toBeInstanceOf(Buffer);
    expect(result!.toString()).toBe("fake-png-data");
  });

  it("returns null when Gemini response has no image part", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "I cannot generate" }] } }] }),
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });

  it("returns null when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });

  it("returns null when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });
});
