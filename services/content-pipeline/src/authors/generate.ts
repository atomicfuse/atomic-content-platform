import { generateContent } from "../lib/ai.js";
import { recordImageUsage, recordTextUsage } from "../costs/recorder.js";
import { buildTextPrompt, parseTextPart, type AuthorDraft, type SiteContext, type TextPart } from "./text.js";
import { generatePortraitImage, portraitKey, type PortraitStyle } from "./portrait.js";
import { AuthorGenerateError } from "./http.js";

export { portraitKey };
export type AuthorPart = TextPart | "portrait";

export interface GenerateRequest {
  part: AuthorPart;
  authorId?: string;
  draft: AuthorDraft;
  siteContext: SiteContext & { site?: string };
  takenNames: string[];
  /** Allowed names for the "verticals" part. */
  verticalOptions?: string[];
  /** Portrait requests only (default realistic). */
  portraitStyle?: PortraitStyle;
}

export interface GenerateDeps {
  generateText(p: { systemPrompt: string; userPrompt: string; maxTokens?: number }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; estimated?: boolean }; model: string }>;
  generatePortrait(authorId: string, draft: AuthorDraft, style: PortraitStyle): Promise<{ path: string; model: string }>;
  recordText(p: Parameters<typeof recordTextUsage>[0]): Promise<void>;
  recordImage(p: Parameters<typeof recordImageUsage>[0]): Promise<void>;
}

const DEFAULT_DEPS: GenerateDeps = {
  generateText: (p) => generateContent(p),
  generatePortrait: (id, draft, style) => generatePortraitImage(id, draft, style),
  recordText: recordTextUsage,
  recordImage: recordImageUsage,
};

type PartValue = string | string[] | { kind: "generated"; path: string };

/** Under the dashboard proxy's 55 s timeout, so the browser always gets this endpoint's own answer. */
const DEFAULT_DEADLINE_MS = 50_000;

function tooSlow(part: AuthorPart): AuthorGenerateError {
  return new AuthorGenerateError(`Generating the ${part} took too long. Try again.`, 504);
}

/** Resolve with `work`, or reject once `ms` runs out (the work itself keeps going). */
function withinDeadline<T>(work: Promise<T>, ms: number, part: AuthorPart): Promise<T> {
  if (ms <= 0) return Promise.reject(tooSlow(part));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(tooSlow(part)), ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** One profile part, validated; text parts get one retry with the rejection reason. Nothing is saved. */
export async function generateAuthorPart(
  req: GenerateRequest,
  deps: GenerateDeps = DEFAULT_DEPS,
  opts: { deadlineMs?: number } = {},
): Promise<{ part: AuthorPart; value: PartValue; model: string }> {
  const site = req.siteContext.site ?? "authors";
  const endsAt = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const left = (): number => endsAt - Date.now();
  if (req.part === "portrait") {
    try {
      const { path, model } = await withinDeadline(deps.generatePortrait(req.authorId!, req.draft, req.portraitStyle ?? "realistic"), left(), "portrait");
      await deps.recordImage({ siteDomain: site, source: "authors", model, images: 1 });
      return { part: "portrait", value: { kind: "generated", path }, model };
    } catch (err) {
      if (err instanceof AuthorGenerateError) throw err;
      throw new AuthorGenerateError(`Portrait failed: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  }
  const prompt = buildTextPrompt(req.part, req.draft, req.siteContext, req.takenNames, Math.random, req.verticalOptions ?? []);
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = attempt === 0 ? prompt.user : `${prompt.user}\n\nYour previous answer was rejected: ${reason}. Try again, following every rule.`;
    // The call is paid for even when it lands after the deadline, so its cost is recorded either way.
    const call = deps.generateText({ systemPrompt: prompt.system, userPrompt, maxTokens: 600 });
    const recorded = call.then((o) => deps.recordText({ siteDomain: site, source: "authors", model: o.model, inputTokens: o.usage.inputTokens, outputTokens: o.usage.outputTokens, estimated: o.usage.estimated ?? false }));
    recorded.catch(() => undefined);
    const out = await withinDeadline(call, left(), req.part);
    await recorded;
    const parsed = parseTextPart(req.part, out.text, req.takenNames, req.verticalOptions ?? []);
    if (parsed.ok) return { part: req.part, value: parsed.value, model: out.model };
    reason = parsed.reason;
  }
  throw new AuthorGenerateError(`Couldn't generate a valid ${req.part}: ${reason}`, 422);
}
