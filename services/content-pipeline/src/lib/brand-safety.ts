/**
 * Brand-safe article slugs, checked in two layers: a word list (below) and an AI reviewer that
 * judges tone and innuendo the way verification vendors do (aiSlugJudge).
 *
 * Advertisers and verification vendors (IAS, DoubleVerify) block ads by keywords in the page URL,
 * so an unsafe word in a slug costs fill even when the article is fine. Categories follow the GARM
 * Brand Safety Floor + Suitability Framework (still the industry reference after GARM closed in
 * 2024). Deliberately NOT listed: alcohol, gambling, "conspiracy" — suitability (not floor) topics
 * that whole verticals in the network are built on (wine travel, mystery sites).
 */

export type BrandSafetyCategory =
  | "adult_sexual"
  | "arms"
  | "crime"
  | "death_injury_conflict"
  | "hate"
  | "obscenity"
  | "drugs_tobacco"
  | "terrorism"
  | "sensitive_social_issues"
  | "violence"
  | "negative_tone"
  | "ai_review";

/** Slug words (and hyphenated phrases) per category. Simple plurals ("guns") match automatically. */
/** Word-list categories (`ai_review` hits come from the AI reviewer, not a list). */
const TERMS: Record<Exclude<BrandSafetyCategory, "ai_review">, readonly string[]> = {
  adult_sexual: ["sex", "sexual", "sexually", "sexy", "porn", "porno", "pornography", "nude", "nudity", "naked", "nsfw", "erotic", "xxx", "onlyfans", "stripper", "escort", "fetish", "orgasm", "topless", "bachelorette", "bachelor-party", "hookup", "racy", "raunchy", "steamy", "seductive", "lingerie-photo", "affair", "cheating", "cheated", "cheater"],
  arms: ["gun", "rifle", "firearm", "ammo", "ammunition", "shooting", "shooter", "gunman", "gunfire", "weapon", "ar-15"],
  crime: ["murder", "murdered", "murderer", "homicide", "rape", "raped", "rapist", "kidnap", "kidnapped", "kidnapping", "abuse", "abused", "abuser", "assault", "assaulted", "trafficking", "molest", "molested", "molestation", "pedophile", "stabbing", "stabbed", "arson", "robbery", "crime", "criminal", "arrest", "arrested", "jail", "jailed", "prison", "inmate", "convicted", "sentenced", "manslaughter"],
  death_injury_conflict: ["death", "dead", "die", "dies", "died", "dying", "kill", "killed", "killing", "killer", "fatal", "fatality", "corpse", "funeral", "obituary", "injured", "injury", "injuries", "crash", "war", "warfare", "bomb", "bombing", "explosion", "massacre", "genocide", "airstrike", "missile", "invasion", "hostage", "casualties", "gaza", "tragedy", "tragic", "disaster", "catastrophe", "drowned", "drowning"],
  hate: ["racist", "racism", "nazi", "neo-nazi", "slur", "antisemitic", "antisemitism", "islamophobia", "homophobic", "transphobic", "hate-crime", "white-supremacist", "supremacist", "extremist"],
  obscenity: ["fuck", "fucking", "shit", "bitch", "wtf", "bastard"],
  drugs_tobacco: ["drug", "cocaine", "heroin", "meth", "methamphetamine", "fentanyl", "opioid", "overdose", "overdosed", "cannabis", "marijuana", "vape", "vaping", "e-cigarette", "tobacco", "narcotic"],
  terrorism: ["terror", "terrorist", "terrorism", "isis", "jihad", "jihadist", "extremism", "radicalized"],
  violence: ["fight", "fighting", "brawl", "slap", "slapped", "punch", "punched", "attack", "attacked", "violent", "violence", "beating", "beaten", "feud"],
  negative_tone: ["stupid", "idiot", "idiotic", "dumb", "moron", "loser", "liar", "lying", "pathetic", "disgusting", "trash", "worst", "hate", "hated", "hates", "ugly", "fat-shaming", "humiliated", "humiliating", "slammed", "scandal", "outrage", "meltdown", "disgraced"],
  sensitive_social_issues: ["suicide", "suicidal", "self-harm", "eating-disorder", "eating-disorders", "anorexia", "anorexic", "bulimia", "abortion", "euthanasia"],
};

export interface BrandSafetyHit { category: BrandSafetyCategory; term: string }

/** Every (category, term) as hyphen-split token sequences, longest phrases first so "eating-disorders" wins over parts. */
const PATTERNS = (Object.entries(TERMS) as Array<[BrandSafetyCategory, readonly string[]]>)
  .flatMap(([category, terms]) => terms.map((term) => ({ category, term, tokens: term.split("-") })))
  .sort((a, b) => b.tokens.length - a.tokens.length);

