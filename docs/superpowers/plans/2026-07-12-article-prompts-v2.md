# Article Generation Prompts v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three shallow article prompts with a composed system (shared core + 4 genre packs × 2 source modes) that removes TL;DR, enforces factual honesty (attribution, count honesty, incomplete-brief rules), and produces angle-driven articles — pipeline-only, no model/routing changes.

**Architecture:** New `prompts/core.ts` (shared sections), `prompts/genres/` (4 packs), `prompts/select-genre.ts` (pure detection function), `prompts/build-prompts.ts` (composer returning `{system, user}`). The three existing prompt files are deleted; the 3 call sites (`claude-generator.ts`, `openai-generator.ts`, `dedicated-agent.ts`) switch to `buildArticlePrompts`. `agent.ts` passes `isFactual` through `GeneratorConfig`.

**Tech Stack:** TypeScript (strict, ESM with `.js` import suffixes), vitest, existing `parseWordCountFromGuidelines`.

**Spec:** `docs/superpowers/specs/2026-07-08-article-prompts-v2-design.md`

## Global Constraints

- TypeScript strict, no `any`, explicit return types on exported functions.
- ESM imports need `.js` suffix (`import ... from "./core.js"`).
- All work in `services/content-pipeline`. Do NOT touch `packages/shared-types`, dashboard, site-worker, or the legacy RSS prompt file `src/agents/content-generation/prompts.ts` (and its test `prompts.test.ts`).
- Models/routing untouched: `claude-generator` stays on `generateContent` (Claude Sonnet), `openai-generator` stays on `gpt-4o-mini`, `router.ts` unchanged.
- **NO COMMITS during implementation.** Per Asaf's standing rule, all tasks end with verification only. A single commit happens in Task 6 ONLY after Asaf's manual QA approval. Never `git add -A`.
- Verify commands run from `services/content-pipeline/`: `pnpm typecheck`, `pnpm test`.
- Word-count defaults: news 600–900; evergreen/pop-culture/review-listicle 800–1200. Site `content_guidelines` override via `parseWordCountFromGuidelines`.

---

### Task 1: Type additions (`ContentItem`, `PromptContext`)

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/types.ts` (interface `ContentItem`, ~line 15)
- Modify: `services/content-pipeline/src/agents/content-generation/generators/base-generator.ts` (`PromptContext` + `buildPromptContext`, lines 34–64; `GeneratorConfig`, lines 16–19)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ContentItem.author: string | null`, `ContentItem.expires_at: string | null`; `PromptContext` with `contentType: string`, `author: string`, `expiresAt: string`, `description: string` (empty string when null upstream), WITHOUT `vertical`; `GeneratorConfig.isFactual?: boolean`.

- [ ] **Step 1: Update `ContentItem` in `types.ts`**

Add two fields after `source` (both present in the aggregator API response, previously not modeled). Keep `vertical` on `ContentItem` — `agent.ts` still reads it for the image style cue.

```ts
  source: { name: string };
  /** Original author/platform, e.g. "Yahoo", "Youtube". Null-safe. */
  author: string | null;
  published_at: string;
  /** When the item stops being current. Null = long shelf life. */
  expires_at: string | null;
```

- [ ] **Step 2: Update `PromptContext` and `buildPromptContext` in `base-generator.ts`**

Replace the `PromptContext` interface and builder (drop `vertical`, add `contentType` / `author` / `expiresAt`, null-safe `description`):

```ts
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
```

Note: `ContentItem.description` is typed `string` today but the API sends null for videos — change it to `description: string | null;` in `types.ts` as part of this step.

- [ ] **Step 3: Add `isFactual` to `GeneratorConfig`**

```ts
export interface GeneratorConfig {
  siteName: string;
  brief: SiteBrief;
  /** Router decision for the item (true = factual/news). Used for genre selection. */
  isFactual?: boolean;
}
```

- [ ] **Step 4: Typecheck — expect failures only in the three old prompt files**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: errors in `prompts/news-article.ts` / `prompts/general-article.ts` (they reference `ctx.vertical`, removed from `PromptContext`). These files are deleted in Task 5. Any OTHER error must be fixed now (e.g. a consumer of `description` not handling null — check `bulk-image.ts` and `index.ts` slice-usage; `item.summary` slicing is unaffected).

---

### Task 2: Genre packs (`prompts/genres/`)

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/types.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/news.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/evergreen.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/pop-culture.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/review-listicle.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/genres/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type GenreId = "news" | "evergreen" | "pop-culture" | "review-listicle"`; `interface GenrePack { id, role, register, rules, structure, headlines, defaultWordCount }`; `const GENRE_PACKS: Record<GenreId, GenrePack>`.

- [ ] **Step 1: Write `genres/types.ts`**

```ts
/**
 * Genre pack contract. A pack contributes register, non-negotiable rules,
 * structure, and headline guidance to the composed article prompt.
 * The shared core (core.ts) owns truth rules, input mapping, tagging,
 * the tone safety valve, and the output schema.
 */

