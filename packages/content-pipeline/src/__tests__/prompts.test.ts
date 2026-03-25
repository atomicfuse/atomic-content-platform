import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../agents/content-generation/prompts.js";
import type { SiteBrief } from "@atomic-platform/shared-types";
import type { RssItem, ParsedContent } from "../agents/content-generation/rss.js";

const mockBrief: SiteBrief = {
  audience: "Tech-savvy millennials",
  tone: "Conversational and informative",
  article_types: { listicle: 40, standard: 30 },
  topics: ["AI", "gadgets"],
  seo_keywords_focus: ["tech news 2026"],
  content_guidelines: ["Lead with a compelling hook", "Include one statistic"],
  review_percentage: 5,
  schedule: { articles_per_week: 3, preferred_days: ["Monday"], preferred_time: "10:00" },
};

const mockRssItem: RssItem = {
  title: "Snake Found in Bedroom",
  link: "https://example.com/snake-article",
  pubDate: "Wed, 25 Mar 2026 10:00:00 GMT",
  htmlContent: "<p>A snake was found.</p>",
  enclosureUrl: undefined,
};

const mockParsedContent: ParsedContent = {
  textBody: "A snake was found in a bedroom.",
  featuredImageUrl: "https://img.com/snake.jpg",
  inlineImages: [{ src: "https://img.com/removal.jpg", alt: "Removal" }],
  youtubeEmbeds: ['<iframe src="https://www.youtube.com/embed/abc"></iframe>'],
};

describe("buildSystemPrompt", () => {
  it("includes site name and tone", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("CoolNews");
    expect(prompt).toContain("Conversational and informative");
  });

  it("includes audience and content guidelines", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("Tech-savvy millennials");
    expect(prompt).toContain("Lead with a compelling hook");
  });

  it("instructs Claude to respond with JSON", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("JSON");
  });
});

describe("buildUserPrompt", () => {
  it("includes the source article title and text body", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("Snake Found in Bedroom");
    expect(prompt).toContain("A snake was found in a bedroom.");
  });

  it("includes YouTube embed placeholder", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("youtube.com/embed/abc");
  });

  it("includes inline image info", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("https://img.com/removal.jpg");
  });
});