function tokenMatches(token: string, word: string, plural: boolean): boolean {
  return token === word || (plural && (token === `${word}s` || token === `${word}es`));
}

/**
 * Index ranges [start, end) of every unsafe phrase in the slug's tokens. Exact matches are claimed
 * first so a listed form ("dies") is reported over a plural of a shorter entry ("die" + s).
 * Only a phrase's last word may be plural ("eating-disorders").
 */
function scan(tokens: readonly string[]): Array<{ hit: BrandSafetyHit; start: number; end: number }> {
  const out: Array<{ hit: BrandSafetyHit; start: number; end: number }> = [];
  const used = new Set<number>();
  for (const plural of [false, true]) {
    for (const p of PATTERNS) {
      for (let i = 0; i + p.tokens.length <= tokens.length; i++) {
        const span = p.tokens.map((_, k) => i + k);
        if (span.some((k) => used.has(k))) continue;
        const last = p.tokens.length - 1;
        if (!p.tokens.every((w, k) => tokenMatches(tokens[i + k]!, w, plural && k === last))) continue;
        span.forEach((k) => used.add(k));
        out.push({ hit: { category: p.category, term: p.term }, start: i, end: i + p.tokens.length });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Brand-unsafe words in a slug (empty = safe). */
export function findUnsafeSlugTerms(slug: string): BrandSafetyHit[] {
  const seen = new Set<string>();
  return scan(normalizeSlug(slug).split("-").filter(Boolean))
    .map((m) => m.hit)
    .filter((h) => (seen.has(h.term) ? false : (seen.add(h.term), true)));
}

/** The slug with every unsafe word removed. */
export function stripUnsafeTerms(slug: string): string {
  const tokens = normalizeSlug(slug).split("-").filter(Boolean);
  const drop = new Set<number>();
  for (const m of scan(tokens)) for (let k = m.start; k < m.end; k++) drop.add(k);
  return tokens.filter((_, i) => !drop.has(i)).join("-");
}

const MAX_LEN = 60;

/** Lowercase kebab-case, at most 60 chars (cut on a word boundary). */
export function normalizeSlug(input: string): string {
  const s = input.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length <= MAX_LEN) return s;
  const cut = s.slice(0, MAX_LEN);
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut;
}

/** Asks an AI for a neutral slug that avoids `terms`; returns raw text. */
export type SlugRewriter = (slug: string, terms: string[], title: string) => Promise<string>;

/** Second opinion: would brand-safety vendors flag this slug? `words` = the problem words. */
export type SlugJudge = (slug: string, title: string) => Promise<{ safe: boolean; words: string[] }>;

/** Reviewer verdict, or null when there is no usable opinion (error / unreadable answer). */
async function askJudge(judge: SlugJudge | undefined, slug: string, title: string): Promise<{ safe: boolean; words: string[] } | null> {
  if (!judge) return null;
  try {
    return await judge(slug, title);
  } catch (err) {
    console.warn("[brand-safety] slug review failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The slug without the given words (any form ending in s/es). */
function stripWords(slug: string, words: readonly string[]): string {
  const drop = new Set(words.flatMap((w) => normalizeSlug(w).split("-")).filter(Boolean));
  return normalizeSlug(slug).split("-").filter((t) => t && !drop.has(t) && !drop.has(t.replace(/e?s$/, ""))).join("-");
}

/**
 * A brand-safe version of `slug`, checked by two layers: the word list (GARM floor + tone) and, when
 * given, an AI reviewer that judges it the way IAS/DoubleVerify would. Unchanged when both pass;
 * otherwise one AI rewrite (kept only if both layers pass it), else the flagged words removed.
 * Never empty, never blocks the article.
 */
export async function makeSlugBrandSafe(
  slug: string, title: string, rewrite: SlugRewriter, judge?: SlugJudge,
): Promise<{ slug: string; changed: boolean; hits: BrandSafetyHit[] }> {
  const listHits = findUnsafeSlugTerms(slug);
  const verdict = await askJudge(judge, slug, title);
  const aiWords = verdict && !verdict.safe ? verdict.words : [];
  const hits: BrandSafetyHit[] = [...listHits, ...aiWords.map((term) => ({ category: "ai_review" as const, term }))];
  if (listHits.length === 0 && !(verdict && !verdict.safe)) return { slug, changed: false, hits: [] };
  const terms = [...new Set(hits.map((h) => h.term))];
  try {
    const candidate = normalizeSlug(await rewrite(slug, terms, title));
    if (candidate.split("-").filter(Boolean).length >= 2 && findUnsafeSlugTerms(candidate).length === 0) {
      const second = await askJudge(judge, candidate, title);
      if (!second || second.safe) return { slug: candidate, changed: true, hits };
    }
  } catch (err) {
    console.warn("[brand-safety] slug rewrite failed:", err instanceof Error ? err.message : err);
  }
  const stripped = stripWords(stripUnsafeTerms(slug), aiWords);
  const fallback = stripped.split("-").filter(Boolean).length >= 2 ? stripped : `${stripped ? `${stripped}-` : ""}latest-story`;
  return { slug: fallback, changed: true, hits };
}

/** Reads the reviewer's JSON answer ({ "safe": boolean, "words": [...] }); null when unusable. */
export function parseJudgeVerdict(text: string): { safe: boolean; words: string[] } | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[0]) as { safe?: unknown; words?: unknown };
    if (typeof raw.safe !== "boolean") return null;
    const words = Array.isArray(raw.words) ? raw.words.filter((w): w is string => typeof w === "string").map((w) => w.trim().toLowerCase()).filter(Boolean) : [];
    return { safe: raw.safe, words };
  } catch {
    return null;
  }
}

/** Prompt line telling the article writer the slug rule up front. */
export const SLUG_BRAND_SAFETY_RULE =
  "brand-safe for advertisers: neutral, descriptive words only — never words about sex/nudity/innuendo (e.g. bachelorette, hookup, racy), weapons/shootings, crime/prison/arrests, death/killing/war/tragedy, violence (fight, brawl, slap), drugs/overdose, terrorism, hate, profanity, insults or negativity (stupid, liar, worst, slammed, scandal), suicide/self-harm/eating disorders/abortion (e.g. 'teen-wellness-and-body-image', not 'eating-disorders-teens'), even when the article or a show's name contains them";

/** The rewrite prompt used by the pipeline's AI rewriter. */
export function slugRewritePrompt(slug: string, terms: readonly string[], title: string): string {
  return `Rewrite this article URL slug so it is brand-safe for advertisers.

Article title: ${title}
Current slug: ${slug}
Words that must not appear (including any form or synonym of them): ${terms.join(", ")}

Rules: 3-8 lowercase words in kebab-case, neutral and positive-to-neutral in tone, descriptive of what the article is about. No sensitive words of any kind: sex or innuendo (bachelorette, hookup, racy), weapons, crime, prison, death, war, tragedy, violence (fight, brawl), drugs, terrorism, hate, profanity, insults or negativity (stupid, liar, worst, slammed, scandal), suicide, self-harm, eating disorders, abortion. Leave out a show or film title if it contains such a word.
Reply with ONLY the slug.`;
}

/** Rewriter backed by the pipeline's text provider chain (lib/ai.ts). */
export const aiSlugRewriter: SlugRewriter = async (slug, terms, title) => {
  const { generateContent } = await import("./ai.js");
  const result = await generateContent({
    systemPrompt: "You write short, neutral, descriptive URL slugs for a content website.",
    userPrompt: slugRewritePrompt(slug, terms, title),
    maxTokens: 60,
  });
  return result.text.trim().split(/\s+/)[0] ?? "";
};

/** Reviewer backed by the provider chain: judges a slug like an ad-verification vendor would. */
export const aiSlugJudge: SlugJudge = async (slug, title) => {
  const { generateContent } = await import("./ai.js");
  const result = await generateContent({
    systemPrompt: "You are a brand-safety reviewer for programmatic advertising (GARM Brand Safety Floor + Suitability Framework, as applied by IAS and DoubleVerify URL keyword checks).",
    userPrompt: `Would advertiser brand-safety tools flag this article URL slug as unsafe or unsuitable?
Slug: ${slug}
Article title (context only — judge the slug): ${title}

Flag insults and negative tone (stupid, liar, worst, slammed), sexual content or innuendo (bachelorette, hookup, racy), violence or fighting, crime, death, tragedy, drugs, terrorism, hate, profanity, mental-health crises, and controversy words. Alcohol, wine, beer and gambling words are acceptable. Neutral celebrity, TV, sports, travel and lifestyle words are safe.
Reply with ONLY JSON: {"safe": true|false, "words": ["each flagged word as it appears in the slug"]}`,
    maxTokens: 120,
  });
  const verdict = parseJudgeVerdict(result.text);
  if (!verdict) throw new Error(`unreadable review: ${result.text.slice(0, 80)}`);
  return verdict;
};

/** The slug an article is saved under: brand-safe by both layers (logged when rewritten). */
export async function brandSafeSlug(
  slug: string, title: string, rewrite: SlugRewriter = aiSlugRewriter, judge: SlugJudge = aiSlugJudge,
): Promise<string> {
  const safe = await makeSlugBrandSafe(normalizeSlug(slug), title, rewrite, judge);
  if (safe.changed) console.log(`[brand-safety] slug "${slug}" → "${safe.slug}" (${safe.hits.map((h) => `${h.term}:${h.category}`).join(", ")})`);
  return safe.slug;
}