export type GenreId = "news" | "evergreen" | "pop-culture" | "review-listicle";

export interface GenrePack {
  id: GenreId;
  /** Completes "You are ..." in the system prompt opener. */
  role: string;
  /** One paragraph describing the register/voice for this genre. */
  register: string;
  /** 5–8 non-negotiable genre rules, rendered as a bulleted list. */
  rules: string[];
  /** Structure template guidance. */
  structure: string;
  /** Headline guidance for this genre. */
  headlines: string;
  /** Fallback word-count range when content_guidelines don't specify one. */
  defaultWordCount: { min: number; max: number };
}
```

- [ ] **Step 2: Write `genres/news.ts`**

```ts
import type { GenrePack } from "./types.js";

export const newsPack: GenrePack = {
  id: "news",
  role: "a sharp news writer",
  register:
    "Journalistic and precise, but never dry. You report what happened with clean attribution, then earn the reader's stay with a clear angle on why it matters. Confidence comes from specifics, not adjectives.",
  rules: [
    "The news peg goes up top: what happened, who said or did it, where it was reported — within the first two paragraphs.",
    "Attribute every reported fact to its source by name. \"According to reports\" is the floor, a named outlet is better.",
    "If the brief is vague on a point, write around it or hedge explicitly — never sharpen a vague claim into a specific one.",
    "Anchor time to the publish moment: \"this week\", \"on Saturday\" — never phrasing that will read stale in three days.",
    "Analysis is welcome after the facts, and must be visibly the writer's read: \"the timing suggests\", \"what stands out is\".",
    "No fake balance and no manufactured drama — the stakes in the brief are enough.",
  ],
  structure:
    "Open with the peg (2 short paragraphs max). Then your angle — the one lens that organizes everything else. Then supporting facts grouped under 2–4 H2 subheadings that advance the story rather than list it. Close with what happens next or the open question, not a recap.",
  headlines:
    "Factual and specific with the angle visible: name the actor and the action. No question-mark headlines, no \"Everything you need to know\".",
  defaultWordCount: { min: 600, max: 900 },
};
```

- [ ] **Step 3: Write `genres/evergreen.ts`**

```ts
import type { GenrePack } from "./types.js";

export const evergreenPack: GenrePack = {
  id: "evergreen",
  role: "a practical, genuinely useful writer",
  register:
    "Warm, direct, and useful. The reader came with a problem or a curiosity; every section either solves part of it or deepens it. You sound like a knowledgeable friend, not a brochure.",
  rules: [
    "State the practical payoff in the opening: what the reader will know or be able to do by the end.",
    "No fake urgency and no manufactured news peg — evergreen means it reads just as well in six months.",
    "Every H2 section must carry standalone value; a reader who only skims subheadings should still leave with something.",
    "Prefer concrete, doable specifics (numbers, steps, examples) over abstract advice.",
    "Do not pad: if a section exists only to hit word count, cut it.",
    "Address the reader as \"you\" and keep sentences active.",
  ],
  structure:
    "Hook: the problem or promise, concretely. Then deliver in scannable H2/H3 sections ordered by usefulness — the best material never goes last-only. For how-tos, steps in doing order. Close with the single most important takeaway phrased as an action, not a summary.",
  headlines:
    "Plain-spoken benefit statements: say exactly what the reader gets. Numbers are fine when the body truly delivers that count.",
  defaultWordCount: { min: 800, max: 1200 },
};
```

- [ ] **Step 4: Write `genres/pop-culture.ts`**

```ts
import type { GenrePack } from "./types.js";

export const popCulturePack: GenrePack = {
  id: "pop-culture",
  role: "a witty pop-culture writer with real fan literacy",
  register:
    "Playful, knowing, and quick — the voice of someone who genuinely follows this world. Wit is welcome and wanted, but it decorates the facts, never replaces them. Playful, not mean.",
  rules: [
    "Earn the snark with substance: every joke sits on a real, sourced fact. No fact under it, no joke on it.",
    "Pop-culture literacy is the \"pro\" tell: surface the smart connective references a fan would love — genuine ones only, never invented history.",
    "The news peg still goes up top (what happened, who said it, where), THEN your take. Don't bury the lede under bits.",
    "Fact vs. take separation is extra strict here: reported things carry attribution; your spin is unmistakably spin (\"it's hard not to wonder\").",
    "Never punch down, never be mean about bodies, families, or struggles — the target of wit is situations and choices, not vulnerabilities.",
    "Unconfirmed gossip is framed as exactly that: \"reportedly\", \"per sources\" — never stated as established fact.",
  ],
  structure:
    "Peg first, fast and factual. Then the take — one committed angle with personality. Weave sourced facts and your read in an alternating rhythm so the piece never becomes either a dry recap or an unanchored riff. Close on the sharpest observation, not a summary.",
  headlines:
    "Personality with a promise the piece keeps: the reader should smell the take from the headline without it overselling. Names and specifics beat vague teases.",
  defaultWordCount: { min: 800, max: 1200 },
};
```

- [ ] **Step 5: Write `genres/review-listicle.ts`**

```ts
import type { GenrePack } from "./types.js";

