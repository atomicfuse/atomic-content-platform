/**
 * Wizard topic suggestions (Content Brief step) — prompt, Gemini call and parsing.
 * Used by `suggestTopics` in actions/wizard.ts, which adds the no-AI fallback.
 */

export interface TopicSuggestionContext {
  siteName: string;
  siteTagline?: string;
  vertical: string;
  /** Free-text site theme — the strongest signal when present. */
  theme?: string;
  company?: string;
  audience?: string;
  tone?: string;
  contentGuidelines?: string;
}

const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TOPIC_COUNT = 4;

/** Category names that make useless topics (the model sometimes returns them anyway). */
const GENERIC = new Set([
  "expert guides", "latest news", "tips & advice", "tips and advice", "in-depth reviews", "how-to guides",
  "trending topics", "industry insights", "news", "reviews", "guides", "features", "general",
]);

export function buildTopicPrompt(context: TopicSuggestionContext, avoid: readonly string[]): string {
  const info = [`Website name: "${context.siteName}"`];
  if (context.siteTagline) info.push(`Tagline: "${context.siteTagline}"`);
  if (context.theme?.trim()) info.push(`Site theme / editorial angle (PRIMARY signal): ${context.theme.trim()}`);
  if (context.vertical && context.vertical !== "Other") info.push(`Category: ${context.vertical}`);
  if (context.audience) info.push(`Target audience: ${context.audience}`);
  if (context.tone) info.push(`Tone: ${context.tone}`);
  if (context.contentGuidelines) info.push(`Content guidelines: ${context.contentGuidelines}`);

  const avoidBlock = avoid.length > 0
    ? `\nDo NOT repeat or rephrase any of these topics (already suggested) — give genuinely different angles:\n${avoid.map((t) => `- ${t}`).join("\n")}\n`
    : "";

  return `You are the editor-in-chief planning the sections of a new content website.

Website info:
${info.join("\n")}
${avoidBlock}
Suggest exactly ${TOPIC_COUNT} content topics for this site. Each topic is a recurring section: an AI writer will publish article after article under it, sourced from current news and stories, so every topic must be able to produce dozens of distinct articles over months.

Rules:
- Tightly tied to the theme and the audience. If the theme is narrow, stay inside it — a "funny memes" site gets meme/humor topics, never generic categories.
- Specific enough that a reader knows exactly what they'll get ("Royal Family Watch", not "Celebrities").
- Broad enough to never run dry (not a single event, person or product launch).
- Together they cover clearly different angles of the niche, with no overlap between them.
- 2–4 words each, Title Case, no emojis, no numbering.
- NEVER generic labels such as "Latest News", "Expert Guides", "Tips & Advice", "In-Depth Reviews", "How-To Guides", "Trending Topics", "Industry Insights".

Reply with ONLY a JSON array of exactly ${TOPIC_COUNT} strings.

Examples of the quality expected:
- Theme "Travel and eating while traveling" → ["Street Food Trails", "Wine & Brewery Trips", "Hidden Gem Destinations", "Food Festival Calendar"]
- Theme "Funny meme website, showing memes and funny videos" → ["Trending Memes", "Viral Fails", "Pet Reaction Clips", "Internet Culture Drama"]
- Theme "Personal finance for millennials" → ["Budgeting Hacks", "Side Hustle Ideas", "First Home Buying", "Investing Basics"]`;
}

/** Topics from the model's text, minus generic and already-suggested ones; null when unusable. */
export function parseTopics(text: string, avoid: readonly string[]): string[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const seen = new Set(avoid.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const topic = item.trim();
    const key = topic.toLowerCase();
    if (!topic || topic.length > 60 || GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out.length >= 2 ? out.slice(0, TOPIC_COUNT) : null;
}

/** One Gemini call. Null when the request fails or the answer is unusable (the caller decides the fallback). */
export async function requestTopicsFromGemini(
  context: TopicSuggestionContext,
  avoid: readonly string[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[] | null> {
  const res = await fetchFn(`${GEMINI_API_BASE}/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildTopicPrompt(context, avoid) }] }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
        // 2.5 Flash "thinks" by default and the thinking counts against maxOutputTokens — with a
        // small budget the answer came back cut off, so every request fell back to the same list.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.warn(`[wizard:suggestTopics] gemini HTTP ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> };
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const topics = parseTopics(text, avoid);
  if (!topics) console.warn(`[wizard:suggestTopics] unusable answer (finish=${candidate?.finishReason}): ${text.slice(0, 120)}`);
  return topics;
}
