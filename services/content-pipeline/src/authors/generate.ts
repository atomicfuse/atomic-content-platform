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
