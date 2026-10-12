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

/**
 * Invented credentials, employers, awards and publications. Each pattern needs the claim's verb or frame, so beat
 * language ("awards season", "college football", "royals correspondent", "350 degrees") still passes.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\baward[- ]winning\b/i,
  /\b(won|wins|winning|received|earned)\s+(an?\s+|the\s+)?(\w+\s+){0,2}(awards?|prizes?|honou?rs?)\b/i,
  /\b(pulitzer|peabody|james beard)\b/i,
  /\b(is|was|been|an?)\s+(\w+-)?(nominated|nominee)\b/i,
  /\b(ph\.?\s?d|doctorate|mba)\b/i,
  /\b(holds?|held|earned|has|with)\s+(an?\s+)?(\w+\s+)?(degree|diploma)\b/i,
  /\b(bachelor|master)'?s\s+(degree|in)\b/i,
  /\b(studied|graduated|attended|trained)\b[^.]{0,40}?\b(at|from)\b/i,
  /\bgraduate\s+of\b/i,
  /\balum(na|nae|ni|nus)?\b/i,
  /\buniversit(y|ies)\b/i,
  /\b(a|an|is|as)\s+(\w+\s+)?(certified|licensed)\s+\w+/i,
  /\bformer(ly)?\s+(an?\s+|the\s+)?(\w+\s+)?(editor|writer|reporter|journalist|chef|correspondent|producer|columnist|critic|staffer)\b/i,
  /\bveteran\s+(\w+\s+)?(journalist|reporter|editor|writer|critic|correspondent|columnist)\b/i,
  /\bworked\s+(at|for|with)\b/i,
  /\b(spent|worked)\s+(\w+\s+){0,3}(years?|decades?)\s+(at|with|for)\b/i,
  /\b(editor|writer|reporter|correspondent|columnist|contributor)\s+(at|for|of|to)\s+(the|an?)\b/i,
  /\bstaff\s+writer\b/i,
  /\b(published|featured)\s+in\b/i,
  /\b(has|have|had)\s+(also\s+)?appeared\s+in\b/i,
  /\bbylines?\s+in\b/i,
];

export function bioProblem(bio: string): string | null {
  const words = bio.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60 || words > 120) return `bio must be 60–120 words (got ${words})`;
  if (CREDENTIAL_PATTERNS.some((re) => re.test(bio))) return "bio claims a credential, employer, award or publication — describe the beat and voice only";
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

/** Strip a markdown code fence some models wrap JSON in. */
const FENCE_OPEN = /^`{3}(?:json)?\s*/i;
const FENCE_CLOSE = /`{3}\s*$/;

function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(FENCE_OPEN, "").replace(FENCE_CLOSE, "").trim();
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
      .filter((b) => {
        if (b.length < 2 || b.length > 30 || seen.has(b.toLowerCase())) return false;
        seen.add(b.toLowerCase());
        return true;
      });
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
