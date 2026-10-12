import { createHash } from "node:crypto";
import sharp from "sharp";
import { uploadToR2 } from "../lib/r2-upload.js";
import type { AuthorDraft } from "./text.js";

export const PORTRAIT_MODEL = "gpt-image-2.5-flare";

/** Content-hashed key so a new portrait never shows a stale cached image. */
export function portraitKey(authorId: string, webp: Buffer): string {
  return `authors/assets/${authorId}-${createHash("sha256").update(webp).digest("hex").slice(0, 10)}.webp`;
}

export function portraitPrompt(draft: AuthorDraft): string {
  return `Illustrated editorial portrait for a writer's author page.
Subject: ${draft.name ?? "a writer"}${draft.beats?.length ? `, who writes about ${draft.beats.join(", ")}` : ""}.
Style: hand-illustrated digital painting with soft painterly shading, the same consistent house style for every author — NOT a photograph, not photorealistic, no 3D render.
Framing: head and shoulders, centred, friendly natural expression, looking slightly off-camera, modern everyday clothing, plausible varied appearance.
Background: plain soft neutral studio colour.
No text, letters, logos, watermarks or frames.`;
}

/** OpenAI image → 512 px WebP → R2. Returns the site-relative path. Throws on any failure. */
export async function generatePortraitImage(authorId: string, draft: AuthorDraft, fetchFn: typeof fetch = fetch): Promise<{ path: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetchFn("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: PORTRAIT_MODEL, prompt: portraitPrompt(draft), size: "1024x1024", quality: "high", output_format: "png", n: 1 }),
    // ~30 s measured for this size; capped below the dashboard's ~60 s gateway.
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image");
  const webp = await sharp(Buffer.from(b64, "base64")).resize(512, 512, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  const key = portraitKey(authorId, webp);
  if (!(await uploadToR2(key, webp, "image/webp"))) throw new Error("portrait upload to R2 failed");
  return { path: `/${key}`, model: PORTRAIT_MODEL };
}
