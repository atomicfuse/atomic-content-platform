import { describe, expect, it, vi } from "vitest";
import { editOpenAIImage, generateOpenAIImage } from "../openai-image";

const ok = (b64: string): Response => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: b64 }] }) }) as Response;

describe("generateOpenAIImage", () => {
  it("posts the model, prompt and options and returns the decoded image", async () => {
    const fetchFn = vi.fn(async () => ok(Buffer.from("png-bytes").toString("base64")));
    const out = await generateOpenAIImage({ apiKey: "k", model: "gpt-image-2.5-sunburst", prompt: "logo", size: "1536x1024", background: "transparent", quality: "high" }, fetchFn as unknown as typeof fetch);
    expect(out?.toString()).toBe("png-bytes");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ model: "gpt-image-2.5-sunburst", prompt: "logo", size: "1536x1024", background: "transparent", quality: "high", output_format: "png", n: 1 });
  });
  it("returns null on an HTTP error, a missing image or a network error", async () => {
    expect(await generateOpenAIImage({ apiKey: "k", model: "m", prompt: "p", size: "1024x1024" }, (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch)).toBeNull();
    expect(await generateOpenAIImage({ apiKey: "k", model: "m", prompt: "p", size: "1024x1024" }, (async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })) as unknown as typeof fetch)).toBeNull();
    expect(await generateOpenAIImage({ apiKey: "k", model: "m", prompt: "p", size: "1024x1024" }, (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("OpenAI error logging", () => {
  it("logs OpenAI's error message, not just the status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchFn = (async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"Your request was rejected by the safety system."}}', json: async () => ({}) })) as unknown as typeof fetch;
    await generateOpenAIImage({ apiKey: "k", model: "m", prompt: "p", size: "1024x1024" }, fetchFn);
    expect(warn.mock.calls.flat().join(" ")).toContain("rejected by the safety system");
    warn.mockRestore();
  });
});

describe("editOpenAIImage", () => {
  it("sends the source image and options as multipart to /images/edits and returns the result", async () => {
    const fetchFn = vi.fn(async () => ok(Buffer.from("edited").toString("base64")));
    const out = await editOpenAIImage({ apiKey: "k", model: "gpt-image-2.5-sunburst", image: Buffer.from("src-png"), prompt: "recolour", size: "1024x1024", background: "transparent", quality: "medium" }, fetchFn as unknown as typeof fetch);
    expect(out?.toString()).toBe("edited");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(form.get("prompt")).toBe("recolour");
    expect(form.get("background")).toBe("transparent");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("image[]")).toBeInstanceOf(Blob);
  });
  it("returns null on failure", async () => {
    expect(await editOpenAIImage({ apiKey: "k", model: "m", image: Buffer.from("x"), prompt: "p", size: "1024x1024" }, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});
