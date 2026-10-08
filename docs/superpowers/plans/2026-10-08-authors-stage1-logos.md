# Authors — Stage 1: Logos on OpenAI gpt-image-2.5-sunburst — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site logos (new-site wizard + "Generate logo" in site settings) are generated with OpenAI `gpt-image-2.5-sunburst` with a transparent background, falling back to today's Gemini path.

**Architecture:** A small dependency-free OpenAI Images client (`lib/openai-image.ts`, plain `fetch`, no SDK) and a shared logo prompt builder (`lib/logo-prompt.ts`) extracted from `actions/wizard.ts`. `generateLogoWithGemini` callers switch to a new `generateLogo()` that tries OpenAI first and Gemini second. The footer-variant recolour (`recolorLogoForBackground`, Gemini image-to-image) is unchanged.

**Tech Stack:** Next.js 15 server actions, TypeScript strict, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-08-authors-design.md` (D9) — roadmap: `docs/superpowers/plans/2026-10-08-authors-roadmap.md`.

## Global Constraints
- Model id `gpt-image-2.5-sunburst` (verified on the account's `/v1/models`, 2026-10-08).
- Request: `POST https://api.openai.com/v1/images/generations` `{ model, prompt, size: "1536x1024", background: "transparent", output_format: "png", quality: "high", n: 1 }` → `data[0].b64_json` (verified live: 200, ~28 s, transparent PNG).
- Timeout 90 s for the OpenAI call (the probe took 28 s; today's Gemini timeout is 20 s).
- Gemini path stays as the fallback, byte-for-byte the same request as today.
- No `any`, explicit return types; dashboard reads `OPENAI_API_KEY` from env (already a CloudGrid secret for the app).
- Commit trailer: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

## Review Focus
1. `OPENAI_API_KEY` unset (local dev, tests) → behaviour identical to today (Gemini only) — pinned in Task 2 test "no OpenAI key → Gemini only".
2. OpenAI returns 4xx/5xx, times out, or returns no `b64_json` → Gemini fallback, never a thrown error in the wizard — Task 1 + Task 2 tests.
3. Header-contrast rules must reach the OpenAI prompt (the probe without them produced a black wordmark + pink glow) — Task 2 asserts the prompt contains the header colour and "no glow".
4. `generateLogoPreview` used to throw without `GEMINI_API_KEY`; with only an OpenAI key it must now work — Task 3.
5. A transparent PNG must not go through `removeBackground` (it would eat light logo edges) — Task 2 asserts it isn't called on the OpenAI path.

---

### Task 1: OpenAI Images client

**Files:**
- Create: `services/dashboard/src/lib/openai-image.ts`
- Test: `services/dashboard/src/lib/__tests__/openai-image.test.ts`

**Interfaces:**
- Produces: `generateOpenAIImage(opts: OpenAIImageOptions, fetchFn?: typeof fetch): Promise<Buffer | null>`;
  `interface OpenAIImageOptions { apiKey: string; model: string; prompt: string; size: "1024x1024" | "1536x1024" | "1024x1536"; background?: "transparent" | "opaque" | "auto"; quality?: "low" | "medium" | "high"; timeoutMs?: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { generateOpenAIImage } from "../openai-image";

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
```

- [ ] **Step 2: Run it — expect FAIL** (`Failed to resolve import "../openai-image"`)

Run: `cd services/dashboard && npx vitest run src/lib/__tests__/openai-image.test.ts`

- [ ] **Step 3: Implement**

```ts
/** Minimal OpenAI Images API client (no SDK): one generation, returns the image bytes or null. */
export interface OpenAIImageOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  background?: "transparent" | "opaque" | "auto";
  quality?: "low" | "medium" | "high";
  timeoutMs?: number;
}

export async function generateOpenAIImage(opts: OpenAIImageOptions, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const res = await fetchFn("https://api.openai.com/v1/images/generations", {
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
    if (!res.ok) {
      console.warn(`[openai-image] ${opts.model} → HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch (err) {
    console.warn(`[openai-image] ${opts.model} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 4: Run it — expect PASS (2 tests)**
- [ ] **Step 5: Commit** — `git add services/dashboard/src/lib/openai-image.ts services/dashboard/src/lib/__tests__/openai-image.test.ts && git commit -m "feat(dashboard): minimal OpenAI Images client"`

### Task 2: Shared logo prompt + `generateLogo()` (OpenAI first, Gemini fallback)

**Files:**
- Create: `services/dashboard/src/lib/logo-prompt.ts` (moves `isDarkColor` + the prompt text out of `actions/wizard.ts` lines 1476–1530)
- Modify: `services/dashboard/src/actions/wizard.ts` (`generateLogoWithGemini` uses `buildLogoPrompt`; new `generateLogo`; callers at line ~150 and line 1209 switch to it)
- Test: `services/dashboard/src/actions/__tests__/wizard-logo-openai.test.ts` (copy the `vi.mock` block from `wizard-logo-background.test.ts` lines 1–55 verbatim)

**Interfaces:**
- Consumes: `generateOpenAIImage` (Task 1).
- Produces: `buildLogoPrompt(input: { siteName: string; vertical: string; audience?: string; headerBg?: string; colors?: Record<string, string>; transparentOutput: boolean }): string`; `isDarkColor(hex: string): boolean`; in wizard.ts `async function generateLogo(siteName: string, vertical: string, audience?: string, headerBg?: string, colors?: Record<string, string>): Promise<Buffer | null>`.

- [ ] **Step 1: Write the failing tests** (in the new test file, after the copied mocks)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeBackground } from "@/lib/remove-background";
import { generateLogoPreview } from "../wizard";
// + getSiteConfig mock setup as in wizard-logo-background.test.ts (site with theme colours, template "modern", primary #101010)

const openaiOk = (): Response => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from("openai-png").toString("base64") }] }) }) as Response;
const geminiOk = (): Response => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("gemini-png").toString("base64") } }] } }] }) }) as Response;

describe("logo generation — OpenAI gpt-image-2.5-sunburst first", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });

  it("uses OpenAI with a transparent background and the header-contrast rules", async () => {
    process.env.OPENAI_API_KEY = "ok"; process.env.GEMINI_API_KEY = "gk";
    const fetchMock = vi.fn(async (url: string) => (url.includes("openai.com") ? openaiOk() : geminiOk()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = await generateLogoPreview("testsite", { generateFooterVariant: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.openai.com/v1/images/generations");
    const body = JSON.parse(init.body as string) as { model: string; background: string; prompt: string };
    expect(body.model).toBe("gpt-image-2.5-sunburst");
    expect(body.background).toBe("transparent");
    expect(body.prompt).toContain("#101010");
    expect(body.prompt).toMatch(/no glow/i);
    expect(out.logo).toBe(Buffer.from("openai-png").toString("base64"));
    expect(removeBackground).not.toHaveBeenCalledWith(Buffer.from("openai-png"));
  });
  it("falls back to Gemini when OpenAI fails", async () => {
    process.env.OPENAI_API_KEY = "ok"; process.env.GEMINI_API_KEY = "gk";
    global.fetch = vi.fn(async (url: string) => (url.includes("openai.com") ? ({ ok: false, status: 500, json: async () => ({}) } as Response) : geminiOk())) as unknown as typeof fetch;
    expect((await generateLogoPreview("testsite", { generateFooterVariant: false })).logo).toBe(Buffer.from("gemini-png").toString("base64"));
  });
  it("no OpenAI key → Gemini only (today's behaviour)", async () => {
    delete process.env.OPENAI_API_KEY; process.env.GEMINI_API_KEY = "gk";
    const fetchMock = vi.fn(async () => geminiOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    await generateLogoPreview("testsite", { generateFooterVariant: false });
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("openai.com"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (first test: first fetch goes to Gemini)

Run: `npx vitest run src/actions/__tests__/wizard-logo-openai.test.ts`

- [ ] **Step 3: Create `lib/logo-prompt.ts`** — move `isDarkColor` and the prompt body verbatim from `generateLogoWithGemini` into `buildLogoPrompt`, parameterising only the background section:

```ts
export function isDarkColor(hex: string): boolean { /* moved verbatim from wizard.ts lines 1477-1485 */ }

export function buildLogoPrompt(input: { siteName: string; vertical: string; audience?: string; headerBg?: string; colors?: Record<string, string>; transparentOutput: boolean }): string {
  const headerHex = input.headerBg ?? "#1a1a2e";
  const dark = isDarkColor(headerHex);
  // paletteLine + contrastDirective: moved verbatim from wizard.ts lines 1496-1508
  const backgroundRule = input.transparentOutput
    ? `• BACKGROUND: Fully TRANSPARENT background. The logo will sit on a solid ${headerHex} website header — contrast against that colour. No glow, no drop shadow, no outer halo, no backdrop shape behind the logo.`
    : `• BACKGROUND: Solid uniform ${headerHex} background, edge to edge. No textures, patterns, gradients, or drop shadows. (This solid background will be stripped to transparency in post-processing — only the logo elements should remain.)`;
  // return the existing template literal (lines 1510-1530) with its BACKGROUND bullet replaced by `${backgroundRule}`
}
```
  `generateLogoWithGemini` now calls `buildLogoPrompt({ …, transparentOutput: false })` — its prompt text is unchanged (the existing `wizard-logo-background.test.ts` keeps passing).

- [ ] **Step 4: Add `generateLogo` in wizard.ts** and switch both callers (`createSiteAndBuildStaging` logo step, `generateLogoPreview` line 1209):

```ts
const OPENAI_LOGO_MODEL = "gpt-image-2.5-sunburst";

/** Site logo: OpenAI gpt-image-2.5-sunburst (transparent PNG), else today's Gemini path. */
async function generateLogo(siteName: string, vertical: string, audience?: string, headerBg?: string, colors?: Record<string, string>): Promise<Buffer | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const png = await generateOpenAIImage({
      apiKey: openaiKey, model: OPENAI_LOGO_MODEL, size: "1536x1024", background: "transparent", quality: "high",
      prompt: buildLogoPrompt({ siteName, vertical, audience, headerBg, colors, transparentOutput: true }),
    });
    if (png) return png; // already transparent — no removeBackground
    console.warn("[wizard] OpenAI logo failed — falling back to Gemini");
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  return geminiKey ? generateLogoWithGemini(geminiKey, siteName, vertical, audience, headerBg, colors) : null;
}
```
  In `generateLogoPreview`, replace the "throws without GEMINI_API_KEY" guard with: throw only when **neither** `OPENAI_API_KEY` nor `GEMINI_API_KEY` is set; the footer recolour still needs `GEMINI_API_KEY` (skip the footer variant when it's missing).

- [ ] **Step 5: Run the new + existing logo tests, typecheck — expect PASS**

Run: `npx vitest run src/actions/__tests__/wizard-logo-openai.test.ts src/actions/__tests__/wizard-logo-background.test.ts src/components/site-detail/__tests__/ContentAgentTab.grid.test.tsx && pnpm typecheck`

- [ ] **Step 6: Commit** — `git add` the three files + test; message `feat(dashboard): logos with OpenAI gpt-image-2.5-sunburst (Gemini fallback)`

### Task 3: Verify live + docs

- [ ] **Step 1:** `grid dev` → Site → Content Agent → "Generate logo" on a test site; expect a transparent logo readable on the header colour, ~30 s. Repeat once for a dark-header and once for a light-header site.
- [ ] **Step 2:** Update `services/dashboard/public/guide/` page that documents logo generation (grep "logo" in `public/guide/*.md`) to say logos use OpenAI `gpt-image-2.5-sunburst` with a Gemini fallback.
- [ ] **Step 3:** Full suite: `cd services/dashboard && pnpm test && pnpm typecheck` — expect all green.
- [ ] **Step 4: Commit** the guide change.
