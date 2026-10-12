# Authors Stage 3 — Library, AI Generation and Authors Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A network-wide author library in the dashboard — an **Authors** screen (list, search, filters, new author, "Generate missing profiles") and a full **author profile** editor with per-section AI regenerate — backed by `authors/<id>.yaml` in the network repo and an AI generation endpoint in the content pipeline.

**Architecture:** Author records live in the network repo (`main`, `authors/<id>.yaml`), read and written by the dashboard through its existing GitHub helpers (a short in-memory cache keeps list loads fast); committing a file is what later syncs it to sites (Stage 2's `sync-authors.yml`). The content pipeline gains `POST /authors/generate`, which returns ONE generated part per call (name, tagline, bio, beats or portrait) without saving; the browser chains parts so no request comes near CloudGrid's ~60 s gateway limit. Portraits are generated with OpenAI `gpt-image-2.5-flare`, converted to 512 px WebP and stored in R2 at `authors/assets/<id>-<hash>.webp`.

**Tech Stack:** Next.js 15 App Router (server pages, route handlers, client components), Tailwind with the dashboard's CSS tokens, vitest + Testing Library; Node pipeline (`lib/ai.ts` provider chain, `sharp`, R2 S3 client); `yaml`.

**Spec:** `docs/superpowers/specs/2026-10-08-authors-design.md` (approved 2026-10-08). Roadmap: `docs/superpowers/plans/2026-10-08-authors-roadmap.md` (Stage 3).

## Global Constraints

- Author record (network repo `main`, `authors/<id>.yaml`): `id` (slug, unique, immutable), `name`, `tagline`, `bio` (60–120 words, human voice, **no invented credentials**), `beats`, `portrait: { kind: generated|uploaded, path: /authors/assets/<id>-<hash>.webp }` (absent → initials), `links { website?, x?, instagram?, linkedin? }`, `exclusive_sites` (empty/absent = may be auto-picked), `created_at`, `updated_at`.
- **Storage ruling (deviates from the spec's Mongo mirror):** authors are read from git only. Reason: under `grid dev` the dashboard's Mongo has no writable primary, and Mongo-only state drifts between local and production (seen on danatest and Similarweb). Git is the spec's source of truth anyway.
- Portraits: `gpt-image-2.5-flare`, 1024×1024, **illustrated editorial style, not photorealistic** (no fabricated photographs of people who don't exist) → WebP 512 → R2 `authors/assets/<id>-<hash>.webp`. Uploading a real photo is always possible; initials are the fallback.
- Bios: warm and human about the author's beat; **no invented credentials, degrees, employers, awards** or claims of real-world events in the author's life.
- Generation endpoint: `POST /authors/generate { part: name|tagline|bio|beats|portrait, author?, siteContext? }` → values **without saving**; the dashboard shows them as unsaved changes; "Generate everything" runs the parts in order with per-part status.
- Costs recorded with the returned model (`recordTextUsage` / `recordImageUsage`), site = the context site or `authors`.
- Every dashboard request stays well under ~60 s (CLAUDE.md #38): one slow call per request; the browser chains steps.
- Design (spec "Dashboard UI"): existing tokens (`--bg-surface`, `--bg-elevated`, `--border-primary`, `text-cyan`) and components (`Button`, `Modal`, `Toast`, `Input`, `Textarea`, `ChipMultiSelect`); 1.5-stroke outline icons; light + dark; cards `rounded-xl`, chips `rounded-full`, portraits `rounded-2xl`; small uppercase eyebrow labels; one primary action per view; 150–250 ms transitions on transform/opacity with `cubic-bezier(0.32,0.72,0,1)` and `prefers-reduced-motion` respected; skeletons for loads > 300 ms; 44 px targets for primary controls; visible focus rings; icon-only buttons labelled; badges never colour-only. **Before each UI task, invoke `/design-taste-frontend`, `/ui-ux-pro-max` and `/high-end-visual-design`** (Asaf's standing request) and apply them within this system's language — a work tool, no marketing whitespace, glass or decorative motion.
- Delete is only possible when no site uses the author (Stage 3 ruling: removing an author from sites' `authors` is part of Stage 4's assignment editing). The modal names the sites.
- Conventions: TS strict, no `any`, explicit return types, React components return `React.ReactElement`; guide page in `public/guide/` + `GUIDE_PAGES`; `.yaml`; conventional commits ending `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; stage specific files; local testing gate (no commit until Asaf approves).

## Review Focus

1. The AI returns a bio with a credential claim ("award-winning", "former editor at …", "holds a degree in …") or outside 60–120 words → retried once with the reason, then a clear error; never shown as a valid bio (tests in Task 1).
2. Generating a name that already exists in the library (any case) → never accepted; the endpoint gets the taken names (tests in Tasks 1 and 6).
3. A hand-broken `authors/x.yaml` in the repo → the list still loads and skips that file; the bad file doesn't break the screen (test in Task 3).
4. Leaving the profile with unsaved changes (sidebar link, back link, closing the tab) → asks first; Discard really discards (tests in Task 7).
5. Two authors whose names slug to the same id ("Ann Lee" and "Ann-Lee") → the second gets `ann-lee-2`, never overwrites the first (test in Task 3).
6. Portrait generation timing out or failing → that section shows the error with Retry; text sections and other changes are unaffected (test in Task 7).

---

## File Structure

| File | Responsibility |
|---|---|
| `services/content-pipeline/src/authors/text.ts` (new) | prompts, JSON parsing, validators for name/tagline/bio/beats |
| `services/content-pipeline/src/authors/portrait.ts` (new) | OpenAI flare call, WebP 512, hashed R2 key, upload |
| `services/content-pipeline/src/authors/generate.ts` (new) | `generateAuthorPart` (one part, one retry), cost recording |
| `services/content-pipeline/src/authors/http.ts` (new) | request body parsing/validation |
| `services/content-pipeline/src/agents/content-generation/index.ts` | `POST /authors/generate` route |
| `services/content-pipeline/src/costs/pricing.ts`, `src/stats/types.ts` | flare/sunburst prices; `"authors"` cost source |
| `services/dashboard/src/lib/authors/types.ts` (new) | `AuthorRecord`, `AuthorListItem`, `AuthorPart`, `SiteContext` |
| `services/dashboard/src/lib/authors/record.ts` (new) | YAML parse/serialize, id from name, input validation, incomplete check |
| `services/dashboard/src/lib/authors/store.ts` (new) | git list/read/save/delete with a 60 s cache |
| `services/dashboard/src/lib/authors/connected.ts` (new) | connected sites from site configs |
| `services/dashboard/src/lib/authors/library.ts` (new) | search, filter, sort, counts (pure) |
| `services/dashboard/src/lib/authors/generate-flow.ts` (new) | browser orchestration of parts + status |
| `services/dashboard/src/app/api/authors/**` (new) | list/create, read/update/delete, portrait upload + view, generate proxy |
| `services/dashboard/src/components/authors/*` (new) | `AuthorAvatar`, `AuthorCard`, `AuthorsLibrary`, `NewAuthorModal`, `GenerateMissingModal`, `AuthorProfileEditor`, `UnsavedChangesGuard` |
| `services/dashboard/src/app/authors/**` (new) | `/authors`, `/authors/new`, `/authors/[id]` pages + skeletons |
| `services/dashboard/src/components/layout/Sidebar.tsx` | "Authors" after Groups |
| `services/dashboard/public/guide/26-authors.md` (new) + `GUIDE_PAGES` | guide page |

---

### Task 1: Pipeline — author text prompts, parsing and validators

**Files:**
- Create: `services/content-pipeline/src/authors/text.ts`
- Test: `services/content-pipeline/src/authors/__tests__/text.test.ts`

**Interfaces:**
- Produces:
  - `type TextPart = "name" | "tagline" | "bio" | "beats"`
  - `interface AuthorDraft { name?: string; tagline?: string; bio?: string; beats?: string[] }`
  - `interface SiteContext { siteName?: string; category?: string; topics?: string[]; tone?: string; guidelines?: string; beatHint?: string }`
  - `buildTextPrompt(part: TextPart, draft: AuthorDraft, ctx: SiteContext, takenNames: string[]): { system: string; user: string }`
  - `parseTextPart(part: TextPart, raw: string, takenNames: string[]): { ok: true; value: string | string[] } | { ok: false; reason: string }`
  - `bioProblem(bio: string): string | null`

- [ ] **Step 1: Failing test**

```ts
// services/content-pipeline/src/authors/__tests__/text.test.ts
import { describe, expect, it } from "vitest";
import { bioProblem, buildTextPrompt, parseTextPart } from "../text.js";

const BIO_OK = Array.from({ length: 80 }, (_, i) => (i === 0 ? "Maya" : "word")).join(" ") + ".";

describe("bioProblem", () => {
  it("accepts a plain 60–120 word bio", () => {
    expect(bioProblem(BIO_OK)).toBeNull();
  });
  it("rejects length outside 60–120 words", () => {
    expect(bioProblem("Too short.")).toMatch(/60–120 words/);
    expect(bioProblem(Array(130).fill("word").join(" "))).toMatch(/60–120 words/);
  });
  it.each([
    "She is an award-winning writer",
    "He holds a degree in film studies",
    "A former editor at a national magazine",
    "She worked at The Times for years",
    "Graduated from Columbia University",
    "Her work has been featured in Vogue",
  ])("rejects invented credentials: %s", (claim) => {
    expect(bioProblem(`${claim}. ${BIO_OK}`)).toMatch(/credential/i);
  });
  it("rejects leaked prompt jargon", () => {
    expect(bioProblem(`${BIO_OK} As the brief says.`)).toMatch(/brief/i);
  });
});

describe("parseTextPart", () => {
  it("name: First Last, not already taken (any case)", () => {
    expect(parseTextPart("name", '{"name":"Maya Ortiz"}', [])).toEqual({ ok: true, value: "Maya Ortiz" });
    expect(parseTextPart("name", '{"name":"maya ortiz"}', ["Maya Ortiz"])).toMatchObject({ ok: false });
    expect(parseTextPart("name", '{"name":"x"}', [])).toMatchObject({ ok: false });
  });
  it("tagline: short, no trailing period", () => {
    expect(parseTextPart("tagline", '{"tagline":"Celebrity & royals writer."}', [])).toEqual({ ok: true, value: "Celebrity & royals writer" });
    expect(parseTextPart("tagline", `{"tagline":"${"x".repeat(80)}"}`, [])).toMatchObject({ ok: false });
  });
  it("beats: 2–5 unique short items", () => {
    expect(parseTextPart("beats", '{"beats":["Royals","Celebrities","royals"]}', [])).toEqual({ ok: true, value: ["Royals", "Celebrities"] });
    expect(parseTextPart("beats", '{"beats":["Only"]}', [])).toMatchObject({ ok: false });
  });
  it("tolerates code fences around the JSON; rejects non-JSON", () => {
    expect(parseTextPart("tagline", '```json\n{"tagline":"Film writer"}\n```', [])).toEqual({ ok: true, value: "Film writer" });
    expect(parseTextPart("tagline", "Film writer", [])).toMatchObject({ ok: false });
  });
});

describe("buildTextPrompt", () => {
  it("carries the site context, current draft and taken names", () => {
    const p = buildTextPrompt("bio", { name: "Maya Ortiz", beats: ["Coffee"] }, { siteName: "Coffee Actually", topics: ["Brewing"], tone: "friendly" }, ["Ella Hughes"]);
    expect(p.user).toContain("Maya Ortiz");
    expect(p.user).toContain("Coffee Actually");
    expect(p.user).toContain("Brewing");
    expect(p.system).toMatch(/no invented credentials/i);
    const n = buildTextPrompt("name", {}, {}, ["Ella Hughes"]);
    expect(n.user).toContain("Ella Hughes");
  });
});
```

Run: `cd services/content-pipeline && npx vitest run src/authors/__tests__/text.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// services/content-pipeline/src/authors/text.ts
/**
 * Author profile text: one part per call (name, tagline, bio or beats), returned as JSON and validated.
 * Bios must read like a real writer's note about their beat — never invented credentials (spec D8).
 */
export type TextPart = "name" | "tagline" | "bio" | "beats";

export interface AuthorDraft {
  name?: string;
  tagline?: string;
  bio?: string;
  beats?: string[];
}

export interface SiteContext {
  siteName?: string;
  category?: string;
  topics?: string[];
  tone?: string;
  guidelines?: string;
  /** Free-text beat typed in "New author" (e.g. "royals"). */
  beatHint?: string;
}

const CREDENTIAL_RE = /\b(award[- ]winning|awards?|ph\.?\s?d|doctorate|degrees?|bachelor'?s|master'?s|mba|universit(y|ies)|college|graduat\w*|certified|licensed|former(ly)?|worked (at|for)|editor (at|of)|writer (at|for)|staff writer|correspondent|years? (at|with)|published in|featured in|bylines? in|contributor (to|at))\b/i;

export function bioProblem(bio: string): string | null {
  const words = bio.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60 || words > 120) return `bio must be 60–120 words (got ${words})`;
  if (CREDENTIAL_RE.test(bio)) return "bio claims a credential, employer, award or publication — describe the beat and voice only";
  if (/\bthe brief\b/i.test(bio)) return 'bio mentions "the brief" — write for readers';
  return null;
}

const SYSTEM = `You write author profiles for a network of independent editorial websites.
Rules for every answer:
- Reply with ONLY a JSON object, no prose, no markdown.
- Authors are invented people: realistic, warm and human, never famous people.
- No invented credentials: no degrees, schools, employers, past jobs, awards, publications or "featured in" claims, and no claims about real-world events in the author's life.
- Write about what the author covers and how they approach it.`;

function contextLines(draft: AuthorDraft, ctx: SiteContext): string {
  return [
    ctx.siteName ? `Site: ${ctx.siteName}` : "",
    ctx.category ? `Category: ${ctx.category}` : "",
    ctx.topics?.length ? `Site topics: ${ctx.topics.join(", ")}` : "",
    ctx.tone ? `Site tone: ${ctx.tone}` : "",
    ctx.guidelines ? `Content guidelines: ${ctx.guidelines.slice(0, 600)}` : "",
    ctx.beatHint ? `Requested beat: ${ctx.beatHint}` : "",
    draft.name ? `Author name: ${draft.name}` : "",
    draft.tagline ? `Current tagline: ${draft.tagline}` : "",
    draft.beats?.length ? `Beats: ${draft.beats.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

const ASK: Record<TextPart, string> = {
  name: 'Invent a new author name (first and last name) that fits the site\'s audience. Return {"name": "First Last"}.',
  tagline: 'Write a short tagline for the author (max 60 characters, no trailing period), e.g. "Celebrity & royals writer". Return {"tagline": "..."}.',
  bio: 'Write the author\'s bio: 60–120 words, third person, warm and specific about what they cover and how they approach it. Return {"bio": "..."}.',
  beats: 'List 2–5 short beats (topics) the author covers, preferring the site\'s topics. Return {"beats": ["...", "..."]}.',
};

export function buildTextPrompt(part: TextPart, draft: AuthorDraft, ctx: SiteContext, takenNames: string[]): { system: string; user: string } {
  const taken = part === "name" && takenNames.length > 0 ? `\nNames already used (do not reuse): ${takenNames.join(", ")}` : "";
  const ctxText = contextLines(draft, ctx);
  return { system: SYSTEM, user: `${ctxText ? `${ctxText}\n\n` : ""}${ASK[part]}${taken}` };
}

function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const v = JSON.parse(cleaned) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const NAME_RE = /^[A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+){1,2}$/u;

export function parseTextPart(
  part: TextPart, raw: string, takenNames: string[],
): { ok: true; value: string | string[] } | { ok: false; reason: string } {
  const obj = parseJson(raw);
  if (!obj) return { ok: false, reason: "reply was not a JSON object" };
  const v = obj[part];
  if (part === "beats") {
    if (!Array.isArray(v)) return { ok: false, reason: "beats must be an array" };
    const seen = new Set<string>();
    const beats = v.filter((b): b is string => typeof b === "string").map((b) => b.trim())
      .filter((b) => b.length >= 2 && b.length <= 30 && !seen.has(b.toLowerCase()) && seen.add(b.toLowerCase()));
    return beats.length >= 2 && beats.length <= 5 ? { ok: true, value: beats } : { ok: false, reason: "need 2–5 unique beats" };
  }
  if (typeof v !== "string" || !v.trim()) return { ok: false, reason: `${part} missing` };
  const text = v.trim();
  if (part === "name") {
    if (!NAME_RE.test(text)) return { ok: false, reason: "name must be a first and last name" };
    if (takenNames.some((n) => n.toLowerCase() === text.toLowerCase())) return { ok: false, reason: `"${text}" is already in the library` };
    return { ok: true, value: text };
  }
  if (part === "tagline") {
    const t = text.replace(/\.+$/, "");
    return t.length >= 3 && t.length <= 60 ? { ok: true, value: t } : { ok: false, reason: "tagline must be 3–60 characters" };
  }
  const problem = bioProblem(text);
  return problem ? { ok: false, reason: problem } : { ok: true, value: text };
}
```

Run the test → Expected: PASS.

- [ ] **Step 3: Commit (after approval)** — `git add services/content-pipeline/src/authors/text.ts services/content-pipeline/src/authors/__tests__/text.test.ts && git commit -m "feat(content-pipeline): author profile text prompts and validators"`

---

### Task 2: Pipeline — portrait, one-part generation, endpoint, costs

**Files:**
- Create: `services/content-pipeline/src/authors/portrait.ts`, `services/content-pipeline/src/authors/generate.ts`, `services/content-pipeline/src/authors/http.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (route next to `/grid-summaries/*`), `services/content-pipeline/src/costs/pricing.ts` (PRICES), `services/content-pipeline/src/stats/types.ts` (`GenerationSource`)
- Test: `services/content-pipeline/src/authors/__tests__/generate.test.ts`, `services/content-pipeline/src/authors/__tests__/http.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `generateContent` (`lib/ai.ts`) → `{ text, usage, model, provider }`; `recordTextUsage`, `recordImageUsage` (`costs/recorder.ts`); `uploadToR2(key, data, contentType)` (`lib/r2-upload.ts`).
- Produces:
  - `type AuthorPart = TextPart | "portrait"`
  - `interface GenerateRequest { part: AuthorPart; authorId?: string; draft: AuthorDraft; siteContext: SiteContext & { site?: string }; takenNames: string[] }`
  - `parseGenerateBody(raw: string): GenerateRequest` (throws `AuthorGenerateError(400)`)
  - `class AuthorGenerateError extends Error { status: number }`
  - `generateAuthorPart(req: GenerateRequest, deps?: GenerateDeps): Promise<{ part: AuthorPart; value: string | string[] | { kind: "generated"; path: string }; model: string }>`
  - `portraitKey(authorId: string, webp: Buffer): string` → `authors/assets/<id>-<sha256-10>.webp`
  - Route `POST /authors/generate` → `200 { status: "ok", part, value, model }` | `4xx/5xx { status: "error", message }`

- [ ] **Step 1: Failing tests**

```ts
// services/content-pipeline/src/authors/__tests__/http.test.ts
import { describe, expect, it } from "vitest";
import { parseGenerateBody } from "../http.js";

describe("parseGenerateBody", () => {
  it("accepts a valid request and defaults the optional parts", () => {
    expect(parseGenerateBody('{"part":"bio","draft":{"name":"Maya Ortiz"}}')).toEqual({
      part: "bio", draft: { name: "Maya Ortiz" }, siteContext: {}, takenNames: [],
    });
  });
  it("rejects an unknown part, a portrait without a valid author id, and bad JSON", () => {
    expect(() => parseGenerateBody('{"part":"logo"}')).toThrow(/part/);
    expect(() => parseGenerateBody('{"part":"portrait","draft":{"name":"Maya Ortiz"}}')).toThrow(/authorId/);
    expect(() => parseGenerateBody('{"part":"portrait","authorId":"../x","draft":{}}')).toThrow(/authorId/);
    expect(() => parseGenerateBody("nope")).toThrow(/JSON/);
  });
});
```

```ts
// services/content-pipeline/src/authors/__tests__/generate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAuthorPart, portraitKey, type GenerateDeps } from "../generate.js";

const BIO = Array.from({ length: 80 }, () => "word").join(" ") + ".";

function deps(texts: string[]): GenerateDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    generateText: vi.fn(async (p: { systemPrompt: string; userPrompt: string }) => {
      calls.push(p.userPrompt);
      return { text: texts.shift() ?? "", usage: { inputTokens: 10, outputTokens: 20 }, model: "claude-sonnet-5-5" };
    }),
    generatePortrait: vi.fn(async () => ({ path: "/authors/assets/maya-ortiz-abc1234567.webp", model: "gpt-image-2.5-flare" })),
    recordText: vi.fn(async () => undefined),
    recordImage: vi.fn(async () => undefined),
  };
}

describe("generateAuthorPart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns one validated text part and records its cost under the context site", async () => {
    const d = deps([`{"bio":"${BIO}"}`]);
    const out = await generateAuthorPart({ part: "bio", draft: { name: "Maya Ortiz" }, siteContext: { site: "coffeeactually" }, takenNames: [] }, d);
    expect(out).toEqual({ part: "bio", value: BIO, model: "claude-sonnet-5-5" });
    expect(d.recordText).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "coffeeactually", model: "claude-sonnet-5-5" }));
  });

  it("retries once with the reason when the first answer is invalid", async () => {
    const d = deps(['{"bio":"She is an award-winning writer."}', `{"bio":"${BIO}"}`]);
    const out = await generateAuthorPart({ part: "bio", draft: {}, siteContext: {}, takenNames: [] }, d);
    expect(out.value).toBe(BIO);
    expect(d.calls[1]).toMatch(/previous answer was rejected/i);
    expect(d.recordText).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "authors" }));
  });

  it("fails with 422 after two invalid answers (never returns a bad value)", async () => {
    const d = deps(['{"name":"Ella Hughes"}', '{"name":"ella hughes"}']);
    await expect(generateAuthorPart({ part: "name", draft: {}, siteContext: {}, takenNames: ["Ella Hughes"] }, d))
      .rejects.toMatchObject({ status: 422 });
  });

  it("portrait: delegates to the portrait generator and records one image", async () => {
    const d = deps([]);
    const out = await generateAuthorPart({ part: "portrait", authorId: "maya-ortiz", draft: { name: "Maya Ortiz", beats: ["Coffee"] }, siteContext: {}, takenNames: [] }, d);
    expect(out).toEqual({ part: "portrait", value: { kind: "generated", path: "/authors/assets/maya-ortiz-abc1234567.webp" }, model: "gpt-image-2.5-flare" });
    expect(d.recordImage).toHaveBeenCalledWith(expect.objectContaining({ images: 1, model: "gpt-image-2.5-flare" }));
  });
});

describe("portraitKey", () => {
  it("is content-hashed under authors/assets", () => {
    expect(portraitKey("maya-ortiz", Buffer.from("x"))).toMatch(/^authors\/assets\/maya-ortiz-[0-9a-f]{10}\.webp$/);
  });
});
```

Run: `cd services/content-pipeline && npx vitest run src/authors` → Expected: FAIL (modules not found).

- [ ] **Step 2: `http.ts`**

```ts
// services/content-pipeline/src/authors/http.ts
import type { AuthorDraft, SiteContext } from "./text.js";
import type { AuthorPart, GenerateRequest } from "./generate.js";

export class AuthorGenerateError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

const PARTS: ReadonlySet<AuthorPart> = new Set(["name", "tagline", "bio", "beats", "portrait"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);

export function parseGenerateBody(raw: string): GenerateRequest {
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    throw new AuthorGenerateError("body must be JSON", 400);
  }
  const part = body.part as AuthorPart;
  if (!PARTS.has(part)) throw new AuthorGenerateError("part must be name, tagline, bio, beats or portrait", 400);
  const d = (body.draft && typeof body.draft === "object" ? body.draft : {}) as Record<string, unknown>;
  const draft: AuthorDraft = {};
  if (str(d.name)) draft.name = str(d.name);
  if (str(d.tagline)) draft.tagline = str(d.tagline);
  if (str(d.bio)) draft.bio = str(d.bio);
  if (strs(d.beats)?.length) draft.beats = strs(d.beats);
  const c = (body.siteContext && typeof body.siteContext === "object" ? body.siteContext : {}) as Record<string, unknown>;
  const siteContext: SiteContext & { site?: string } = {};
  for (const k of ["site", "siteName", "category", "tone", "guidelines", "beatHint"] as const) if (str(c[k])) siteContext[k] = str(c[k]);
  if (strs(c.topics)?.length) siteContext.topics = strs(c.topics);
  const authorId = str(body.authorId);
  if (part === "portrait" && (!authorId || !ID_RE.test(authorId))) throw new AuthorGenerateError("portrait needs a valid authorId", 400);
  return {
    part,
    ...(authorId && ID_RE.test(authorId) ? { authorId } : {}),
    draft,
    siteContext,
    takenNames: strs(body.takenNames) ?? [],
  };
}
```

- [ ] **Step 3: `portrait.ts`**

```ts
// services/content-pipeline/src/authors/portrait.ts
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
```

- [ ] **Step 4: `generate.ts`**

```ts
// services/content-pipeline/src/authors/generate.ts
import { generateContent } from "../lib/ai.js";
import { recordImageUsage, recordTextUsage } from "../costs/recorder.js";
import { buildTextPrompt, parseTextPart, type AuthorDraft, type SiteContext, type TextPart } from "./text.js";
import { generatePortraitImage, portraitKey } from "./portrait.js";
import { AuthorGenerateError } from "./http.js";

export { portraitKey };
export type AuthorPart = TextPart | "portrait";

export interface GenerateRequest {
  part: AuthorPart;
  authorId?: string;
  draft: AuthorDraft;
  siteContext: SiteContext & { site?: string };
  takenNames: string[];
}

export interface GenerateDeps {
  generateText(p: { systemPrompt: string; userPrompt: string; maxTokens?: number }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; estimated?: boolean }; model: string }>;
  generatePortrait(authorId: string, draft: AuthorDraft): Promise<{ path: string; model: string }>;
  recordText(p: Parameters<typeof recordTextUsage>[0]): Promise<void>;
  recordImage(p: Parameters<typeof recordImageUsage>[0]): Promise<void>;
}

const DEFAULT_DEPS: GenerateDeps = {
  generateText: (p) => generateContent(p),
  generatePortrait: (id, draft) => generatePortraitImage(id, draft),
  recordText: recordTextUsage,
  recordImage: recordImageUsage,
};

type PartValue = string | string[] | { kind: "generated"; path: string };

/** One profile part, validated; text parts get one retry with the rejection reason. Nothing is saved. */
export async function generateAuthorPart(req: GenerateRequest, deps: GenerateDeps = DEFAULT_DEPS): Promise<{ part: AuthorPart; value: PartValue; model: string }> {
  const site = req.siteContext.site ?? "authors";
  if (req.part === "portrait") {
    try {
      const { path, model } = await deps.generatePortrait(req.authorId!, req.draft);
      await deps.recordImage({ siteDomain: site, source: "authors", model, images: 1 });
      return { part: "portrait", value: { kind: "generated", path }, model };
    } catch (err) {
      throw new AuthorGenerateError(`Portrait failed: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  }
  const prompt = buildTextPrompt(req.part, req.draft, req.siteContext, req.takenNames);
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = attempt === 0 ? prompt.user : `${prompt.user}\n\nYour previous answer was rejected: ${reason}. Try again, following every rule.`;
    const out = await deps.generateText({ systemPrompt: prompt.system, userPrompt, maxTokens: 600 });
    await deps.recordText({ siteDomain: site, source: "authors", model: out.model, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, estimated: out.usage.estimated ?? false });
    const parsed = parseTextPart(req.part, out.text, req.takenNames);
    if (parsed.ok) return { part: req.part, value: parsed.value, model: out.model };
    reason = parsed.reason;
  }
  throw new AuthorGenerateError(`Couldn't generate a valid ${req.part}: ${reason}`, 422);
}
```

(`TokenUsage` in `src/costs/usage.ts` is `{ inputTokens, outputTokens, estimated }` — passed through.)

- [ ] **Step 5: Costs + route**

`src/stats/types.ts`: `export type GenerationSource = "scheduler" | "dashboard" | "wp-import" | "grid-summaries" | "authors";`

`src/costs/pricing.ts` PRICES, after the Gemini image entry:

```ts
  // OpenAI GPT Image 2.5 (flare = author portraits, sunburst = dashboard logos) — ~$0.053 per
  // 1024×1024 high-quality image (OpenAI calculator estimate, 2026-10; both models price the same).
  "gpt-image-2.5-flare": { kind: "image", perImage: 0.053 },
  "gpt-image-2.5-sunburst": { kind: "image", perImage: 0.053 },
```

`index.ts`: import `{ generateAuthorPart }` from `"../../authors/generate.js"` and `{ parseGenerateBody, AuthorGenerateError }` from `"../../authors/http.js"`; next to the grid-summaries block add:

```ts
  // Authors — POST /authors/generate: one profile part, not saved (the dashboard shows it as unsaved).
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/authors/generate") {
      try {
        const out = await generateAuthorPart(parseGenerateBody(await readBody(req)));
        sendJson(res, 200, { status: "ok", ...out });
      } catch (err) {
        const status = err instanceof AuthorGenerateError ? err.status : 500;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[server] /authors/generate error:", message);
        sendJson(res, status, { status: "error", message });
      }
      return;
    }
  }
```

- [ ] **Step 6: Tests + typecheck**

Run: `cd services/content-pipeline && npx vitest run src/authors && pnpm typecheck && npx vitest run`
Expected: author tests pass; typecheck exit 0; full suite passes.

- [ ] **Step 7: Commit (after approval)** — the five pipeline files plus tests: `git commit -m "feat(content-pipeline): POST /authors/generate — one profile part per call, portraits on gpt-image-2.5-flare"`

---

### Task 3: Dashboard — author record model and git store

**Files:**
- Create: `services/dashboard/src/lib/authors/types.ts`, `record.ts`, `store.ts`, `connected.ts`
- Test: `services/dashboard/src/lib/authors/__tests__/record.test.ts`, `store.test.ts`, `connected.test.ts`

**Interfaces:**
- Produces:
  - types (below)
  - `parseAuthorYaml(id: string, raw: string): AuthorRecord | null`, `serializeAuthor(a: AuthorRecord): string`
  - `authorIdFromName(name: string, taken: Iterable<string>): string`
  - `validateAuthorInput(input: unknown): { ok: true; value: AuthorInput } | { ok: false; error: string }`
  - `isIncomplete(a: Pick<AuthorRecord, "bio" | "portrait">): boolean`
  - `listAuthors(): Promise<AuthorRecord[]>`, `readAuthor(id: string): Promise<AuthorRecord | null>`, `createAuthor(input: AuthorInput): Promise<AuthorRecord>`, `updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord>`, `deleteAuthor(id: string): Promise<void>`, `AUTHORS_DIR = "authors"`
  - `connectedSitesByAuthor(configs: Array<Record<string, unknown>>): Map<string, Array<{ site: string; topics: string[] }>>`

- [ ] **Step 1: Types**

```ts
// services/dashboard/src/lib/authors/types.ts
export interface AuthorPortrait {
  kind: "generated" | "uploaded";
  /** Site-relative R2 path: /authors/assets/<id>-<hash>.webp */
  path: string;
}

export interface AuthorLinks {
  website?: string;
  x?: string;
  instagram?: string;
  linkedin?: string;
}

/** Network repo authors/<id>.yaml — the source of truth (spec "Author record"). */
export interface AuthorRecord {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  beats: string[];
  portrait: AuthorPortrait | null;
  links: AuthorLinks;
  exclusive_sites: string[];
  created_at: string;
  updated_at: string;
}

/** What the editor sends to save (id/timestamps are the server's). */
export type AuthorInput = Omit<AuthorRecord, "id" | "created_at" | "updated_at">;

export interface ConnectedSite {
  site: string;
  topics: string[];
}

/** One library card. */
export interface AuthorListItem extends AuthorRecord {
  sites: ConnectedSite[];
}

export type AuthorPart = "name" | "tagline" | "bio" | "beats" | "portrait";
```

- [ ] **Step 2: Failing tests**

```ts
// services/dashboard/src/lib/authors/__tests__/record.test.ts
import { describe, expect, it } from "vitest";
import { authorIdFromName, isIncomplete, parseAuthorYaml, serializeAuthor, validateAuthorInput } from "../record";
import type { AuthorRecord } from "../types";

const ELLA: AuthorRecord = {
  id: "ella-hughes", name: "Ella Hughes", tagline: "Celebrity & royals writer", bio: "Writes about royals.",
  beats: ["Celebrities", "Royals"], portrait: { kind: "generated", path: "/authors/assets/ella-hughes-abc1234567.webp" },
  links: { x: "https://x.com/ella" }, exclusive_sites: ["scoopella"],
  created_at: "2026-10-12T08:00:00.000Z", updated_at: "2026-10-12T08:00:00.000Z",
};

describe("author yaml", () => {
  it("round-trips a record", () => {
    expect(parseAuthorYaml("ella-hughes", serializeAuthor(ELLA))).toEqual(ELLA);
  });
  it("returns null for a hand-broken file or an id that doesn't match the file name", () => {
    expect(parseAuthorYaml("ella-hughes", "name: [oops")).toBeNull();
    expect(parseAuthorYaml("someone-else", serializeAuthor(ELLA))).toBeNull();
    expect(parseAuthorYaml("ella-hughes", "id: ella-hughes\n")).toBeNull();
  });
  it("fills defaults for missing optional fields", () => {
    expect(parseAuthorYaml("a-b", "id: a-b\nname: A B\n")).toMatchObject({ tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] });
  });
});

describe("authorIdFromName", () => {
  it("slugs the name and never reuses a taken id", () => {
    expect(authorIdFromName("Ella Hughes", [])).toBe("ella-hughes");
    expect(authorIdFromName("Ann-Lee", ["ann-lee"])).toBe("ann-lee-2");
    expect(authorIdFromName("Ann Lee", ["ann-lee", "ann-lee-2"])).toBe("ann-lee-3");
    expect(authorIdFromName("Zoë Ångström", [])).toBe("zoe-angstrom");
  });
});

describe("validateAuthorInput", () => {
  const base = { name: "Ella Hughes", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };
  it("accepts a minimal author", () => {
    expect(validateAuthorInput(base)).toMatchObject({ ok: true });
  });
  it("rejects a missing name, a non-http link and a portrait outside /authors/assets/", () => {
    expect(validateAuthorInput({ ...base, name: " " })).toMatchObject({ ok: false });
    expect(validateAuthorInput({ ...base, links: { website: "javascript:alert(1)" } })).toMatchObject({ ok: false });
    expect(validateAuthorInput({ ...base, portrait: { kind: "uploaded", path: "/scoopella/assets/x.webp" } })).toMatchObject({ ok: false });
  });
});

describe("isIncomplete", () => {
  it("missing bio or portrait", () => {
    expect(isIncomplete(ELLA)).toBe(false);
    expect(isIncomplete({ ...ELLA, portrait: null })).toBe(true);
    expect(isIncomplete({ ...ELLA, bio: " " })).toBe(true);
  });
});
```

```ts
// services/dashboard/src/lib/authors/__tests__/store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("@/lib/github", () => ({
  listNetworkDirectory: vi.fn(async (dir: string) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => ({ name: p.split("/").pop()!, type: "file", path: p }))),
  readFileContent: vi.fn(async (p: string) => files.get(p) ?? null),
  commitNetworkFiles: vi.fn(async (f: Array<{ path: string; content: string }>) => { for (const x of f) files.set(x.path, String(x.content)); }),
  deleteNetworkFile: vi.fn(async (p: string) => { files.delete(p); }),
}));

import { createAuthor, deleteAuthor, listAuthors, readAuthor, updateAuthor, _resetAuthorCache } from "../store";

const input = { name: "Ann Lee", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };

describe("author store (network repo authors/*.yaml)", () => {
  beforeEach(() => { files.clear(); _resetAuthorCache(); });

  it("create → list → read; the same name twice gets a new id, never overwrites", async () => {
    const a = await createAuthor(input);
    const b = await createAuthor({ ...input, name: "Ann-Lee" });
    expect([a.id, b.id]).toEqual(["ann-lee", "ann-lee-2"]);
    expect((await listAuthors()).map((x) => x.id).sort()).toEqual(["ann-lee", "ann-lee-2"]);
    expect((await readAuthor("ann-lee"))?.name).toBe("Ann Lee");
  });

  it("skips a hand-broken file instead of failing the whole list", async () => {
    await createAuthor(input);
    files.set("authors/broken.yaml", "name: [oops");
    _resetAuthorCache();
    expect((await listAuthors()).map((x) => x.id)).toEqual(["ann-lee"]);
  });

  it("update keeps id and created_at, bumps updated_at; delete removes the file", async () => {
    const a = await createAuthor(input);
    const u = await updateAuthor(a.id, { ...input, tagline: "Film writer" });
    expect(u).toMatchObject({ id: a.id, created_at: a.created_at, tagline: "Film writer" });
    await deleteAuthor(a.id);
    expect(await readAuthor(a.id)).toBeNull();
  });
});
```

```ts
// services/dashboard/src/lib/authors/__tests__/connected.test.ts
import { describe, expect, it } from "vitest";
import { connectedSitesByAuthor } from "../connected";

describe("connectedSitesByAuthor", () => {
  it("maps author id → sites with their topics; ignores malformed entries", () => {
    const map = connectedSitesByAuthor([
      { domain: "scoopella", authors: [{ id: "ella-hughes", topics: ["Royals"] }, { id: "ben-foster" }] },
      { domain: "popstorylab", authors: [{ id: "ben-foster", topics: [] }, "junk"] },
      { domain: "nope" },
    ]);
    expect(map.get("ella-hughes")).toEqual([{ site: "scoopella", topics: ["Royals"] }]);
    expect(map.get("ben-foster")).toEqual([{ site: "scoopella", topics: [] }, { site: "popstorylab", topics: [] }]);
  });
});
```

Run: `cd services/dashboard && npx vitest run src/lib/authors` → Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// services/dashboard/src/lib/authors/record.ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AuthorInput, AuthorRecord } from "./types";

export const AUTHOR_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LINK_KEYS = ["website", "x", "instagram", "linkedin"] as const;

const isHttp = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
const validPortraitPath = (p: unknown): p is string => typeof p === "string" && p.startsWith("/authors/assets/") && !p.includes("..");

export function parseAuthorYaml(id: string, raw: string): AuthorRecord | null {
  let doc: unknown;
  try { doc = parseYaml(raw); } catch { return null; }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (d.id !== id || !AUTHOR_ID_RE.test(id) || typeof d.name !== "string" || !d.name.trim()) return null;
  const p = d.portrait as Record<string, unknown> | undefined;
  const links: AuthorRecord["links"] = {};
  const rawLinks = (d.links && typeof d.links === "object" ? d.links : {}) as Record<string, unknown>;
  for (const k of LINK_KEYS) if (isHttp(rawLinks[k])) links[k] = rawLinks[k] as string;
  return {
    id,
    name: d.name.trim(),
    tagline: typeof d.tagline === "string" ? d.tagline.trim() : "",
    bio: typeof d.bio === "string" ? d.bio.trim() : "",
    beats: strList(d.beats),
    portrait: p && validPortraitPath(p.path) ? { kind: p.kind === "uploaded" ? "uploaded" : "generated", path: p.path } : null,
    links,
    exclusive_sites: strList(d.exclusive_sites),
    created_at: typeof d.created_at === "string" ? d.created_at : "",
    updated_at: typeof d.updated_at === "string" ? d.updated_at : "",
  };
}

export function serializeAuthor(a: AuthorRecord): string {
  const doc: Record<string, unknown> = {
    id: a.id, name: a.name, tagline: a.tagline, bio: a.bio, beats: a.beats,
    ...(a.portrait ? { portrait: a.portrait } : {}),
    links: a.links, exclusive_sites: a.exclusive_sites,
    created_at: a.created_at, updated_at: a.updated_at,
  };
  return stringifyYaml(doc, { lineWidth: 0 });
}

export function authorIdFromName(name: string, taken: Iterable<string>): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "author";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function isIncomplete(a: Pick<AuthorRecord, "bio" | "portrait">): boolean {
  return !a.bio.trim() || !a.portrait;
}

export function validateAuthorInput(input: unknown): { ok: true; value: AuthorInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "author is required" };
  const i = input as Record<string, unknown>;
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Name must be 2–60 characters" };
  const tagline = typeof i.tagline === "string" ? i.tagline.trim() : "";
  if (tagline.length > 80) return { ok: false, error: "Tagline must be 80 characters or fewer" };
  const bio = typeof i.bio === "string" ? i.bio.trim() : "";
  if (bio.length > 1500) return { ok: false, error: "Bio is too long" };
  const beats = strList(i.beats);
  if (beats.length > 8) return { ok: false, error: "At most 8 beats" };
  const links: AuthorInput["links"] = {};
  const rawLinks = (i.links && typeof i.links === "object" ? i.links : {}) as Record<string, unknown>;
  for (const k of LINK_KEYS) {
    const v = rawLinks[k];
    if (v === undefined || v === null || v === "") continue;
    if (!isHttp(v)) return { ok: false, error: `${k} must be an http(s) link` };
    links[k] = v;
  }
  const p = i.portrait as Record<string, unknown> | null | undefined;
  if (p && !validPortraitPath(p.path)) return { ok: false, error: "Portrait must be an /authors/assets/ image" };
  return {
    ok: true,
    value: {
      name, tagline, bio, beats, links,
      portrait: p ? { kind: p.kind === "uploaded" ? "uploaded" : "generated", path: p.path as string } : null,
      exclusive_sites: strList(i.exclusive_sites),
    },
  };
}
```

```ts
// services/dashboard/src/lib/authors/store.ts
import { commitNetworkFiles, deleteNetworkFile, listNetworkDirectory, readFileContent } from "@/lib/github";
import { authorIdFromName, parseAuthorYaml, serializeAuthor } from "./record";
import type { AuthorInput, AuthorRecord } from "./types";

/**
 * Author library in the network repo (main, authors/<id>.yaml) — read and written straight from git so local and
 * production dashboards always agree (no Mongo mirror; see the plan's storage ruling). A 60 s in-memory cache keeps
 * list loads fast; every write clears it.
 */
export const AUTHORS_DIR = "authors";
const CACHE_MS = 60_000;
let cache: { at: number; authors: AuthorRecord[] } | null = null;

export function _resetAuthorCache(): void {
  cache = null;
}

export async function listAuthors(): Promise<AuthorRecord[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.authors;
  const entries = (await listNetworkDirectory(AUTHORS_DIR, "main")).filter((e) => e.type === "file" && e.name.endsWith(".yaml"));
  const authors = (await Promise.all(entries.map(async (e) => {
    const raw = await readFileContent(e.path, "main");
    const parsed = raw ? parseAuthorYaml(e.name.replace(/\.yaml$/, ""), raw) : null;
    if (!parsed) console.warn(`[authors] skipping unreadable ${e.path}`);
    return parsed;
  }))).filter((a): a is AuthorRecord => a !== null);
  authors.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), authors };
  return authors;
}

export async function readAuthor(id: string): Promise<AuthorRecord | null> {
  return (await listAuthors()).find((a) => a.id === id) ?? null;
}

async function write(a: AuthorRecord, verb: "add" | "update"): Promise<AuthorRecord> {
  await commitNetworkFiles([{ path: `${AUTHORS_DIR}/${a.id}.yaml`, content: serializeAuthor(a) }], `dashboard: ${verb} author ${a.id}`, "main");
  cache = null;
  return a;
}

export async function createAuthor(input: AuthorInput): Promise<AuthorRecord> {
  const taken = (await listAuthors()).map((a) => a.id);
  const now = new Date().toISOString();
  return write({ ...input, id: authorIdFromName(input.name, taken), created_at: now, updated_at: now }, "add");
}

export async function updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord> {
  const current = await readAuthor(id);
  if (!current) throw new Error(`author ${id} not found`);
  return write({ ...input, id, created_at: current.created_at, updated_at: new Date().toISOString() }, "update");
}

export async function deleteAuthor(id: string): Promise<void> {
  await deleteNetworkFile(`${AUTHORS_DIR}/${id}.yaml`, `dashboard: delete author ${id}`, "main");
  cache = null;
}
```

```ts
// services/dashboard/src/lib/authors/connected.ts
import type { ConnectedSite } from "./types";

/** Site configs (Mongo in production) → author id → the sites that list them in `authors`. */
export function connectedSitesByAuthor(configs: Array<Record<string, unknown>>): Map<string, ConnectedSite[]> {
  const map = new Map<string, ConnectedSite[]>();
  for (const cfg of configs) {
    const site = typeof cfg.domain === "string" ? cfg.domain : null;
    if (!site || !Array.isArray(cfg.authors)) continue;
    for (const entry of cfg.authors) {
      if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") continue;
      const { id, topics } = entry as { id: string; topics?: unknown };
      const list = map.get(id) ?? [];
      list.push({ site, topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string") : [] });
      map.set(id, list);
    }
  }
  return map;
}
```

Run: `cd services/dashboard && npx vitest run src/lib/authors && pnpm typecheck` → Expected: PASS; exit 0.

- [ ] **Step 4: Commit (after approval)** — the four lib files + three tests: `git commit -m "feat(dashboard): author records in the network repo (authors/<id>.yaml)"`

Note for local testing: `listSiteConfigs()` returns `[]` when `USE_MONGO_READS` is off (local), so "connected sites" are empty locally until Stage 4 — expected.

---

### Task 4: Dashboard — API routes

**Files:**
- Create: `services/dashboard/src/app/api/authors/route.ts` (GET list, POST create), `src/app/api/authors/[id]/route.ts` (GET, PUT, DELETE), `src/app/api/authors/portrait/route.ts` (GET view, POST upload), `src/app/api/authors/generate/route.ts` (POST proxy)
- Test: `services/dashboard/src/app/api/authors/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: Task 3 store/record/connected; `listSiteConfigs` (`@/lib/db/site-configs`); `uploadToR2`, `readFromR2` (`@/lib/r2-upload`); `getAgentUrl` (`@/lib/grid-agent-url`).
- Produces (JSON):
  - `GET /api/authors` → `{ authors: AuthorListItem[] }`
  - `POST /api/authors { author }` → `201 { author }` | `400 { error }`
  - `GET /api/authors/[id]` → `{ author: AuthorListItem }` | `404`
  - `PUT /api/authors/[id] { author }` → `{ author }` | `400` | `404`
  - `DELETE /api/authors/[id]` → `{ ok: true }` | `409 { error, sites }` (still on sites)
  - `POST /api/authors/portrait` multipart `file`, `authorId` → `{ portrait: { kind: "uploaded", path } }`
  - `GET /api/authors/portrait?path=/authors/assets/x.webp` → image bytes
  - `POST /api/authors/generate` → pipeline JSON passthrough (`{ status, part, value, model }` | `{ status: "error", message }`), 55 s timeout

- [ ] **Step 1: Failing route test**

```ts
// services/dashboard/src/app/api/authors/__tests__/routes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorRecord } from "@/lib/authors/types";

const db: AuthorRecord[] = [];
vi.mock("@/lib/authors/store", () => ({
  listAuthors: vi.fn(async () => db),
  readAuthor: vi.fn(async (id: string) => db.find((a) => a.id === id) ?? null),
  createAuthor: vi.fn(async (input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => { const a = { ...input, id: "maya-ortiz", created_at: "t", updated_at: "t" }; db.push(a); return a; }),
  updateAuthor: vi.fn(async (id: string, input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => ({ ...input, id, created_at: "t", updated_at: "u" })),
  deleteAuthor: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/site-configs", () => ({
  listSiteConfigs: vi.fn(async () => [{ domain: "scoopella", authors: [{ id: "ella-hughes", topics: ["Royals"] }] }]),
}));

import { GET as list, POST as create } from "../route";
import { DELETE as remove, GET as one } from "../[id]/route";

const ELLA: AuthorRecord = { id: "ella-hughes", name: "Ella Hughes", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [], created_at: "t", updated_at: "t" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("authors API", () => {
  beforeEach(() => { db.length = 0; db.push(ELLA); });

  it("list includes each author's connected sites", async () => {
    const body = await (await list()).json();
    expect(body.authors[0]).toMatchObject({ id: "ella-hughes", sites: [{ site: "scoopella", topics: ["Royals"] }] });
  });

  it("create validates the input", async () => {
    const bad = await create(new Request("http://x", { method: "POST", body: JSON.stringify({ author: { name: "" } }) }) as never);
    expect(bad.status).toBe(400);
    const ok = await create(new Request("http://x", { method: "POST", body: JSON.stringify({ author: { name: "Maya Ortiz" } }) }) as never);
    expect(ok.status).toBe(201);
  });

  it("read 404s an unknown id", async () => {
    expect((await one(new Request("http://x") as never, ctx("nobody"))).status).toBe(404);
  });

  it("delete refuses while sites still use the author, naming them", async () => {
    const res = await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("ella-hughes"));
    expect(res.status).toBe(409);
    expect((await res.json()).sites).toEqual(["scoopella"]);
  });
});
```

Run: `cd services/dashboard && npx vitest run src/app/api/authors` → Expected: FAIL (route modules missing).

- [ ] **Step 2: Implement routes**

```ts
// services/dashboard/src/app/api/authors/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createAuthor, listAuthors } from "@/lib/authors/store";
import { validateAuthorInput } from "@/lib/authors/record";
import { connectedSitesByAuthor } from "@/lib/authors/connected";
import { listSiteConfigs } from "@/lib/db/site-configs";
import type { AuthorListItem, AuthorRecord } from "@/lib/authors/types";

export const dynamic = "force-dynamic";

/** Authors + the sites using each (site configs; empty locally where Mongo reads are off). */
export async function withSites(authors: AuthorRecord[]): Promise<AuthorListItem[]> {
  const configs = await listSiteConfigs().catch(() => []);
  const map = connectedSitesByAuthor(configs);
  return authors.map((a) => ({ ...a, sites: map.get(a.id) ?? [] }));
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ authors: await withSites(await listAuthors()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { author?: unknown };
  const v = validateAuthorInput(body.author);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json({ author: await createAuthor(v.value) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

```ts
// services/dashboard/src/app/api/authors/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { deleteAuthor, readAuthor, updateAuthor } from "@/lib/authors/store";
import { validateAuthorInput } from "@/lib/authors/record";
import { withSites } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  return NextResponse.json({ author: (await withSites([author]))[0] });
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!(await readAuthor(id))) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { author?: unknown };
  const v = validateAuthorInput(body.author);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json({ author: await updateAuthor(id, v.value) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Stage 3: an author still on sites can't be deleted (removing them from sites arrives with Stage 4's editing). */
export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) return NextResponse.json({ error: "Author not found" }, { status: 404 });
  const [withConnected] = await withSites([author]);
  if (withConnected!.sites.length > 0) {
    return NextResponse.json({ error: "Remove this author from their sites first", sites: withConnected!.sites.map((s) => s.site) }, { status: 409 });
  }
  await deleteAuthor(id);
  return NextResponse.json({ ok: true });
}
```

```ts
// services/dashboard/src/app/api/authors/portrait/route.ts
import { createHash } from "node:crypto";
import sharp from "sharp";
import { NextResponse, type NextRequest } from "next/server";
import { readFromR2, uploadToR2 } from "@/lib/r2-upload";
import { AUTHOR_ID_RE } from "@/lib/authors/record";

/** Serve a portrait from R2 for the dashboard (sites use their own /authors/assets/* route). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!path.startsWith("/authors/assets/") || path.includes("..")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const buf = await readFromR2(path.slice(1));
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
}

/** Upload a real photo: square-cropped 512 px WebP, content-hashed name. Not saved to the author until Save. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const authorId = String(form?.get("authorId") ?? "");
  if (!(file instanceof Blob) || !AUTHOR_ID_RE.test(authorId)) return NextResponse.json({ error: "file and authorId are required" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 8 MB" }, { status: 400 });
  try {
    const webp = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
    const key = `authors/assets/${authorId}-${createHash("sha256").update(webp).digest("hex").slice(0, 10)}.webp`;
    if (!(await uploadToR2(key, webp, "image/webp"))) return NextResponse.json({ error: "Upload failed" }, { status: 502 });
    return NextResponse.json({ portrait: { kind: "uploaded", path: `/${key}` } });
  } catch {
    return NextResponse.json({ error: "That file isn't an image we can read" }, { status: 400 });
  }
}
```

```ts
// services/dashboard/src/app/api/authors/generate/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";

/** Proxy to the pipeline: one profile part per request (each well under the ~60 s gateway limit). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  try {
    const res = await fetch(`${getAgentUrl()}/authors/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(55_000),
    });
    const out = (await res.json().catch(() => ({ status: "error", message: `pipeline returned ${res.status}` }))) as Record<string, unknown>;
    return NextResponse.json(out, { status: res.status });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json({ status: "error", message: timedOut ? "Generation took too long — try again" : String(err) }, { status: 504 });
  }
}
```

Run: `cd services/dashboard && npx vitest run src/app/api/authors && pnpm typecheck` → Expected: PASS; exit 0.

- [ ] **Step 3: Commit (after approval)** — the four route files + test: `git commit -m "feat(dashboard): authors API (list, CRUD, portrait upload/view, generate proxy)"`

---

### Task 5: Dashboard — library logic, Authors list page, sidebar

**Before writing UI:** invoke `/design-taste-frontend`, `/ui-ux-pro-max`, `/high-end-visual-design`; apply their guidance inside the Global Constraints' design rules (dashboard tokens and components; no new fonts or palettes).

**Files:**
- Create: `services/dashboard/src/lib/authors/library.ts`, `src/components/authors/AuthorAvatar.tsx`, `src/components/authors/AuthorCard.tsx`, `src/components/authors/AuthorsLibrary.tsx`, `src/app/authors/page.tsx`, `src/app/authors/loading.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (item after Groups)
- Test: `src/lib/authors/__tests__/library.test.ts`, `src/components/authors/__tests__/AuthorsLibrary.test.tsx`

**Interfaces:**
- Consumes: `AuthorListItem` (Task 3), `isIncomplete` (Task 3), `listAuthors` + `withSites` (Tasks 3–4).
- Produces: `type LibraryFilter = "all" | "exclusive" | "unassigned" | "incomplete"`; `type LibrarySort = "updated" | "name" | "sites"`; `filterAuthors(items: AuthorListItem[], q: string, filter: LibraryFilter, sort: LibrarySort): AuthorListItem[]`; `filterCounts(items: AuthorListItem[]): Record<LibraryFilter, number>`; `AuthorAvatar({ name, portrait, size }): React.ReactElement`; `AuthorsLibrary({ authors }): React.ReactElement`.

- [ ] **Step 1: Failing tests**

```ts
// services/dashboard/src/lib/authors/__tests__/library.test.ts
import { describe, expect, it } from "vitest";
import { filterAuthors, filterCounts } from "../library";
import type { AuthorListItem } from "../types";

const mk = (id: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name: id, tagline: "", bio: "A bio.", beats: [], portrait: { kind: "generated", path: `/authors/assets/${id}.webp` },
  links: {}, exclusive_sites: [], created_at: "2026-01-01", updated_at: "2026-01-01", sites: [], ...extra,
});
const ITEMS = [
  mk("ella", { name: "Ella Hughes", tagline: "Royals writer", exclusive_sites: ["scoopella"], sites: [{ site: "scoopella", topics: [] }], updated_at: "2026-10-02" }),
  mk("ben", { name: "Ben Foster", beats: ["Fashion"], portrait: null, updated_at: "2026-10-03" }),
  mk("cara", { name: "Cara Diaz", sites: [{ site: "popstorylab", topics: [] }, { site: "viralsides", topics: [] }], updated_at: "2026-10-01" }),
];

describe("filterAuthors", () => {
  it("search matches name, tagline, beats and site names (case-insensitive)", () => {
    expect(filterAuthors(ITEMS, "royals", "all", "name").map((a) => a.id)).toEqual(["ella"]);
    expect(filterAuthors(ITEMS, "FASHION", "all", "name").map((a) => a.id)).toEqual(["ben"]);
    expect(filterAuthors(ITEMS, "viralsides", "all", "name").map((a) => a.id)).toEqual(["cara"]);
  });
  it("filters: exclusive, not on any site, incomplete", () => {
    expect(filterAuthors(ITEMS, "", "exclusive", "name").map((a) => a.id)).toEqual(["ella"]);
    expect(filterAuthors(ITEMS, "", "unassigned", "name").map((a) => a.id)).toEqual(["ben"]);
    expect(filterAuthors(ITEMS, "", "incomplete", "name").map((a) => a.id)).toEqual(["ben"]);
  });
  it("sorts by recently updated, name, or number of sites", () => {
    expect(filterAuthors(ITEMS, "", "all", "updated").map((a) => a.id)).toEqual(["ben", "ella", "cara"]);
    expect(filterAuthors(ITEMS, "", "all", "name").map((a) => a.id)).toEqual(["ben", "cara", "ella"]);
    expect(filterAuthors(ITEMS, "", "all", "sites").map((a) => a.id)).toEqual(["cara", "ella", "ben"]);
  });
  it("counts per filter", () => {
    expect(filterCounts(ITEMS)).toEqual({ all: 3, exclusive: 1, unassigned: 1, incomplete: 1 });
  });
});
```

```tsx
// services/dashboard/src/components/authors/__tests__/AuthorsLibrary.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/authors",
}));

import { AuthorsLibrary } from "../AuthorsLibrary";
import type { AuthorListItem } from "@/lib/authors/types";

afterEach(() => { cleanup(); replace.mockClear(); search = ""; });

const mk = (id: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name: id, tagline: "", bio: "Bio", beats: [], portrait: { kind: "generated", path: `/authors/assets/${id}.webp` },
  links: {}, exclusive_sites: [], created_at: "", updated_at: "", sites: [], ...extra,
});

describe("AuthorsLibrary", () => {
  it("cards link to the profile; exclusive and incomplete badges are text, not colour only", () => {
    render(<AuthorsLibrary authors={[mk("ella-hughes", { name: "Ella Hughes", exclusive_sites: ["scoopella"] }), mk("ben-foster", { name: "Ben Foster", portrait: null })]} />);
    const ella = screen.getByRole("link", { name: /Ella Hughes/ });
    expect(ella.getAttribute("href")).toBe("/authors/ella-hughes");
    expect(within(ella).getByText("Exclusive")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: /Ben Foster/ })).getByText("Incomplete profile")).toBeTruthy();
  });

  it("filter chips and search are kept in the URL", async () => {
    render(<AuthorsLibrary authors={[mk("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: /Exclusive/ }));
    expect(replace).toHaveBeenLastCalledWith("/authors?filter=exclusive", { scroll: false });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search authors" }), "r");
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=r"), { scroll: false });
  });

  it("restores state from the URL and shows a no-results state with a way out", () => {
    search = "q=nobody";
    render(<AuthorsLibrary authors={[mk("a")]} />);
    expect(screen.getByText("No authors match “nobody”")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear search and filters" })).toBeTruthy();
  });

  it("empty library explains how to start", () => {
    render(<AuthorsLibrary authors={[]} />);
    expect(screen.getByText("No authors yet")).toBeTruthy();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/library.test.ts src/components/authors` → Expected: FAIL (modules missing).

- [ ] **Step 2: `library.ts`**

```ts
// services/dashboard/src/lib/authors/library.ts
import { isIncomplete } from "./record";
import type { AuthorListItem } from "./types";

export type LibraryFilter = "all" | "exclusive" | "unassigned" | "incomplete";
export type LibrarySort = "updated" | "name" | "sites";

const matches: Record<LibraryFilter, (a: AuthorListItem) => boolean> = {
  all: () => true,
  exclusive: (a) => a.exclusive_sites.length > 0,
  unassigned: (a) => a.sites.length === 0,
  incomplete: (a) => isIncomplete(a),
};

export function filterAuthors(items: AuthorListItem[], q: string, filter: LibraryFilter, sort: LibrarySort): AuthorListItem[] {
  const needle = q.trim().toLowerCase();
  const hit = (a: AuthorListItem): boolean =>
    !needle || [a.name, a.tagline, ...a.beats, ...a.sites.map((s) => s.site)].some((t) => t.toLowerCase().includes(needle));
  const out = items.filter((a) => matches[filter](a) && hit(a));
  const byName = (a: AuthorListItem, b: AuthorListItem): number => a.name.localeCompare(b.name);
  return out.sort(
    sort === "name" ? byName
      : sort === "sites" ? (a, b) => b.sites.length - a.sites.length || byName(a, b)
        : (a, b) => b.updated_at.localeCompare(a.updated_at) || byName(a, b),
  );
}

export function filterCounts(items: AuthorListItem[]): Record<LibraryFilter, number> {
  return {
    all: items.length,
    exclusive: items.filter(matches.exclusive).length,
    unassigned: items.filter(matches.unassigned).length,
    incomplete: items.filter(matches.incomplete).length,
  };
}
```

- [ ] **Step 3: Components and page**

```tsx
// services/dashboard/src/components/authors/AuthorAvatar.tsx
import type { AuthorPortrait } from "@/lib/authors/types";

const SIZES = { sm: "w-10 h-10 text-sm", md: "w-14 h-14 text-base", lg: "w-40 h-40 text-4xl" } as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function portraitSrc(path: string): string {
  return `/api/authors/portrait?path=${encodeURIComponent(path)}`;
}

/** Portrait (rounded-2xl) or initials on the accent tint. Decorative — the name is always shown beside it. */
export function AuthorAvatar({ name, portrait, size = "md" }: { name: string; portrait: AuthorPortrait | null; size?: keyof typeof SIZES }): React.ReactElement {
  return portrait ? (
    <img src={portraitSrc(portrait.path)} alt="" className={`${SIZES[size]} rounded-2xl object-cover bg-[var(--bg-elevated)] shrink-0`} />
  ) : (
    <span aria-hidden="true" className={`${SIZES[size]} rounded-2xl bg-cyan/10 text-cyan font-semibold flex items-center justify-center shrink-0`}>
      {initialsOf(name)}
    </span>
  );
}
```

```tsx
// services/dashboard/src/components/authors/AuthorCard.tsx
import Link from "next/link";
import { isIncomplete } from "@/lib/authors/record";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorAvatar } from "./AuthorAvatar";

const LockIcon = (): React.ReactElement => (
  <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

/** One library card — the whole card is a single link to the profile. */
export function AuthorCard({ author }: { author: AuthorListItem }): React.ReactElement {
  const shownBeats = author.beats.slice(0, 2);
  const extra = author.beats.length - shownBeats.length;
  return (
    <Link
      href={`/authors/${author.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 transition-[transform,box-shadow] duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px hover:shadow-[0_6px_20px_-12px_rgb(6_182_212/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
    >
      <div className="flex items-start gap-3">
        <AuthorAvatar name={author.name} portrait={author.portrait} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{author.name}</h3>
            {author.exclusive_sites.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <LockIcon />Exclusive
              </span>
            )}
          </div>
          <p className="truncate text-xs text-[var(--text-secondary)]">{author.tagline || "No tagline yet"}</p>
        </div>
      </div>
      {shownBeats.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Beats">
          {shownBeats.map((b) => <li key={b} className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{b}</li>)}
          {extra > 0 && <li className="rounded-full px-1 py-0.5 text-[11px] text-[var(--text-muted)]">+{extra}</li>}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-secondary)] pt-3 text-xs text-[var(--text-muted)]">
        <span className="truncate">
          {author.sites.length === 0 ? "Not on any site" : `${author.sites.length} site${author.sites.length === 1 ? "" : "s"} · ${author.sites.map((s) => s.site).join(", ")}`}
        </span>
        {isIncomplete(author) && (
          <span className="inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />Incomplete profile
          </span>
        )}
      </div>
    </Link>
  );
}
```

```tsx
// services/dashboard/src/components/authors/AuthorsLibrary.tsx
"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { filterAuthors, filterCounts, type LibraryFilter, type LibrarySort } from "@/lib/authors/library";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorCard } from "./AuthorCard";

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "exclusive", label: "Exclusive" },
  { id: "unassigned", label: "Not on any site" },
  { id: "incomplete", label: "Incomplete profile" },
];
const SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: "updated", label: "Recently updated" },
  { id: "name", label: "Name" },
  { id: "sites", label: "Most sites" },
];