export const reviewListiclePack: GenrePack = {
  id: "review-listicle",
  role: "an opinionated critic who always shows the work",
  register:
    "Opinion-forward and decisive — readers came for verdicts, not surveys. Every judgment is justified with a concrete reason; every comparison states its criterion.",
  rules: [
    "Take positions: rank, recommend, or verdict — but every position gets its \"because\" in the same breath.",
    "COUNT HONESTY (extra strict here): the headline number must equal the number of items the body genuinely delivers. Never inherit a bigger count from the source, never pad with filler entries.",
    "Never invent specs, prices, dates, or ratings. If the brief lacks the detail, the entry works without it or attributes it to the source.",
    "Each list entry follows the same shape (what it is → why it earns its spot → who it's for) so the list scans as a system.",
    "State the comparison criterion once, up top, and apply it consistently.",
    "A clear overall verdict or \"if you only take one thing\" belongs near the top or bottom — the reader should never finish unsure what you'd pick.",
  ],
  structure:
    "Open by framing the choice and the criterion. Entries as H2s in a deliberate order (best-first or countdown — pick one and commit). Consistent entry shape throughout. Close with the verdict, not a recap.",
  headlines:
    "If numbered, the number is the body's real count. Signal the criterion when it's the differentiator (\"by market value\", \"for beginners\").",
  defaultWordCount: { min: 800, max: 1200 },
};
```

- [ ] **Step 6: Write `genres/index.ts`**

```ts
import type { GenreId, GenrePack } from "./types.js";
import { newsPack } from "./news.js";
import { evergreenPack } from "./evergreen.js";
import { popCulturePack } from "./pop-culture.js";
import { reviewListiclePack } from "./review-listicle.js";

export type { GenreId, GenrePack } from "./types.js";

export const GENRE_PACKS: Record<GenreId, GenrePack> = {
  news: newsPack,
  evergreen: evergreenPack,
  "pop-culture": popCulturePack,
  "review-listicle": reviewListiclePack,
};
```

- [ ] **Step 7: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: same pre-existing errors from the two doomed prompt files only (see Task 1 Step 4); no new errors.

---

### Task 3: Genre selection (`prompts/select-genre.ts`)

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/prompts/select-genre.ts`
- Test: `services/content-pipeline/src/__tests__/select-genre.test.ts`

**Interfaces:**
- Consumes: `GenreId` from `./genres/index.js`; `SiteBrief` from `../../../types.js`; `ContentItem` from `../types.js`.
- Produces: `selectGenre(input: { brief: SiteBrief; item?: ContentItem; isFactual?: boolean }): GenreId`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/select-genre.test.ts`. Fixtures are condensed from real aggregator payloads observed 2026-07 (see spec):

```ts
import { describe, it, expect } from "vitest";
import { selectGenre } from "../agents/content-generation/prompts/select-genre.js";
import type { SiteBrief } from "../types.js";
import type { ContentItem } from "../agents/content-generation/types.js";

function makeBrief(overrides: Partial<SiteBrief>): SiteBrief {
  return {
    audience: "General readers",
    tone: "Informative",
    article_types: { standard: 100 },
    topics: ["Science"],
    seo_keywords_focus: [],
    content_guidelines: [],
    review_percentage: 0,
    schedule: { articles_per_week: 3, preferred_days: ["Monday"], preferred_time: "10:00" },
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "x",
    url: "https://example.com",
    title: "Title",
    description: "",
    summary: "**What It Covers:** something.",
    thumbnail: null,
    content_type: "article",
    vertical: null,
    categories: [],
    tags: [],
    audience_types: [],
    source: { name: "Feed" },
    author: null,
    published_at: "2026-07-07T00:00:00.000Z",
    expires_at: null,
    language: "EN",
    ...overrides,
  };
}

