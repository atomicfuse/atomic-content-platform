/** Minimal OpenAI Images API client (no SDK): one generation or edit, returns the image bytes or null. */
type Size = "1024x1024" | "1536x1024" | "1024x1536";

interface CommonOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size: Size;
  background?: "transparent" | "opaque" | "auto";
  quality?: "low" | "medium" | "high";
  timeoutMs?: number;
}

export type OpenAIImageOptions = CommonOptions;
export interface OpenAIImageEditOptions extends CommonOptions {
  /** Source image (PNG) the edit starts from. */
  image: Buffer;
}

const API = "https://api.openai.com/v1/images";

/** Logs the status AND OpenAI's own error message (moderation, model, size…) so failures are diagnosable. */
async function readImage(res: Response, model: string): Promise<Buffer | null> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn(`[openai-image] ${model} → HTTP ${res.status} ${detail.slice(0, 300)}`);
    return null;
  }
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) console.warn(`[openai-image] ${model} → no image in response`);
  return b64 ? Buffer.from(b64, "base64") : null;
}

export async function generateOpenAIImage(opts: OpenAIImageOptions, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const res = await fetchFn(`${API}/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        size: opts.size,
        ...(opts.background ? { background: opts.background } : {}),
        ...(opts.quality ? { quality: opts.quality } : {}),
        output_format: "png",
        n: 1,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    return await readImage(res, opts.model);
  } catch (err) {
    console.warn(`[openai-image] ${opts.model} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Image-to-image (e.g. footer recolour, favicon from the logo): multipart POST to /images/edits. */
export async function editOpenAIImage(opts: OpenAIImageEditOptions, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const form = new FormData();
    form.append("model", opts.model);
    form.append("prompt", opts.prompt);
    form.append("size", opts.size);
    form.append("output_format", "png");
    if (opts.background) form.append("background", opts.background);
    if (opts.quality) form.append("quality", opts.quality);
    form.append("image[]", new Blob([new Uint8Array(opts.image)], { type: "image/png" }), "source.png");
    const res = await fetchFn(`${API}/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    return await readImage(res, opts.model);
  } catch (err) {
    console.warn(`[openai-image] ${opts.model} edit failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
