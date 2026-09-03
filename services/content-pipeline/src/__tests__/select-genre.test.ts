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
