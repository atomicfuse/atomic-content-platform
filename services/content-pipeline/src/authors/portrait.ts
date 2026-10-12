import { createHash } from "node:crypto";
import sharp from "sharp";
import { uploadToR2 } from "../lib/r2-upload.js";
import type { AuthorDraft } from "./text.js";

export const PORTRAIT_MODEL = "gpt-image-2.5-flare";

/** Content-hashed key so a new portrait never shows a stale cached image. */
export function portraitKey(authorId: string, webp: Buffer): string {
  return `authors/assets/${authorId}-${createHash("sha256").update(webp).digest("hex").slice(0, 10)}.webp`;
}

/**
 * Concrete looks drawn at random for every portrait. Without them the image model returns the same default face
 * for every author; the illustration style stays the same so the library still looks like one house.
 */
const LOOKS = {
  age: ["early 20s", "late 20s", "early 30s", "mid 30s", "early 40s", "late 40s", "mid 50s", "early 60s"],
  hair: [
    "short cropped hair", "shoulder-length wavy hair", "long straight hair", "curly hair worn natural", "a close-shaved head",
    "messy tousled hair", "a neat short cut", "braids pulled back", "a sleek bob with a fringe", "a high bun",
    "a receding hairline with short hair", "loose curls", "a short pixie cut", "a low ponytail",
  ],
  extra: ["round glasses", "thin-framed rectangular glasses", "small hoop earrings", "a light stubble or soft features to suit the person", "freckles", "laugh lines", "no accessories", "no accessories", "no accessories", "a wristwatch peeking into frame"],
  clothing: [
    "a mustard knit sweater", "a navy denim jacket", "a white linen shirt", "a charcoal turtleneck", "a forest-green cardigan",
    "a striped breton top", "a rust corduroy jacket", "a soft pastel hoodie", "a patterned silk blouse or shirt", "a black leather jacket",
    "an olive utility shirt", "a burgundy blazer over a tee",
  ],
  background: ["soft sage green", "dusty rose", "warm terracotta", "pale sky blue", "muted mustard", "light lavender", "warm sand", "deep teal", "soft coral", "cool grey-blue"],
  angle: ["three-quarter view turned left", "three-quarter view turned right", "facing the viewer straight on", "slight head tilt, three-quarter view", "looking just past the viewer"],
  expression: ["warm open smile", "thoughtful, curious look", "amused half-smile", "relaxed, confident look", "bright laugh", "calm, friendly look"],
  light: ["soft window light from the left", "soft window light from the right", "even studio light", "warm late-afternoon light", "cool morning light"],
} as const;

export type Looks = { [K in keyof typeof LOOKS]: (typeof LOOKS)[K][number] };

export function pickLooks(rng: () => number = Math.random): Looks {
  const pick = <T,>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
  return {
    age: pick(LOOKS.age), hair: pick(LOOKS.hair), extra: pick(LOOKS.extra), clothing: pick(LOOKS.clothing),
    background: pick(LOOKS.background), angle: pick(LOOKS.angle), expression: pick(LOOKS.expression), light: pick(LOOKS.light),
  };
}

export type PortraitStyle = "realistic" | "illustrated";

const STYLE: Record<PortraitStyle, { opening: string; style: string }> = {
  realistic: {
    opening: "Natural editorial headshot photograph for a writer's author page.",
    style: "Style: realistic photograph, as if shot on an 85mm lens with shallow depth of field; true-to-life skin texture, natural colour, no heavy retouching, no beauty filter, not an illustration.",
  },
  illustrated: {
    opening: "Illustrated editorial portrait for a writer's author page.",
    style: "Style: hand-illustrated digital painting with soft painterly shading, the same house illustration style for every author — NOT a photograph, not photorealistic, no 3D render.",
  },
};

export function portraitPrompt(draft: AuthorDraft, rng: () => number = Math.random, style: PortraitStyle = "realistic"): string {
  const l = pickLooks(rng);
  const s = STYLE[style];
  return `${s.opening}
Subject: ${draft.name ?? "a writer"}${draft.beats?.length ? `, who writes about ${draft.beats.join(", ")}` : ""}. A distinct, specific individual, not a generic face.
Heritage and features: plausible for someone named ${draft.name ?? "this writer"}, including skin tone and natural hair colour.
Age: ${l.age}.
Hair style: ${l.hair}.
Details: ${l.extra}.
Wearing: ${l.clothing}.
Pose: head and shoulders, ${l.angle}, ${l.expression}.
Lighting: ${l.light}.
Background: plain ${l.background}${draft.beats?.length ? `, with a colour mood that suits ${draft.beats[0]}` : ""}.
${s.style}
No text, letters, logos, watermarks or frames.`;
}

/** OpenAI image → 512 px WebP → R2. Returns the site-relative path. Throws on any failure. */
export async function generatePortraitImage(authorId: string, draft: AuthorDraft, style: PortraitStyle = "realistic", fetchFn: typeof fetch = fetch): Promise<{ path: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetchFn("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: PORTRAIT_MODEL, prompt: portraitPrompt(draft, Math.random, style), size: "1024x1024", quality: "medium", output_format: "png", n: 1 }),
    // Medium quality: "high" sometimes ran past 50 s, and the result is shrunk to 512 px where the two look alike.
    // Capped below the endpoint's own 50 s deadline and the dashboard's ~60 s gateway.
    signal: AbortSignal.timeout(45_000),
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