interface AuthorsLibraryProps {
  authors: AuthorListItem[];
  /** Header actions (New author, Generate missing profiles) are rendered by the page via this slot. */
  actions?: React.ReactNode;
}

export function AuthorsLibrary({ authors, actions }: AuthorsLibraryProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = (FILTERS.some((f) => f.id === params.get("filter")) ? params.get("filter") : "all") as LibraryFilter;
  const sort = (SORTS.some((s) => s.id === params.get("sort")) ? params.get("sort") : "updated") as LibrarySort;
  const [q, setQ] = useState(params.get("q") ?? "");

  function setParam(key: string, value: string, fallback: string): void {
    const next = new URLSearchParams(params.toString());
    if (!value || value === fallback) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const counts = useMemo(() => filterCounts(authors), [authors]);
  const shown = useMemo(() => filterAuthors(authors, q, filter, sort), [authors, q, filter, sort]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Authors</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Authors <span className="text-[var(--text-muted)] font-normal tabular-nums">· {authors.length}</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search authors"
          placeholder="Search authors…"
          value={q}
          onChange={(e): void => { setQ(e.target.value); setParam("q", e.target.value.trim(), ""); }}
          className="w-full sm:w-72 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <div role="group" aria-label="Filter authors" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={(): void => setParam("filter", f.id, "all")}
              className={`min-h-9 rounded-full border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${filter === f.id ? "border-cyan bg-cyan/10 text-cyan" : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-primary)]"}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
          Sort
          <select
            value={sort}
            onChange={(e): void => setParam("sort", e.target.value, "updated")}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {authors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
          <p className="text-sm font-semibold text-[var(--text-primary)]">No authors yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Create one with <strong>New author</strong> — AI can write the whole profile for you.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{q.trim() ? `No authors match “${q.trim()}”` : "No authors in this filter"}</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={(): void => { setQ(""); router.replace(pathname, { scroll: false }); }}>
            Clear search and filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((a) => <AuthorCard key={a.id} author={a} />)}
        </div>
      )}
    </div>
  );
}
```

```tsx
// services/dashboard/src/app/authors/page.tsx
import { listAuthors } from "@/lib/authors/store";
import { withSites } from "@/app/api/authors/route";
import { AuthorsPageClient } from "@/components/authors/AuthorsPageClient";

export const dynamic = "force-dynamic";

export default async function AuthorsPage(): Promise<React.ReactElement> {
  const authors = await withSites(await listAuthors());
  return <AuthorsPageClient authors={authors} />;
}
```

`AuthorsPageClient` is created in Task 6 (it adds the header actions); for this task create it minimally:

```tsx
// services/dashboard/src/components/authors/AuthorsPageClient.tsx
"use client";

import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorsLibrary } from "./AuthorsLibrary";

export function AuthorsPageClient({ authors }: { authors: AuthorListItem[] }): React.ReactElement {
  return <AuthorsLibrary authors={authors} />;
}
```

```tsx
// services/dashboard/src/app/authors/loading.tsx
/** Skeleton cards while the library loads (> 300 ms). */
export default function Loading(): React.ReactElement {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading authors">
      <div className="h-10 w-48 rounded-lg bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-40 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4">
            <div className="flex gap-3"><div className="h-14 w-14 rounded-2xl bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /><div className="h-3 w-1/2 rounded bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Sidebar: after the Groups item in `NAV_ITEMS`, add:

```tsx
  {
    label: "Authors",
    href: "/authors",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
  },
```

Run: `cd services/dashboard && npx vitest run src/lib/authors src/components/authors && pnpm typecheck` → Expected: PASS; exit 0.

- [ ] **Step 4: Commit (after approval)** — `git commit -m "feat(dashboard): Authors library screen"`

---

### Task 6: Dashboard — generation flow, New author, Generate missing profiles

**Before writing UI:** invoke the three design skills (as Task 5).

**Files:**
- Create: `services/dashboard/src/lib/authors/generate-flow.ts`, `src/components/authors/NewAuthorModal.tsx`, `src/components/authors/GenerateMissingModal.tsx`
- Modify: `src/components/authors/AuthorsPageClient.tsx` (header actions)
- Test: `src/lib/authors/__tests__/generate-flow.test.ts`, `src/components/authors/__tests__/NewAuthorModal.test.tsx`

**Interfaces:**
- Consumes: `POST /api/authors/generate` (Task 4), `PUT /api/authors/[id]` (Task 4), `authorIdFromName` (Task 3).
- Produces:
  - `interface GenerateContext { site?: string; siteName?: string; category?: string; topics?: string[]; tone?: string; beatHint?: string }`
  - `type PartStatus = "pending" | "running" | "done" | "error"`
  - `generatePart(part: AuthorPart, draft: Partial<AuthorInput>, opts: { authorId?: string; context?: GenerateContext; takenNames: string[] }, fetchFn?: typeof fetch): Promise<Partial<AuthorInput>>` (throws `Error(message)` on failure)
  - `runParts(parts: AuthorPart[], draft: Partial<AuthorInput>, opts: { authorIdFor(draft: Partial<AuthorInput>): string; context?: GenerateContext; takenNames: string[] }, onStatus: (part: AuthorPart, status: PartStatus, error?: string) => void, fetchFn?: typeof fetch): Promise<Partial<AuthorInput>>` — runs in order, continues past a failed part, returns the merged draft
  - `missingParts(a: AuthorRecord): AuthorPart[]`
  - `ALL_PARTS: AuthorPart[] = ["name", "tagline", "bio", "beats", "portrait"]`

- [ ] **Step 1: Failing tests**

```ts
// services/dashboard/src/lib/authors/__tests__/generate-flow.test.ts
import { describe, expect, it, vi } from "vitest";
import { ALL_PARTS, missingParts, runParts } from "../generate-flow";
import type { AuthorRecord } from "../types";

const ok = (value: unknown): Response => new Response(JSON.stringify({ status: "ok", value }), { status: 200 });

describe("runParts", () => {
  it("runs parts in order, feeding each result into the next request", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as Record<string, unknown>;
      bodies.push(b);
      return ok({ name: "Maya Ortiz", tagline: "Coffee writer", bio: "Bio.", beats: ["Coffee", "Brewing"], portrait: { kind: "generated", path: "/authors/assets/maya-ortiz-a.webp" } }[b.part as string]);
    });
    const statuses: string[] = [];
    const out = await runParts(ALL_PARTS, {}, { authorIdFor: () => "maya-ortiz", takenNames: ["Ella Hughes"] }, (p, s) => statuses.push(`${p}:${s}`), fetchFn as unknown as typeof fetch);
    expect(out).toMatchObject({ name: "Maya Ortiz", tagline: "Coffee writer", beats: ["Coffee", "Brewing"], portrait: { kind: "generated" } });
    expect((bodies[1]!.draft as { name?: string }).name).toBe("Maya Ortiz");
    expect(bodies[4]).toMatchObject({ part: "portrait", authorId: "maya-ortiz" });
    expect(bodies[0]!.takenNames).toEqual(["Ella Hughes"]);
    expect(statuses.filter((s) => s.endsWith(":done"))).toHaveLength(5);
  });

  it("a failed part reports its error and the rest still run", async () => {
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      return part === "portrait"
        ? new Response(JSON.stringify({ status: "error", message: "Portrait failed: OpenAI 500" }), { status: 502 })
        : ok(part === "beats" ? ["A", "B"] : "x");
    });
    const errors: string[] = [];
    await runParts(["tagline", "portrait", "beats"], { name: "Maya Ortiz" }, { authorIdFor: () => "maya-ortiz", takenNames: [] }, (p, s, e) => { if (s === "error") errors.push(`${p}: ${e}`); }, fetchFn as unknown as typeof fetch);
    expect(errors).toEqual(["portrait: Portrait failed: OpenAI 500"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("missingParts", () => {
  it("bio-less authors get tagline/bio/beats as needed; portrait-less get a portrait", () => {
    const a = { name: "A B", tagline: "", bio: "", beats: ["X", "Y"], portrait: null } as unknown as AuthorRecord;
    expect(missingParts(a)).toEqual(["tagline", "bio", "portrait"]);
  });
});
```

```tsx
// services/dashboard/src/components/authors/__tests__/NewAuthorModal.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewAuthorModal } from "../NewAuthorModal";

afterEach(() => { cleanup(); push.mockClear(); });

describe("NewAuthorModal", () => {
  it("Generate with AI carries the chosen site and beat to the new profile", async () => {
    render(<NewAuthorModal open onClose={vi.fn()} sites={[{ domain: "scoopella" }, { domain: "popstorylab" }]} />);
    await userEvent.selectOptions(screen.getByLabelText("For site (optional)"), "scoopella");
    await userEvent.type(screen.getByLabelText("Beat (optional)"), "Royals");
    await userEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(push).toHaveBeenCalledWith("/authors/new?generate=1&site=scoopella&beat=Royals");
  });
  it("Start blank opens an empty profile", async () => {
    render(<NewAuthorModal open onClose={vi.fn()} sites={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Start blank" }));
    expect(push).toHaveBeenCalledWith("/authors/new");
  });
});
```

Run: `cd services/dashboard && npx vitest run src/lib/authors/__tests__/generate-flow.test.ts src/components/authors/__tests__/NewAuthorModal.test.tsx` → Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

```ts
// services/dashboard/src/lib/authors/generate-flow.ts
import type { AuthorInput, AuthorPart, AuthorRecord } from "./types";

/**
 * Browser-side order of profile generation. Each part is its own request (CloudGrid cuts requests at ~60 s), and
 * every result feeds the next part (a bio is written for the generated name and beats). Nothing is saved here.
 */
export const ALL_PARTS: AuthorPart[] = ["name", "tagline", "bio", "beats", "portrait"];

export interface GenerateContext {
  site?: string;
  siteName?: string;
  category?: string;
  topics?: string[];
  tone?: string;
  beatHint?: string;
}

export type PartStatus = "pending" | "running" | "done" | "error";

export async function generatePart(
  part: AuthorPart,
  draft: Partial<AuthorInput>,
  opts: { authorId?: string; context?: GenerateContext; takenNames: string[] },
  fetchFn: typeof fetch = fetch,
): Promise<Partial<AuthorInput>> {
  const res = await fetchFn("/api/authors/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      part,
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
      draft: { name: draft.name, tagline: draft.tagline, bio: draft.bio, beats: draft.beats },
      siteContext: opts.context ?? {},
      takenNames: opts.takenNames,
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { status?: string; value?: unknown; message?: string };
  if (!res.ok || out.status !== "ok") throw new Error(out.message ?? `Generation failed (${res.status})`);
  return { [part]: out.value } as Partial<AuthorInput>;
}

export async function runParts(
  parts: AuthorPart[],
  draft: Partial<AuthorInput>,
  opts: { authorIdFor(draft: Partial<AuthorInput>): string; context?: GenerateContext; takenNames: string[] },
  onStatus: (part: AuthorPart, status: PartStatus, error?: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<Partial<AuthorInput>> {
  let current = { ...draft };
  parts.forEach((p) => onStatus(p, "pending"));
  for (const part of parts) {
    onStatus(part, "running");
    try {
      current = { ...current, ...(await generatePart(part, current, { authorId: part === "portrait" ? opts.authorIdFor(current) : undefined, context: opts.context, takenNames: opts.takenNames }, fetchFn)) };
      onStatus(part, "done");
    } catch (err) {
      onStatus(part, "error", err instanceof Error ? err.message : String(err));
    }
  }
  return current;
}

export function missingParts(a: Pick<AuthorRecord, "tagline" | "bio" | "beats" | "portrait">): AuthorPart[] {
  const parts: AuthorPart[] = [];
  if (!a.bio.trim()) {
    if (!a.tagline.trim()) parts.push("tagline");
    parts.push("bio");
    if (a.beats.length === 0) parts.push("beats");
  }
  if (!a.portrait) parts.push("portrait");
  return parts;
}
```

```tsx
// services/dashboard/src/components/authors/NewAuthorModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface NewAuthorModalProps {
  open: boolean;
  onClose: () => void;
  sites: Array<{ domain: string }>;
}

/** New author: generate a full profile (optionally for a site or a beat) or start blank. Lands on the profile unsaved. */
export function NewAuthorModal({ open, onClose, sites }: NewAuthorModalProps): React.ReactElement {
  const router = useRouter();
  const [site, setSite] = useState("");
  const [beat, setBeat] = useState("");

  function generate(): void {
    const qs = new URLSearchParams({ generate: "1" });
    if (site) qs.set("site", site);
    if (beat.trim()) qs.set("beat", beat.trim());
    router.push(`/authors/new?${qs.toString()}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="New author" size="md">
      <div className="space-y-5">
        <div className="space-y-3 rounded-xl border border-cyan/30 bg-cyan/5 p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Generate with AI</p>
          <p className="text-xs text-[var(--text-secondary)]">Name, tagline, bio, beats and an illustrated portrait — review before saving.</p>
          <label className="block text-xs text-[var(--text-secondary)]">
            For site (optional)
            <select value={site} onChange={(e): void => setSite(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50">
              <option value="">Any site</option>
              {sites.map((s) => <option key={s.domain} value={s.domain}>{s.domain}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[var(--text-secondary)]">
            Beat (optional)
            <input value={beat} onChange={(e): void => setBeat(e.target.value)} placeholder="e.g. Royals, home espresso" className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50" />
          </label>
          <Button variant="primary" size="md" className="w-full min-h-11" onClick={generate}>Generate with AI</Button>
        </div>
        <Button variant="ghost" size="md" className="w-full" onClick={(): void => router.push("/authors/new")}>Start blank</Button>
      </div>
    </Modal>
  );
}
```

```tsx
// services/dashboard/src/components/authors/GenerateMissingModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { missingParts, runParts } from "@/lib/authors/generate-flow";
import type { AuthorListItem } from "@/lib/authors/types";

interface GenerateMissingModalProps {
  open: boolean;
  onClose: () => void;
  authors: AuthorListItem[];
}

/**
 * "Generate missing profiles (N)": fills the missing parts of each incomplete author in turn and saves each one.
 * Progress stays visible in a status line (the run continues if the modal is closed).
 */
export function GenerateMissingModal({ open, onClose, authors }: GenerateMissingModalProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [progress, setProgress] = useState<{ done: number; failed: number; current: string } | null>(null);
  const taken = authors.map((a) => a.name);

  async function run(): Promise<void> {
    let done = 0;
    let failed = 0;
    for (const a of authors) {
      setProgress({ done, failed, current: a.name });
      let partFailed = false;
      const patch = await runParts(missingParts(a), a, { authorIdFor: () => a.id, takenNames: taken }, (_p, s) => { if (s === "error") partFailed = true; });
      const { id: _id, created_at: _c, updated_at: _u, sites: _s, ...input } = { ...a, ...patch };
      const res = await fetch(`/api/authors/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: input }) });
      if (!res.ok || partFailed) failed++; else done++;
    }
    setProgress(null);
    toast(failed ? `Profiles generated for ${done} authors · ${failed} need another try` : `Profiles generated for ${done} authors`, failed ? "info" : "success");
    router.refresh();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Generate missing profiles (${authors.length})`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">AI fills in the missing bio, tagline, beats or portrait for these authors and saves each one. It takes about 30–60 seconds per author.</p>
        <ul className="max-h-48 overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
          {authors.map((a) => <li key={a.id} className="px-3 py-2 text-[var(--text-primary)]">{a.name} <span className="text-xs text-[var(--text-muted)]">· {missingParts(a).join(", ")}</span></li>)}
        </ul>
        {progress ? (
          <p role="status" aria-live="polite" className="text-sm text-[var(--text-primary)]">
            Generating {progress.current}… <span className="tabular-nums text-[var(--text-muted)]">{progress.done + progress.failed} / {authors.length}</span>
          </p>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={(): void => { void run(); }}>Generate {authors.length} profiles</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

```tsx
// services/dashboard/src/components/authors/AuthorsPageClient.tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isIncomplete } from "@/lib/authors/record";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorsLibrary } from "./AuthorsLibrary";
import { NewAuthorModal } from "./NewAuthorModal";
import { GenerateMissingModal } from "./GenerateMissingModal";

export function AuthorsPageClient({ authors, sites }: { authors: AuthorListItem[]; sites: Array<{ domain: string }> }): React.ReactElement {
  const [newOpen, setNewOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const incomplete = useMemo(() => authors.filter(isIncomplete), [authors]);
  return (
    <>
      <AuthorsLibrary
        authors={authors}
        actions={
          <>
            {incomplete.length > 0 && (
              <Button variant="secondary" onClick={(): void => setMissingOpen(true)}>Generate missing profiles ({incomplete.length})</Button>
            )}
            <Button variant="primary" className="min-h-11" onClick={(): void => setNewOpen(true)}>+ New author</Button>
          </>
        }
      />
      {newOpen && <NewAuthorModal open={newOpen} onClose={(): void => setNewOpen(false)} sites={sites} />}
      {missingOpen && <GenerateMissingModal open={missingOpen} onClose={(): void => setMissingOpen(false)} authors={incomplete} />}
    </>
  );
}
```

Update `src/app/authors/page.tsx` to pass the site list:

```tsx
import { getDashboardIndex } from "@/lib/db/dashboard-index";
// …
  const [authors, index] = await Promise.all([listAuthors().then(withSites), getDashboardIndex()]);
  return <AuthorsPageClient authors={authors} sites={index.sites.map((s) => ({ domain: s.domain }))} />;
```

Run: `cd services/dashboard && npx vitest run src/lib/authors src/components/authors && pnpm typecheck` → Expected: PASS; exit 0.

- [ ] **Step 3: Commit (after approval)** — `git commit -m "feat(dashboard): New author and Generate missing profiles"`

---

### Task 7: Dashboard — author profile editor

**Before writing UI:** invoke the three design skills (as Task 5).

**Files:**
- Create: `services/dashboard/src/components/authors/AuthorProfileEditor.tsx`, `src/components/authors/UnsavedChangesGuard.tsx`, `src/app/authors/[id]/page.tsx`, `src/app/authors/new/page.tsx`
- Test: `src/components/authors/__tests__/AuthorProfileEditor.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–6 (`AuthorRecord`, `AuthorInput`, `generatePart`, `runParts`, `ALL_PARTS`, `authorIdFromName`, `AuthorAvatar`, `portraitSrc`), `ChipMultiSelect` (`@/components/config/grid/ChipMultiSelect`), `Modal`, `Button`, `Input`, `Textarea`, `useToast`.
- Produces: `AuthorProfileEditor({ author, mode, sites, takenNames, autoGenerate?, context? })` where `mode: "create" | "edit"`, `author: AuthorListItem | null`; `UnsavedChangesGuard({ when, onConfirmLeave? })`.

- [ ] **Step 1: Failing test**

```tsx
// services/dashboard/src/components/authors/__tests__/AuthorProfileEditor.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));

import { AuthorProfileEditor } from "../AuthorProfileEditor";
import type { AuthorListItem } from "@/lib/authors/types";

const ELLA: AuthorListItem = {
  id: "ella-hughes", name: "Ella Hughes", tagline: "Royals writer", bio: "Old bio.", beats: ["Royals"],
  portrait: null, links: {}, exclusive_sites: [], created_at: "t", updated_at: "t", sites: [],
};

function respond(map: Record<string, unknown>): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/authors/generate")) {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      const v = map[part];
      return v instanceof Error
        ? new Response(JSON.stringify({ status: "error", message: v.message }), { status: 502 })
        : new Response(JSON.stringify({ status: "ok", value: v }), { status: 200 });
    }
    if (init?.method === "PUT") return new Response(JSON.stringify({ author: { ...ELLA, ...JSON.parse(String(init.body)).author } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => { push.mockClear(); toast.mockClear(); });
afterEach(cleanup);

describe("AuthorProfileEditor", () => {
  it("regenerating the bio shows it as an unsaved change; Save sends it; Discard restores", async () => {
    respond({ bio: "A brand new bio." });
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate bio" }));
    expect(await screen.findByDisplayValue("A brand new bio.")).toBeTruthy();
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(bar).getByText(/bio/)).toBeTruthy();
    await userEvent.click(within(bar).getByRole("button", { name: "Discard" }));
    expect(screen.getByDisplayValue("Old bio.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Regenerate bio" }));
    await screen.findByDisplayValue("A brand new bio.");
    await userEvent.click(within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", { name: "Save author" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Author saved", "success"));
    const put = vi.mocked(global.fetch).mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body)).author.bio).toBe("A brand new bio.");
  });

  it("a failed portrait shows its error with Retry; other sections are unaffected", async () => {
    respond({ portrait: new Error("Portrait failed: OpenAI 500") });
    render(<AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate portrait" }));
    expect(await screen.findByText("Portrait failed: OpenAI 500")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry portrait" })).toBeTruthy();
    expect(screen.getByDisplayValue("Old bio.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("asks before leaving through a link with unsaved changes", async () => {
    respond({ tagline: "Palace watcher" });
    render(<><a href="/sites">Sites</a><AuthorProfileEditor author={ELLA} mode="edit" sites={[]} takenNames={[]} /></>);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate tagline" }));
    await screen.findByDisplayValue("Palace watcher");
    await userEvent.click(screen.getByRole("link", { name: "Sites" }));
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(push).toHaveBeenCalledWith("/sites");
  });

  it("Generate everything shows a checklist of parts", async () => {
    respond({ name: "Maya Ortiz", tagline: "Coffee writer", bio: "Bio text.", beats: ["Coffee", "Brewing"], portrait: { kind: "generated", path: "/authors/assets/maya-ortiz-a.webp" } });
    render(<AuthorProfileEditor author={null} mode="create" sites={[]} takenNames={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate everything" }));
    const list = await screen.findByRole("list", { name: "Generation progress" });
    await waitFor(() => expect(within(list).getAllByText("Done")).toHaveLength(5));
    expect(screen.getByDisplayValue("Maya Ortiz")).toBeTruthy();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/components/authors/__tests__/AuthorProfileEditor.test.tsx` → Expected: FAIL (module missing).

- [ ] **Step 2: `UnsavedChangesGuard`**

```tsx
// services/dashboard/src/components/authors/UnsavedChangesGuard.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/** While `when` is true: closing the tab asks (beforeunload) and in-app link clicks open a confirm first. */
export function UnsavedChangesGuard({ when }: { when: boolean }): React.ReactElement | null {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => { e.preventDefault(); };
    const onClick = (e: MouseEvent): void => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [when]);

  if (!pendingHref) return null;
  return (
    <Modal open onClose={(): void => setPendingHref(null)} title="Leave without saving?" size="sm">
      {/* Modal has no dialog role/label of its own — this keeps the confirm announced and testable. */}
      <div role="dialog" aria-modal="true" aria-label="Leave without saving?">
        <p className="text-sm text-[var(--text-secondary)]">Your changes to this author haven&apos;t been saved.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={(): void => setPendingHref(null)}>Stay</Button>
          <Button variant="danger" onClick={(): void => { const href = pendingHref; setPendingHref(null); router.push(href); }}>Leave</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: `AuthorProfileEditor`** (sections: identity column [sticky on desktop] with portrait + actions + name + id + exclusive line + Generate everything; right column cards About [bio + tagline], Beats, Links, Sites [connected + exclusive editor], Danger zone; sticky save bar when dirty)

```tsx
// services/dashboard/src/components/authors/AuthorProfileEditor.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ChipMultiSelect } from "@/components/config/grid/ChipMultiSelect";
import { authorIdFromName } from "@/lib/authors/record";
import { ALL_PARTS, generatePart, runParts, type GenerateContext, type PartStatus } from "@/lib/authors/generate-flow";
import type { AuthorInput, AuthorListItem, AuthorPart } from "@/lib/authors/types";
import { AuthorAvatar } from "./AuthorAvatar";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";

interface AuthorProfileEditorProps {
  author: AuthorListItem | null;
  mode: "create" | "edit";
  sites: Array<{ domain: string }>;
  takenNames: string[];
  autoGenerate?: boolean;
  context?: GenerateContext;
}

const EMPTY: AuthorInput = { name: "", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };
const PART_LABEL: Record<AuthorPart, string> = { name: "Name", tagline: "Tagline", bio: "Bio", beats: "Beats", portrait: "Portrait" };
const FIELD_PART: Record<string, string> = { name: "name", tagline: "tagline", bio: "bio", beats: "beats", portrait: "portrait", links: "links", exclusive_sites: "exclusive sites" };

const toInput = (a: AuthorListItem | null): AuthorInput =>
  a ? { name: a.name, tagline: a.tagline, bio: a.bio, beats: a.beats, portrait: a.portrait, links: a.links, exclusive_sites: a.exclusive_sites } : EMPTY;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

function SectionCard({ eyebrow, action, children }: { eyebrow: string; action?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{eyebrow}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Free-text chips (ChipMultiSelect only picks from fixed options). */
function BeatsEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }): React.ReactElement {
  const [text, setText] = useState("");
  function add(): void {
    const b = text.trim();
    if (b && !value.some((v) => v.toLowerCase() === b.toLowerCase())) onChange([...value, b]);
    setText("");
  }
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Beats">
        {value.map((b) => (
          <li key={b} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--text-primary)]">
            {b}
            <button type="button" aria-label={`Remove ${b}`} className="rounded-full px-1 text-[var(--text-muted)] hover:text-red-400" onClick={(): void => onChange(value.filter((v) => v !== b))}>×</button>
          </li>
        ))}
        {value.length === 0 && <li className="text-xs text-[var(--text-muted)]">No beats yet</li>}
      </ul>
      <div className="flex gap-2">
        <input aria-label="New beat" value={text} onChange={(e): void => setText(e.target.value)} onKeyDown={(e): void => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add a beat" className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50" />
        <Button variant="secondary" size="sm" onClick={add} disabled={!text.trim()}>+ Add</Button>
      </div>
    </div>
  );
}

function RegenerateButton({ part, busy, onClick }: { part: AuthorPart; busy: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={busy} aria-label={`Regenerate ${part}`} loading={busy}>
      ✦ Regenerate
    </Button>
  );
}

export function AuthorProfileEditor({ author, mode, sites, takenNames, autoGenerate, context }: AuthorProfileEditorProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const saved = useMemo(() => toInput(author), [author]);
  const [draft, setDraft] = useState<AuthorInput>(saved);
  const [busy, setBusy] = useState<Partial<Record<AuthorPart, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AuthorPart, string>>>({});
  const [checklist, setChecklist] = useState<Partial<Record<AuthorPart, PartStatus>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const generatedOnce = useRef(false);

  const changed = (Object.keys(FIELD_PART) as Array<keyof AuthorInput>).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
  const dirty = changed.length > 0;
  const idFor = (d: Partial<AuthorInput>): string => author?.id ?? authorIdFromName(d.name || "author", []);
  const others = takenNames.filter((n) => n.toLowerCase() !== (author?.name ?? "").toLowerCase());

  async function regenerate(part: AuthorPart): Promise<void> {
    setBusy((b) => ({ ...b, [part]: true }));
    setErrors((e) => ({ ...e, [part]: undefined }));
    try {
      const patch = await generatePart(part, draft, { authorId: part === "portrait" ? idFor(draft) : undefined, context, takenNames: others });
      setDraft((d) => ({ ...d, ...patch }));
    } catch (err) {
      setErrors((e) => ({ ...e, [part]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy((b) => ({ ...b, [part]: false }));
    }
  }

  async function generateEverything(): Promise<void> {
    setChecklist({});
    const result = await runParts(ALL_PARTS, draft, { authorIdFor: idFor, context, takenNames: others }, (part, status, error) => {
      setChecklist((c) => ({ ...c, [part]: status }));
      if (status === "error") setErrors((e) => ({ ...e, [part]: error }));
    });
    setDraft((d) => ({ ...d, ...result }));
  }

  useEffect(() => {
    if (autoGenerate && !generatedOnce.current) { generatedOnce.current = true; void generateEverything(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(mode === "create" ? "/api/authors" : `/api/authors/${author!.id}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: draft }),
      });
      const out = (await res.json()) as { author?: { id: string }; error?: string };
      if (!res.ok || !out.author) throw new Error(out.error ?? `Save failed (${res.status})`);
      toast("Author saved", "success");
      if (mode === "create") router.push(`/authors/${out.author.id}`); else router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File): Promise<void> {
    setBusy((b) => ({ ...b, portrait: true }));
    setErrors((e) => ({ ...e, portrait: undefined }));
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("authorId", idFor(draft));
      const res = await fetch("/api/authors/portrait", { method: "POST", body: form });
      const out = (await res.json()) as { portrait?: AuthorInput["portrait"]; error?: string };
      if (!res.ok || !out.portrait) throw new Error(out.error ?? "Upload failed");
      setDraft((d) => ({ ...d, portrait: out.portrait! }));
    } catch (err) {
      setErrors((e) => ({ ...e, portrait: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy((b) => ({ ...b, portrait: false }));
    }
  }

  async function remove(): Promise<void> {
    const res = await fetch(`/api/authors/${author!.id}`, { method: "DELETE" });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { toast(out.error ?? "Delete failed", "error"); return; }
    toast(`${author!.name} deleted`, "success");
    router.push("/authors");
  }

  const exclusiveOptions = sites.map((s) => ({ value: s.domain, label: s.domain }));
  const bioWords = wordCount(draft.bio);

  return (
    <div className="space-y-6 pb-24">
      <UnsavedChangesGuard when={dirty} />
      <a href="/authors" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Authors</a>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Identity column */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5">
          <div className="flex justify-center">
            {busy.portrait
              ? <div aria-label="Generating portrait" className="h-40 w-40 rounded-2xl bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" />
              : <AuthorAvatar name={draft.name || "New author"} portrait={draft.portrait} size="lg" />}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={(): void => { void regenerate("portrait"); }} disabled={busy.portrait} aria-label="Regenerate portrait">✦ Regenerate</Button>
            <Button variant="secondary" size="sm" onClick={(): void => fileRef.current?.click()} disabled={busy.portrait}>Upload</Button>
            {draft.portrait && <Button variant="ghost" size="sm" onClick={(): void => setDraft((d) => ({ ...d, portrait: null }))}>Remove</Button>}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e): void => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
          {errors.portrait && (
            <p role="alert" className="text-center text-xs text-red-400">
              {errors.portrait}{" "}
              <button type="button" className="underline" onClick={(): void => { void regenerate("portrait"); }}>Retry portrait</button>
            </p>
          )}
          <div className="space-y-1">
            <Input label="Name" value={draft.name} onChange={(e): void => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="font-mono">{author?.id ?? (draft.name ? authorIdFromName(draft.name, []) : "id from name")}</span>
              <button type="button" className="underline disabled:opacity-50" disabled={busy.name} aria-label="Regenerate name" onClick={(): void => { void regenerate("name"); }}>✦ New name</button>
            </div>
            {errors.name && <p role="alert" className="text-xs text-red-400">{errors.name}</p>}
          </div>
          {draft.exclusive_sites.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">🔒 Exclusive · {draft.exclusive_sites.join(", ")}</p>
          )}
          <Button variant="secondary" className="w-full min-h-11" onClick={(): void => { void generateEverything(); }} disabled={Object.values(busy).some(Boolean)}>
            ✦ Generate everything
          </Button>
          {checklist && (
            <ul aria-label="Generation progress" className="space-y-1 text-xs">
              {ALL_PARTS.map((p) => (
                <li key={p} className="flex justify-between text-[var(--text-secondary)]">
                  <span>{PART_LABEL[p]}</span>
                  <span className={checklist[p] === "error" ? "text-red-400" : checklist[p] === "done" ? "text-emerald-500" : "text-[var(--text-muted)]"}>
                    {checklist[p] === "done" ? "Done" : checklist[p] === "running" ? "Working…" : checklist[p] === "error" ? "Failed" : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Sections */}
        <div className="space-y-4">
          <SectionCard eyebrow="About" action={<RegenerateButton part="bio" busy={!!busy.bio} onClick={(): void => { void regenerate("bio"); }} />}>
            <Textarea label="Bio" rows={6} value={draft.bio} onChange={(e): void => setDraft((d) => ({ ...d, bio: e.target.value }))} />
            <p className={`text-xs tabular-nums ${bioWords && (bioWords < 60 || bioWords > 120) ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]"}`}>{bioWords} words · 60–120 recommended</p>
            {errors.bio && <p role="alert" className="text-xs text-red-400">{errors.bio}</p>}
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label="Tagline" value={draft.tagline} onChange={(e): void => setDraft((d) => ({ ...d, tagline: e.target.value }))} /></div>
              <RegenerateButton part="tagline" busy={!!busy.tagline} onClick={(): void => { void regenerate("tagline"); }} />
            </div>
            {errors.tagline && <p role="alert" className="text-xs text-red-400">{errors.tagline}</p>}
          </SectionCard>

          <SectionCard eyebrow="Beats" action={<RegenerateButton part="beats" busy={!!busy.beats} onClick={(): void => { void regenerate("beats"); }} />}>
            <BeatsEditor value={draft.beats} onChange={(next): void => setDraft((d) => ({ ...d, beats: next }))} />
            {errors.beats && <p role="alert" className="text-xs text-red-400">{errors.beats}</p>}
          </SectionCard>

          <SectionCard eyebrow="Links">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["website", "x", "instagram", "linkedin"] as const).map((k) => (
                <Input key={k} label={{ website: "Website", x: "X", instagram: "Instagram", linkedin: "LinkedIn" }[k]} placeholder="https://" value={draft.links[k] ?? ""} onChange={(e): void => setDraft((d) => ({ ...d, links: { ...d.links, [k]: e.target.value || undefined } }))} />
              ))}
            </div>
          </SectionCard>

          <SectionCard eyebrow="Sites">
            {author && author.sites.length > 0 ? (
              <ul className="divide-y divide-[var(--border-secondary)] text-sm">
                {author.sites.map((s) => (
                  <li key={s.site} className="flex items-center justify-between py-2">
                    <span className="text-[var(--text-primary)]">{s.site} <span className="text-xs text-[var(--text-muted)]">{s.topics.join(", ")}</span></span>
                    <a className="text-xs text-cyan underline" href={`/sites/${s.site}`}>Open site</a>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--text-muted)]">Not on any site yet.</p>}
            <ChipMultiSelect
              label="Exclusive to"
              addLabel="+ Add site"
              value={draft.exclusive_sites}
              options={exclusiveOptions}
              onChange={(next): void => setDraft((d) => ({ ...d, exclusive_sites: next }))}
              emptyText="Not exclusive — can be picked for any site"
            />
          </SectionCard>

          {mode === "edit" && (
            <section className="rounded-xl border border-red-500/30 p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-400">Danger zone</h2>
              <Button variant="danger" size="sm" className="mt-3" onClick={(): void => setConfirmDelete(true)}>Delete author</Button>
            </section>
          )}
        </div>
      </div>

      {dirty && (
        <div role="region" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-primary)] bg-[var(--bg-surface)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-surface)]/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-secondary)]">Unsaved changes · {changed.map((k) => FIELD_PART[k]).join(", ")}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={(): void => { setDraft(saved); setErrors({}); }}>Discard</Button>
              <Button variant="primary" className="min-h-11" loading={saving} onClick={(): void => { void save(); }} disabled={!draft.name.trim()}>Save author</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && author && (
        <Modal open onClose={(): void => setConfirmDelete(false)} title={`Delete ${author.name}?`} size="sm">
          {author.sites.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">{author.name} writes for {author.sites.map((s) => s.site).join(", ")}. Remove them from those sites first.</p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">The profile and its portrait are removed from the library. Articles keep the name as plain text.</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={(): void => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={author.sites.length > 0} onClick={(): void => { void remove(); }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pages**

```tsx
// services/dashboard/src/app/authors/[id]/page.tsx
import { notFound } from "next/navigation";
import { listAuthors, readAuthor } from "@/lib/authors/store";
import { withSites } from "@/app/api/authors/route";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { AuthorProfileEditor } from "@/components/authors/AuthorProfileEditor";

export const dynamic = "force-dynamic";

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  const author = await readAuthor(id);
  if (!author) notFound();
  const [[withConnected], all, index] = await Promise.all([withSites([author]), listAuthors(), getDashboardIndex()]);
  return <AuthorProfileEditor author={withConnected!} mode="edit" sites={index.sites.map((s) => ({ domain: s.domain }))} takenNames={all.map((a) => a.name)} />;
}
```

```tsx
// services/dashboard/src/app/authors/new/page.tsx
import { listAuthors } from "@/lib/authors/store";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { AuthorProfileEditor } from "@/components/authors/AuthorProfileEditor";
import type { GenerateContext } from "@/lib/authors/generate-flow";

export const dynamic = "force-dynamic";

export default async function NewAuthorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<React.ReactElement> {
  const sp = await searchParams;
  const [all, index] = await Promise.all([listAuthors(), getDashboardIndex()]);
  const context: GenerateContext = {};
  if (sp.beat) context.beatHint = sp.beat;
  const entry = sp.site ? index.sites.find((s) => s.domain === sp.site) : undefined;
  if (entry) {
    const cfg = await getSiteConfig(entry.domain, entry.staging_branch ?? undefined).catch(() => null);
    const brief = (cfg?.brief ?? {}) as Record<string, unknown>;
    Object.assign(context, {
      site: entry.domain,
      siteName: typeof cfg?.site_name === "string" ? cfg.site_name : entry.domain,
      category: entry.vertical ?? undefined,
      topics: Array.isArray(brief.topics) ? (brief.topics as unknown[]).filter((t): t is string => typeof t === "string") : undefined,
      tone: typeof brief.tone === "string" ? brief.tone : undefined,
    });
  }
  return (
    <AuthorProfileEditor
      author={null}
      mode="create"
      sites={index.sites.map((s) => ({ domain: s.domain }))}
      takenNames={all.map((a) => a.name)}
      autoGenerate={sp.generate === "1"}
      context={context}
    />
  );
}
```

Run: `cd services/dashboard && npx vitest run src/components/authors && pnpm typecheck && npx vitest run` → Expected: PASS; exit 0; full suite passes.

- [ ] **Step 5: Commit (after approval)** — `git commit -m "feat(dashboard): author profile editor with per-section AI regenerate"`

---

### Task 8: Guide page and local end-to-end check

**Files:**
- Create: `services/dashboard/public/guide/26-authors.md`, `docs/test-results/authors-stage3/README.md`
- Modify: `services/dashboard/src/app/guide/page.tsx` (`GUIDE_PAGES`: `{ slug: "26-authors", title: "Authors" }`)

- [ ] **Step 1: Guide page**

```md
# Authors

The **Authors** screen (sidebar, after Groups) is the network's author library. Each author has a name, tagline,
bio, beats (what they write about), an illustrated portrait and optional links. Profiles live in the network repo
(`authors/<id>.yaml`) and sync to the sites automatically.

## Library
- Search by name, tagline, beat or site. Filter: **Exclusive**, **Not on any site**, **Incomplete profile** (no bio or portrait).
- **+ New author** → *Generate with AI* (optionally for a site or a beat) or *Start blank*. Nothing is saved until you click **Save author**.
- **Generate missing profiles (N)** fills in every incomplete author and saves each one (about 30–60 seconds per author).

## Profile
- **✦ Regenerate** on any section writes a new version just for that part; it shows as an unsaved change you can Save or Discard.
- **✦ Generate everything** writes the whole profile in order and shows a checklist.
- Portraits are illustrated, never photographs of made-up people. **Upload** your own photo any time, or **Remove** to show initials.
- Bios describe the beat and voice — the AI never invents degrees, employers or awards.
- **Exclusive to**: an exclusive author is never picked automatically for other sites.
- An author still used by sites can't be deleted.
```

- [ ] **Step 2: Local end-to-end (grid dev, real pipeline + OpenAI; writes to the real network repo)** — record each result in `docs/test-results/authors-stage3/README.md`:
1. Sidebar → Authors: empty state.
2. + New author → Generate with AI for coffeeactually → checklist reaches 5× Done in under ~2 minutes; portrait is illustrated; bio 60–120 words with no credentials → Save → lands on `/authors/<id>`; the network repo has `authors/<id>.yaml` (one commit).
3. Regenerate bio → unsaved bar "bio" → Discard restores; Regenerate again → Save.
4. Upload a photo → square portrait; Remove → initials; Save.
5. Click a sidebar link while dirty → "Leave without saving?".
6. Library: search, each filter chip, sort; URL keeps them; back button restores.
7. Delete the test author → gone from the list; file removed from the repo.

- [ ] **Step 3: Commit (after approval)** — guide page, `GUIDE_PAGES`, test results.

---

## Rollout (with the rest of the Authors stages)
Merge → `grid plug` (dashboard + pipeline) at the end of Stage 4, together with the site-worker deploy and `sync-authors.yml` (network repo) — Asaf's call to batch the deploys.
