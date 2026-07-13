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
    expect(prompts.system).toContain("COUNT HONESTY");
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

  it("keeps the 600-900 default word count regardless of genre pack (pre-v2 dedicated behavior)", () => {
    expect(prompts.system).toContain("600-900 word");
    expect(prompts.system).toContain("never exceed 900 words");
  });

  it("throws when sourced mode is missing an item", () => {
    expect(() => buildArticlePrompts({ siteName: "X", brief, mode: "sourced" })).toThrow();
  });

  it("throws when original mode is missing a userRequest", () => {
    expect(() => buildArticlePrompts({ siteName: "X", brief, mode: "original" })).toThrow();
  });

  it("composes without error when content_guidelines is a bare string", () => {
    const p = buildArticlePrompts({
      siteName: "GardenPro",
      brief: { ...brief, topics: ["Gardening"], content_guidelines: "Keep it practical, max 500 words" },
      mode: "original",
      userRequest: "Write about companion planting for tomatoes",
    });
    expect(p.system).toContain("never exceed 500 words");
  });
});
