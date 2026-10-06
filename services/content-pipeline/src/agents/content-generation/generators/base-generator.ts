/**
 * Base Generator interface and shared prompt context builder.
 *
 * All generators (Claude, OpenAI) implement the Generator interface.
 * The buildPromptContext utility extracts structured prompt input from
 * Content Aggregator v2 items — NO URL scraping.
 */

import type { ContentItem, GeneratedArticle } from "../types.js";
import type { SiteBrief } from "../../../types.js";
import type { TokenUsage } from "../../../costs/usage.js";

// ---------------------------------------------------------------------------
// Generator interface
// ---------------------------------------------------------------------------

export interface GeneratorConfig {
  siteName: string;
  brief: SiteBrief;
  /** Router decision for the item (true = factual/news). Used for genre selection. */
  isFactual?: boolean;
}

/** All generators must implement this interface. */
export interface Generator {
  /** Generator identifier for logging. */
  readonly name: string;
  /** Generate an article from a content item. */
  generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle>;
}

// ---------------------------------------------------------------------------
// Shared prompt context builder
// ---------------------------------------------------------------------------

/** Structured context extracted from a ContentItem for use in prompts. */
export interface PromptContext {
  title: string;
  /** Empty string when the API sends null (e.g. videos). */
  description: string;
  summary: string;
  categories: string;
  tags: string;
  audienceTypes: string;
  sourceName: string;
  /** Original author/platform, empty string when unknown. */
  author: string;
  publishedAt: string;
  /** Empty string when no expiry (long shelf life). */
  expiresAt: string;
  /** "article" | "video" | "social_post" (open set from aggregator). */
  contentType: string;
  language: string;
}

/**
 * Build structured prompt context from a ContentItem.
 * Uses API-provided fields — NO URL scraping.
 */
export function buildPromptContext(item: ContentItem): PromptContext {
  return {
    title: item.title,
    description: item.description ?? "",
    summary: item.summary,
    categories: item.categories.map((c) => c.name).join(", ") || "General",
    tags: item.tags.map((t) => t.name).join(", ") || "none",
    audienceTypes: item.audience_types.map((a) => a.name).join(", ") || "General",
    sourceName: item.source.name,
    author: item.author ?? "",
    publishedAt: item.published_at,
    expiresAt: item.expires_at ?? "",
    contentType: item.content_type,
    language: item.language,
  };
}

/**
 * Best-effort repair of near-JSON model output: drops trailing commas before
 * `}`/`]` and escapes raw control characters (newlines, tabs) inside strings.
 */
export function repairJson(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      } else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r") {
        out += "\\r";
        continue;
      } else if (ch === "\t") {
        out += "\\t";
        continue;
      }
    } else if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** JSON.parse, then JSON.parse of the repaired text. Null when both fail. */
function tryParseArticle(candidate: string): GeneratedArticle | null {
  for (const text of [candidate, repairJson(candidate)]) {
    try {
      return JSON.parse(text) as GeneratedArticle;
    } catch {
      // Try the next form
    }
  }
  return null;
}

/**
 * Parse a JSON response from a model, handling optional markdown fences.
 *
 * Models sometimes wrap JSON in fences, add preamble text, return near-JSON
 * (trailing commas, raw newlines in strings) or truncated responses. This
 * function tries multiple strategies before giving up, and includes a preview
 * of the raw response in the error for debugging.
 */
export function parseGeneratedArticle(raw: string): GeneratedArticle {
  // Strategy 1: extract from markdown fences, preferring the longest one (most likely the full JSON)
  const fenceCandidates = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((m) => m[1]!.trim())
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length);

  // Strategy 2: the outermost { ... } block. Strategy 3: the raw string as-is.
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  const braceCandidate = braceStart !== -1 && braceEnd > braceStart ? [raw.slice(braceStart, braceEnd + 1)] : [];

  for (const candidate of [...fenceCandidates, ...braceCandidate, raw.trim()]) {
    const parsed = tryParseArticle(candidate);
    if (parsed) return parsed;
  }

  const preview = raw.length > 500
    ? `${raw.slice(0, 250)}…[${raw.length} chars]…${raw.slice(-250)}`
    : raw;
  throw new Error(`Failed to parse generated article as JSON. Response preview: ${preview}`);
}

// ---------------------------------------------------------------------------
// Output checks — retry once on unparseable output or leaked prompt jargon
// ---------------------------------------------------------------------------

/** Prompt terms that must never reach readers ("Per the brief, …", "## The Peg"). */
const PROMPT_JARGON = /\b(?:the|our|my) brief\b|\bthe peg\b/i;

/** Returns the first leaked prompt term in the reader-visible fields, or null. */
export function findPromptJargon(article: Pick<GeneratedArticle, "title" | "description" | "body">): string | null {
  for (const field of [article.title, article.description, article.body]) {
    const match = PROMPT_JARGON.exec(field ?? "");
    if (match) return match[0];
  }
  return null;
}

/** Deterministic last resort: "the brief" → "the report", "the peg" → "the story" (case kept). */
function sanitizePromptJargon(text: string): string {
  return text
    .replace(/\b(?:the|our|my) brief\b/gi, (m) => (m[0] === m[0]!.toUpperCase() ? "The report" : "the report"))
    .replace(/\bthe peg\b/gi, (m) => (m[0] === m[0]!.toUpperCase() ? "The story" : "the story"));
}

/** Output of one model call, as returned by generateContent / generateWithOpenAI. */
export interface ModelCallResult {
  text: string;
  usage: TokenUsage;
  model: string;
}

/**
 * Runs `call` and validates the result, retrying once when the output can't be
 * parsed or leaks prompt jargon. `call` receives a correction note on the retry
 * (append it to the user prompt). Usage is summed across attempts.
 */
export async function generateArticleWithChecks(
  call: (retryNote?: string) => Promise<ModelCallResult>,
): Promise<GeneratedArticle> {
  const MAX_ATTEMPTS = 2;
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0, estimated: false };
  let retryNote: string | undefined;
  let lastParseError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await call(retryNote);
    total.inputTokens += result.usage.inputTokens;
    total.outputTokens += result.usage.outputTokens;
    total.estimated = total.estimated || result.usage.estimated;

    let article: GeneratedArticle;
    try {
      article = parseGeneratedArticle(result.text);
    } catch (err) {
      lastParseError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[generator] attempt ${attempt}: unparseable output (${result.model})`);
      retryNote = "Your previous reply was not valid JSON. Reply with ONLY the JSON object described in the Output Format.";
      continue;
    }

    const jargon = findPromptJargon(article);
    if (!jargon) return { ...article, usage: { ...total }, model: result.model };
    if (attempt === MAX_ATTEMPTS) {
      console.warn(`[generator] prompt jargon "${jargon}" survived the retry — sanitising (${result.model})`);
      return {
        ...article,
        title: sanitizePromptJargon(article.title),
        description: sanitizePromptJargon(article.description),
        body: sanitizePromptJargon(article.body),
        usage: { ...total },
        model: result.model,
      };
    }
    console.warn(`[generator] attempt ${attempt}: leaked prompt jargon "${jargon}" — retrying`);
    retryNote = `Your previous draft wrote "${jargon}". Readers never see your brief: rewrite without "the brief", "the peg" or any prompt term, attributing facts to the original outlet.`;
  }
  throw lastParseError ?? new Error("Failed to parse generated article as JSON.");
}
