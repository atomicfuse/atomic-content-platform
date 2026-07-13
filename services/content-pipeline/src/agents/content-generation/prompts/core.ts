/**
 * Shared core of the article prompt system (v2).
 *
 * Owns everything genre-independent: site identity, input mapping for the
 * aggregator's editorial brief, truth & attribution rules (per source mode),
 * craft rules (incl. the no-TL;DR rule and banned AI-isms), the tone safety
 * valve, tagging rules, and the JSON output schema.
 *
 * Genre packs (see ./genres/) contribute register, genre rules, structure,
 * and headline guidance. build-prompts.ts composes the two.
 */

import type { SiteBrief } from "../../../types.js";
import type { PromptContext } from "../generators/base-generator.js";
import type { WordCountTarget } from "../../word-count.js";

export type SourceMode = "sourced" | "original";

export function siteIdentitySection(siteName: string, brief: SiteBrief, role: string): string {
  const themeLine = brief.theme && brief.theme.trim()
    ? `\n\n## Editorial Angle\n${brief.theme.trim()}`
    : "";
  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  return `You are ${role} for ${siteName}, writing for ${brief.audience}. Embody the site's voice — don't just echo its metadata.${themeLine}

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}`;
}

export function inputMappingSection(): string {
  return `## Reading Your Brief
The SUMMARY below is a structured editorial brief. Its section headers vary by source type — read them by ROLE:
- THE PEG ("What It Covers" / "What's Trending"): what happened / what the moment is. This goes up top in your article.
- THE FACT BASE ("Items" / "Key Takeaways"): your complete fact universe. Every concrete claim in your article must be grounded here. You cannot fetch the source URL — nothing outside the brief may be asserted as fact.
- TIMELINESS ("Why It Matters Now"): anchors urgency and framing.
- THE FRAMING HINT ("Content Opportunity"): written for video/social creators — ADAPT its intent to a written article, never obey it literally.
- THE ANGLE MENU ("Key Angles", may be absent): pick ONE angle and commit to it. When absent, derive one angle from the fact base.

The brief is guidance, not gospel: mine it for the angle and framing, but it is also your ONLY source of facts.

Other fields: DESCRIPTION (when present) is a tone hint — often the source's own logline. TAGS are the key entities and natural SEO keywords — work them in. PUBLISHED is your time anchor — write as current ("this week"), never in phrasing that will read stale. EXPIRES (when present) means short shelf life — lean into timeliness. AUTHOR/SOURCE is who originally reported this — attribute to them.`;
}

export function truthRulesSection(mode: SourceMode): string {
  const universal = `## Truth & Attribution (non-negotiable)
- Attribute every reported claim to its source ("Grammer told Vulture", "per reports"). Never state rumor, speculation, or someone's possible intent as established fact.
- ZERO fabricated quotes. Quotation marks only around text that appears verbatim in your source material.
- Separate fact from take. Sourced facts are attributed; your analysis is visibly yours ("the timing suggests", "it's hard not to wonder"). Never blur them.
- Frame unconfirmed things as "reportedly" or as questions — never as accusations of fact. No defamation, ever.`;

  if (mode === "original") {
    return `${universal}
- You are writing from your own knowledge: qualify claims appropriately ("research suggests", "according to experts", "it is generally understood").
- Do NOT state specific statistics, quotes, dates, or attributions you are not confident are real.`;
  }

  return `${universal}

## Incomplete Briefs
- If the brief names or implies data it does not contain (e.g. "Items: — not provided in source material"), NEVER reconstruct the missing data from memory. Attribute the full set to the source, deliver only what the brief supports, or choose an angle that doesn't need the missing data.
- COUNT HONESTY: never inherit a number from the source title that the brief can't cover. Source says "15 things" but the brief lists 6 → your article promises 6, drops the number, or reframes ("the source ranked all 48 — these six tell the story"). Never pad toward a promised count.`;
}

