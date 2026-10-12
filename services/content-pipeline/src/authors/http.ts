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