describe("selectGenre", () => {
  it("returns news for factual items on a general site", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Soccer", "World Cup"] }),
      item: makeItem({ categories: [{ name: "Sports" }, { name: "Soccer" }] }),
      isFactual: true,
    });
    expect(genre).toBe("news");
  });

  it("returns evergreen for non-factual items on a general site", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Pets"] }),
      item: makeItem({ categories: [{ name: "Pets" }], content_type: "social_post" }),
      isFactual: false,
    });
    expect(genre).toBe("evergreen");
  });

  it("NEVER selects pop-culture from item categories alone (miscategorized true-crime case)", () => {
    // Real payload: true-crime video categorized "Pop Culture / Humor and Satire"
    const genre = selectGenre({
      brief: makeBrief({ topics: ["True Crime", "Mysteries"], tone: "Serious, investigative" }),
      item: makeItem({
        content_type: "video",
        categories: [{ name: "Pop Culture" }, { name: "Humor and Satire" }],
        tags: [{ name: "unsolved mysteries" }, { name: "true crime" }],
      }),
      isFactual: false,
    });
    expect(genre).toBe("evergreen");
  });

  it("selects pop-culture when the SITE is pop-culture focused", () => {
    const genre = selectGenre({
      brief: makeBrief({
        topics: ["Celebrity News", "Entertainment"],
        tone: "Witty, playful",
        theme: "Celebrity gossip and pop culture moments",
      }),
      item: makeItem({ categories: [{ name: "Pop Culture" }] }),
      isFactual: false,
    });
    expect(genre).toBe("pop-culture");
  });

  it("pop-culture site + factual item with pop item signals stays pop-culture (gossip has news pegs)", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Celebrity Gossip"], tone: "Snarky" }),
      item: makeItem({ categories: [{ name: "Entertainment" }] }),
      isFactual: true,
    });
    expect(genre).toBe("pop-culture");
  });

  it("pop-culture site + factual item WITHOUT pop item signals falls through to news", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Celebrity Gossip"], tone: "Snarky" }),
      item: makeItem({ categories: [{ name: "Politics" }] }),
      isFactual: true,
    });
    expect(genre).toBe("news");
  });

  it("selects review-listicle when site is review-focused and item signals ranking", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Product Reviews", "Buying Guides"] }),
      item: makeItem({ tags: [{ name: "squad-rankings" }, { name: "market-value" }] }),
      isFactual: false,
    });
    expect(genre).toBe("review-listicle");
  });

  it("dedicated mode (no item): pop site → pop-culture", () => {
    const genre = selectGenre({
      brief: makeBrief({ topics: ["Hollywood", "Celebrity News"] }),
    });
    expect(genre).toBe("pop-culture");
  });

  it("dedicated mode (no item): general site → evergreen", () => {
    const genre = selectGenre({ brief: makeBrief({ topics: ["Gardening"] }) });
    expect(genre).toBe("evergreen");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- select-genre`
Expected: FAIL — cannot resolve `select-genre.js`.

- [ ] **Step 3: Implement `select-genre.ts`**

```ts
/**
 * Genre pack auto-detection.
 *
 * The SITE BRIEF is the register authority — item categories/tags only
 * corroborate, never override. Rationale: aggregator categories are noisy
 * (observed: a true-crime video categorized "Pop Culture / Humor and
 * Satire"); a register as risky as snark must be opted into by the site.
 *
 * Precedence: pop-culture → review-listicle → news (factual) → evergreen.
 */

import type { GenreId } from "./genres/index.js";
import type { SiteBrief } from "../../../types.js";
import type { ContentItem } from "../types.js";

const POP_CULTURE = /celebrit|gossip|pop[\s-]?culture|entertainment|hollywood|showbiz|reality\s*tv/i;
const REVIEW = /review|ranking|ranked|best[\s-]of|buying\s*guide|buyer|top[\s-]?\d+|comparison|versus/i;

function briefSignalText(brief: SiteBrief): string {
  const parts: string[] = [...brief.topics, brief.tone];
  if (brief.theme) parts.push(brief.theme);
  return parts.join(" ");
}

function itemSignalText(item: ContentItem): string {
  return [
    ...item.categories.map((c) => c.name),
    ...item.tags.map((t) => t.name),
  ].join(" ");
}

export interface SelectGenreInput {
  brief: SiteBrief;
  /** Absent for dedicated (user-prompted) articles. */
  item?: ContentItem;
  /** Router decision — true means the factual/news path chose this item. */
  isFactual?: boolean;
}

export function selectGenre(input: SelectGenreInput): GenreId {
  const { brief, item, isFactual } = input;
  const siteText = briefSignalText(brief);
  const sitePop = POP_CULTURE.test(siteText);
  const siteReview = REVIEW.test(siteText);
  const itemText = item ? itemSignalText(item) : "";
  const itemPop = item ? POP_CULTURE.test(itemText) : false;
  const itemReview = item ? REVIEW.test(itemText) : false;

  // Pop-culture: the site must allow it. Non-factual items on a pop site
  // always take it; factual items only when the item corroborates (gossip
  // with a news peg), otherwise they fall through to news.
  if (sitePop && (!isFactual || itemPop)) return "pop-culture";

  // Review/listicle: site allows it AND (item corroborates OR no item —
  // dedicated articles on a review site default to the review register).
  if (siteReview && (itemReview || !item)) return "review-listicle";

  if (isFactual) return "news";
  return "evergreen";
}
```

Note on the SiteBrief `theme` field: it exists as an optional free-text field (used by all three current prompts as `brief.theme`). If typecheck complains, check its exact name in `src/types.ts` — do not add a new field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- select-genre`
Expected: 9 passing.

---

### Task 4: Core + composer (`prompts/core.ts`, `prompts/build-prompts.ts`)

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/prompts/core.ts`
- Create: `services/content-pipeline/src/agents/content-generation/prompts/build-prompts.ts`
- Test: `services/content-pipeline/src/__tests__/build-prompts.test.ts`

**Interfaces:**
- Consumes: `GENRE_PACKS`, `GenrePack`, `GenreId` from `./genres/index.js`; `selectGenre` from `./select-genre.js`; `buildPromptContext`, `PromptContext` from `../generators/base-generator.js`; `parseWordCountFromGuidelines` from `../../word-count.js`; `SiteBrief`, `ContentItem`.
- Produces:
  ```ts
  export interface BuildPromptsParams {
    siteName: string;
    brief: SiteBrief;
    mode: "sourced" | "original";
    item?: ContentItem;      // required when mode === "sourced"
    isFactual?: boolean;     // router hint, sourced mode
    userRequest?: string;    // required when mode === "original"
  }
  export interface ArticlePrompts { system: string; user: string; genre: GenreId; }
  export function buildArticlePrompts(params: BuildPromptsParams): ArticlePrompts;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/build-prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildArticlePrompts } from "../agents/content-generation/prompts/build-prompts.js";
import type { SiteBrief } from "../types.js";
import type { ContentItem } from "../agents/content-generation/types.js";

const brief: SiteBrief = {
  audience: "Sports fans",
  tone: "Energetic, knowledgeable",
  article_types: { standard: 100 },
  topics: ["Soccer", "World Cup"],
  seo_keywords_focus: ["world cup 2026"],
  content_guidelines: ["Cover fixtures with practical viewing info"],
  review_percentage: 0,
  schedule: { articles_per_week: 3, preferred_days: ["Monday"], preferred_time: "10:00" },
};

const item: ContentItem = {
  id: "6a4dacca",
  url: "https://sports.yahoo.com/articles/world-cup",
  title: "World Cup 2026 quarter-final fixtures as last-eight decided",
  description: "The FIFA World Cup 2026 has reached the quarter-final stage...",
  summary:
    "**What It Covers:**\nQuarter-finals set.\n\n**Items:**\n1. France vs Morocco — July 9\n\n**Why It Matters Now:**\nKnockout stage.\n\n**Content Opportunity:**\nPrediction videos.\n\n**Key Angles:**\n- England's pressure as favourites",
  thumbnail: null,
  content_type: "article",
  vertical: null,
  categories: [{ name: "Sports" }, { name: "Soccer" }],
  tags: [{ name: "world-cup-2026" }],
  audience_types: [{ name: "Sports fans" }],
  source: { name: "WorldCup 2026" },
  author: "Yahoo",
  published_at: "2026-07-07T23:35:00.000Z",
  expires_at: "2026-07-15T01:55:21.902Z",
  language: "EN",
};

describe("buildArticlePrompts — sourced mode", () => {
  const prompts = buildArticlePrompts({
    siteName: "SoccerDaily", brief, mode: "sourced", item, isFactual: true,
  });

  it("selects the news genre for factual sports items", () => {
    expect(prompts.genre).toBe("news");
  });

  it("never mentions TL;DR", () => {
    expect(prompts.system.toLowerCase()).not.toContain("tl;dr");
    expect(prompts.system.toLowerCase()).not.toContain("tldr");
    expect(prompts.user.toLowerCase()).not.toContain("tl;dr");
  });

  it("contains site identity, truth rules, craft rules, tagging, output schema", () => {
    expect(prompts.system).toContain("SoccerDaily");
    expect(prompts.system).toContain("Truth & Attribution");
    expect(prompts.system).toContain("fabricated quotes");
    expect(prompts.system).toContain("count");
    expect(prompts.system).toContain("Tagging Rules");
    expect(prompts.system).toContain("Respond ONLY with a valid JSON object");
    expect(prompts.system).toContain("Do NOT include an H1 title");
  });

  it("teaches the brief structure by role, not fixed headers", () => {
    expect(prompts.system).toContain("What It Covers");
    expect(prompts.system).toContain("What's Trending");
    expect(prompts.system).toContain("Key Takeaways");
    expect(prompts.system).toContain("guidance, not gospel");
  });

  it("includes the genre pack register and rules", () => {
    expect(prompts.system).toContain("news peg goes up top");
  });

  it("includes the tone safety valve", () => {
    expect(prompts.system).toContain("victims");
  });

  it("user prompt carries item fields incl. author and time anchoring", () => {
    expect(prompts.user).toContain("World Cup 2026 quarter-final fixtures");
    expect(prompts.user).toContain("Yahoo");
    expect(prompts.user).toContain("2026-07-07");
    expect(prompts.user).toContain("What It Covers");
  });

  it("uses news default word count (600-900) when guidelines have none", () => {
    expect(prompts.system).toContain("600-900 word");
  });

  it("respects word count from content_guidelines", () => {
    const p = buildArticlePrompts({
      siteName: "SoccerDaily",
      brief: { ...brief, content_guidelines: ["max 400 words per article"] },
      mode: "sourced", item, isFactual: true,
    });
    expect(p.system).toContain("never exceed 400 words");
  });
});

describe("buildArticlePrompts — content-type awareness", () => {
  it("video items: embedded-video note present, null description omitted", () => {
    const video: ContentItem = {
      ...item, content_type: "video", description: null, author: "Youtube",
      url: "https://www.youtube.com/watch?v=abc",
    };
    const p = buildArticlePrompts({ siteName: "S", brief, mode: "sourced", item: video, isFactual: false });
    expect(p.user).toContain("embedded after your first paragraph");
    expect(p.user).not.toContain("null");
  });

  it("social posts: description framed as the original post", () => {
    const social: ContentItem = { ...item, content_type: "social_post", description: "While fireworks are fun..." };
    const p = buildArticlePrompts({ siteName: "S", brief, mode: "sourced", item: social, isFactual: false });
    expect(p.user).toContain("original post");
  });
});

describe("buildArticlePrompts — original mode (dedicated)", () => {
  const prompts = buildArticlePrompts({
    siteName: "GardenPro", brief: { ...brief, topics: ["Gardening"] },
    mode: "original", userRequest: "Write about companion planting for tomatoes",
  });

  it("uses original-mode truth rules (qualified claims), not sourced brief mapping", () => {
    expect(prompts.system).toContain("research suggests");
    expect(prompts.system).not.toContain("guidance, not gospel");
  });

  it("carries the user request", () => {
    expect(prompts.user).toContain("companion planting for tomatoes");
  });

  it("throws when sourced mode is missing an item", () => {
    expect(() => buildArticlePrompts({ siteName: "X", brief, mode: "sourced" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/content-pipeline && pnpm test -- build-prompts`
Expected: FAIL — cannot resolve `build-prompts.js`.

- [ ] **Step 3: Implement `core.ts`**

This file holds every shared section as a small builder function. Full content:

```ts
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

Other fields: TAGS are the key entities and natural SEO keywords — work them in. PUBLISHED is your time anchor — write as current ("this week"), never in phrasing that will read stale. EXPIRES (when present) means short shelf life — lean into timeliness. AUTHOR/SOURCE is who originally reported this — attribute to them.`;
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
- The peg goes up top — what happened, who, where — THEN your angle. Don't bury the lede under setup.
- ONE clear angle per article, committed to. Not a survey of every possible angle.
- The headline makes a promise the piece keeps. No clickbait gap.
- The opening paragraph hooks; the closing lands a point. Never end on a recap.
- NO TL;DR, no summary box, no "In conclusion".
- Concrete specifics over generic filler. Vary sentence rhythm. Scannable H2/H3 structure.
- NEVER use these phrases (instant tells of generic writing): "in today's fast-paced world", "in today's digital age", "delve", "it's important to note", "it's worth noting", "whether you're a ... or a ...", "in conclusion", "game-changer", "unlock the", "elevate your", "navigate the world of", "look no further", "without further ado", "a testament to", "buckle up".
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

export function outputSchemaSection(headlineGuidance: string, wc: WordCountTarget): string {
  return `## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — headline (50-70 chars). ${headlineGuidance}",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — meta description (150-160 chars) that earns the click honestly",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H2, H3 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. No TL;DR. Never fabricate facts or pad a count the brief can't support. STRICT: never exceed ${wc.max} words."
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
    lines.push("", "**Source type: social post.** The description below is the original post text — a tone signal, quotable with attribution. Expand the moment into standalone value.");
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
```

- [ ] **Step 4: Implement `build-prompts.ts`**

```ts
/**
 * Composes the full article prompt: shared core + genre pack + source mode.
 * Single entry point for all article generation call sites.
 */

import type { SiteBrief } from "../../../types.js";
import type { ContentItem } from "../types.js";
import { buildPromptContext } from "../generators/base-generator.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";
import { GENRE_PACKS, type GenreId } from "./genres/index.js";
import { selectGenre } from "./select-genre.js";
import {
  craftRulesSection,
  inputMappingSection,
  originalUserPrompt,
  outputSchemaSection,
  siteIdentitySection,
  sourcedUserPrompt,
  taggingSection,
  truthRulesSection,
  type SourceMode,
} from "./core.js";

export interface BuildPromptsParams {
  siteName: string;
  brief: SiteBrief;
  mode: SourceMode;
  /** Required when mode === "sourced". */
  item?: ContentItem;
  /** Router decision hint (sourced mode). */
  isFactual?: boolean;
  /** Required when mode === "original". */
  userRequest?: string;
}

export interface ArticlePrompts {
  system: string;
  user: string;
  genre: GenreId;
}

export function buildArticlePrompts(params: BuildPromptsParams): ArticlePrompts {
  const { siteName, brief, mode, item, isFactual, userRequest } = params;

  if (mode === "sourced" && !item) {
    throw new Error("buildArticlePrompts: sourced mode requires an item");
  }
  if (mode === "original" && !userRequest) {
    throw new Error("buildArticlePrompts: original mode requires a userRequest");
  }

  const genre = selectGenre({ brief, item, isFactual });
  const pack = GENRE_PACKS[genre];
  const wc = parseWordCountFromGuidelines(
    brief.content_guidelines,
    pack.defaultWordCount.min,
    pack.defaultWordCount.max,
  );

  const sections: string[] = [
    siteIdentitySection(siteName, brief, pack.role),
    `## Register\n${pack.register}`,
    `## Genre Rules (non-negotiable)\n${pack.rules.map((r) => `- ${r}`).join("\n")}`,
    truthRulesSection(mode),
  ];
  if (mode === "sourced") {
    sections.push(inputMappingSection());
  }
  sections.push(
    craftRulesSection(),
    `## Structure\n${pack.structure}`,
    taggingSection(brief),
    outputSchemaSection(pack.headlines, wc),
  );

  const system = sections.join("\n\n");
  const user = mode === "sourced"
    ? sourcedUserPrompt(buildPromptContext(item!))
    : originalUserPrompt(userRequest!);

  return { system, user, genre };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/content-pipeline && pnpm test -- build-prompts`
Expected: all passing. If the "600-900 word" assertion fails, check `parseWordCountFromGuidelines` label format — it renders `"600-900 word"` from defaults.

Also run: `pnpm test -- select-genre` — still passing.

---

### Task 5: Wire call sites, delete old prompt files

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/generators/claude-generator.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/generators/openai-generator.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts:31,140-141`
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts` (`genConfig`, ~line 611)
- Delete: `services/content-pipeline/src/agents/content-generation/prompts/news-article.ts`
- Delete: `services/content-pipeline/src/agents/content-generation/prompts/general-article.ts`
- Delete: `services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts`

**Interfaces:**
- Consumes: `buildArticlePrompts` (Task 4), `GeneratorConfig.isFactual` (Task 1).
- Produces: no new interfaces — behavior change only.

- [ ] **Step 1: Update `claude-generator.ts`**

Replace the import of `news-article.js` and the `generate` body's prompt construction:

```ts
import { generateContent } from "../../../lib/ai.js";
import { parseGeneratedArticle } from "./base-generator.js";
import type { Generator, GeneratorConfig } from "./base-generator.js";
import type { ContentItem, GeneratedArticle } from "../types.js";
import { buildArticlePrompts } from "../prompts/build-prompts.js";

export class ClaudeGenerator implements Generator {
  readonly name = "claude";

  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const { system, user, genre } = buildArticlePrompts({
      siteName: config.siteName,
      brief: config.brief,
      mode: "sourced",
      item,
      isFactual: config.isFactual ?? true,
    });

    console.log(`[claude-gen] Generating ${genre} article: "${item.title}"`);

    const { text, usage } = await generateContent({
      systemPrompt: system,
      userPrompt: user,
      // ai.ts maps "claude-sonnet" for CloudGrid, DEFAULT_MODEL for Anthropic SDK
      maxTokens: 4096,
    });

    const article = parseGeneratedArticle(text);
    return { ...article, usage };
  }
}
```

(`isFactual ?? true`: the claude generator is the factual-primary path; when it runs as fallback for a non-factual item, `agent.ts` supplies the explicit `false`.)

- [ ] **Step 2: Update `openai-generator.ts`**

Same substitution — imports and the top of `generate` (client plumbing, response handling, and usage mapping stay exactly as they are):

```ts
import { buildArticlePrompts } from "../prompts/build-prompts.js";
```

```ts
  async generate(item: ContentItem, config: GeneratorConfig): Promise<GeneratedArticle> {
    const { system, user, genre } = buildArticlePrompts({
      siteName: config.siteName,
      brief: config.brief,
      mode: "sourced",
      item,
      isFactual: config.isFactual ?? false,
    });

    console.log(`[openai-gen] Generating ${genre} article: "${item.title}"`);

    const client = getClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
```

Remove the now-unused `buildPromptContext` import from both generators (build-prompts calls it internally).

- [ ] **Step 3: Pass `isFactual` in `agent.ts`**

At the `genConfig` construction (~line 611, after `const decision = ...` routing):

```ts
const genConfig: GeneratorConfig = { siteName, brief, isFactual: decision.isFactual };
```

- [ ] **Step 4: Update `dedicated-agent.ts`**

Line 31, replace the import:

```ts
import { buildArticlePrompts } from "./prompts/build-prompts.js";
```

Lines ~140-141, replace prompt construction:

```ts
  const { system: systemPrompt, user: userPromptText } = buildArticlePrompts({
    siteName,
    brief,
    mode: "original",
    userRequest: userPrompt,
  });
```

The subsequent `generateContent({ systemPrompt, userPrompt: userPromptText })` call is unchanged.

- [ ] **Step 5: Delete the three old prompt files**

```bash
git rm services/content-pipeline/src/agents/content-generation/prompts/news-article.ts \
       services/content-pipeline/src/agents/content-generation/prompts/general-article.ts \
       services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts
```

(`git rm` stages the deletion but nothing is committed yet — the commit gate is Task 6.)

- [ ] **Step 6: Verify no remaining references**

Run: `grep -rn "news-article\|general-article\|dedicated-article" services/content-pipeline/src --include="*.ts"`
Expected: no output.

- [ ] **Step 7: Full typecheck and test suite**

Run: `cd services/content-pipeline && pnpm typecheck && pnpm test`
Expected: typecheck clean (the Task 1 errors disappeared with the deleted files); full suite passing, including pre-existing `prompts.test.ts` (legacy RSS path, untouched) and the new `select-genre.test.ts` / `build-prompts.test.ts`.

Also run root typecheck: `cd ../.. && pnpm typecheck` — expected clean.

---

### Task 6: Manual QA gate + commit (BLOCKED on Asaf)

**Files:** none new.

- [ ] **Step 1: Prepare Asaf's local QA instructions**

Present to Asaf for local testing (`cloudgrid dev`, pipeline on :5000). Suggested checks:
1. Trigger a dedicated article from the dashboard on an evergreen site → no TL;DR, opening states payoff, no banned phrases.
2. Trigger content generation for a site with factual items (news pack) → peg in first two paragraphs, attribution present, time-anchored.
3. If available, a pop-culture site item → snark grounded in facts, peg up top.
4. A video item → article works around the embed, no "in this video" framing.
5. A fact-thin/listicle item (like the "48 squads ranked" example) → count honesty: no invented entries.

- [ ] **Step 2: WAIT for Asaf's explicit approval**

Do not proceed without it. If QA finds issues, fix, re-run `pnpm typecheck && pnpm test`, and re-QA.

- [ ] **Step 3: Commit (only after approval)**

```bash
git add services/content-pipeline/src/agents/content-generation/types.ts \
        services/content-pipeline/src/agents/content-generation/generators/base-generator.ts \
        services/content-pipeline/src/agents/content-generation/generators/claude-generator.ts \
        services/content-pipeline/src/agents/content-generation/generators/openai-generator.ts \
        services/content-pipeline/src/agents/content-generation/agent.ts \
        services/content-pipeline/src/agents/content-generation/dedicated-agent.ts \
        services/content-pipeline/src/agents/content-generation/prompts/ \
        services/content-pipeline/src/__tests__/select-genre.test.ts \
        services/content-pipeline/src/__tests__/build-prompts.test.ts \
        docs/superpowers/plans/2026-07-12-article-prompts-v2.md
git commit -m "feat(content-pipeline): article prompts v2 — composed core + genre packs, remove TL;DR

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

(The three deleted prompt files were already staged by `git rm` in Task 5.)

- [ ] **Step 4: Print compare URL (no `gh pr create`)**

`https://github.com/atomicfuse/atomic-content-platform/compare/main...asaf-new`