export function craftRulesSection(): string {
  return `## Craft
- When the piece has a news peg — something that happened — it goes up top: what, who, where. THEN your angle. Don't bury the lede under setup. If nothing "happened" (evergreen topics), open with the reader's payoff instead — never manufacture a peg.
- ONE clear angle per article, committed to. Not a survey of every possible angle.
- The headline makes a promise the piece keeps. No clickbait gap.
- The opening paragraph hooks; the closing lands a point. Never end on a recap.
- No summary box up top, no bulleted recap of what you're about to say, no "In conclusion" close.
- Concrete specifics over generic filler. Vary sentence rhythm. Scannable H2/H3 structure.
- NEVER use these phrases (instant tells of generic writing): "in today's fast-paced world", "in today's digital age", "delve", "it's important to note", "it's worth noting", "whether you're a ... or a ...", "in conclusion", "game-changer", "unlock the", "elevate your", "navigate the world of", "look no further", "without further ado", "a testament to", "buckle up". Don't open with a rhetorical question. Don't overuse em-dashes.
- SEO: integrate keywords naturally, never stuffed. The meta description earns the click honestly.

## Tone Safety Valve
Wit and snark are ONLY permitted for celebrity/entertainment subject matter. If the actual subject involves victims, tragedy, crime, disaster, or death, drop to a sober, respectful register — regardless of the site's usual tone or how the item is categorized.`;
}

export function taggingSection(brief: SiteBrief): string {
  return `## Tagging Rules
The site has these main topics: ${brief.topics.join(", ")}
- The FIRST tag MUST be one of the site's topics (exact match, case-insensitive)
- After the topic tag(s), add 2-4 additional descriptive tags
- If the article doesn't clearly fit any topic, pick the closest one`;
}

export function outputSchemaSection(headlineGuidance: string, wc: WordCountTarget, mode: SourceMode): string {
  const countClause = mode === "original"
    ? "Never fabricate facts, statistics, or quotes."
    : "Never fabricate facts or pad a count the brief can't support.";
  return `## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — headline (50-70 chars). ${headlineGuidance}",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — meta description (150-160 chars) that earns the click honestly",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H2, H3 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. No summary box before the body. ${countClause} STRICT: never exceed ${wc.max} words."
}`;
}

/** Render the sourced-mode user prompt from a PromptContext. Omits empty fields. */
export function sourcedUserPrompt(ctx: PromptContext): string {
  const lines: string[] = [`## Source Content (from ${ctx.sourceName})`, ""];
  lines.push(`**Title:** ${ctx.title}`);
  if (ctx.author) lines.push(`**Originally reported by:** ${ctx.author}`);
  lines.push(`**Published:** ${ctx.publishedAt}`);
  if (ctx.expiresAt) lines.push(`**Expires:** ${ctx.expiresAt} (short shelf life — write it timely)`);
  lines.push(`**Categories:** ${ctx.categories}`);
  lines.push(`**Tags:** ${ctx.tags}`);
  lines.push(`**Audience:** ${ctx.audienceTypes}`);

  if (ctx.contentType === "video") {
    lines.push(
      "",
      "**Source type: video.** The source video will be embedded after your first paragraph — write a piece that stands alone but complements it. Never write as if the reader already watched it, and don't transcribe it.",
    );
  } else if (ctx.contentType === "social_post") {
    if (ctx.description) {
      lines.push("", "**Source type: social post.** The description below is the original post text — a tone signal, quotable with attribution. Expand the moment into standalone value.");
    } else {
      lines.push("", "**Source type: social post.** The brief below summarizes a social-media moment. Expand it into standalone value for a reader who never saw the post.");
    }
  }

  if (ctx.description) {
    lines.push("", `**Description:** ${ctx.description}`);
  }

  lines.push("", "## Summary (your editorial brief — and your ONLY source of facts)", ctx.summary);
  lines.push(
    "",
    "Write the article now. Pick ONE angle, put the peg up top, keep every fact grounded in the brief, and follow all system rules.",
  );
  return lines.join("\n");
}

/** Render the original-mode (dedicated) user prompt. */
export function originalUserPrompt(userRequest: string): string {
  return `## Article Request

${userRequest}

Write an original article based on the request above. Follow all system prompt rules regarding voice, truth, craft, and output format.`;
}
