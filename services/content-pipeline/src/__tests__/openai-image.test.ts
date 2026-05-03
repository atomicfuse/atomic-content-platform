import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImageWithOpenAI } from "../lib/openai-image.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("generateImageWithOpenAI", () => {
  it("returns { ok: true, data } when OpenAI responds with image", async () => {
    const fakeImageBase64 = Buffer.from("fake-openai-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ b64_json: fakeImageBase64 }],
      }),
    });

    const result = await generateImageWithOpenAI("sk-test", "A landscape photo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.toString()).toBe("fake-openai-image");
    }
  });

  it("sends correct request headers and body", async () => {
    const fakeImageBase64 = Buffer.from("img").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeImageBase64 }] }),
    });

    await generateImageWithOpenAI("sk-mykey", "test prompt");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-mykey",
        },
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.model).toBe("gpt-image-1");
    expect(body.prompt).toBe("test prompt");
    expect(body.n).toBe(1);
    expect(body.size).toBe("1536x1024");
  });

  it("returns { ok: false, retriable: false } when no image in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "no_image_in_response" });
  });

  it("returns { ok: false, retriable: true } on 5xx server error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "overloaded",
    });

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "server_error:503" });
  });

  it("returns { ok: false, retriable: true } on 429 rate limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    });

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "rate_limited:429" });
  });

  it("returns { ok: false, retriable: false } on 401 auth error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid api key",
    });

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result).toEqual({ ok: false, retriable: false, reason: "client_error:401" });
  });

  it("returns { ok: false, retriable: true } on timeout", async () => {
    const err = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(err);

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result).toEqual({ ok: false, retriable: true, reason: "timeout" });
  });

  it("returns { ok: false, retriable: true } on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await generateImageWithOpenAI("sk-test", "prompt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retriable).toBe(true);
      expect(result.reason).toContain("fetch failed");
    }
  });
});
