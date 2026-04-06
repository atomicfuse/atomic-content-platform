import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt, type SourceArticle } from "../agents/content-generation/prompts.js";
import type { SiteBrief } from "@atomic-platform/shared-types";
import type { ParsedContent } from "../agents/content-generation/rss.js";

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

const mockSource: SourceArticle = {
  title: "Snake Found in Bedroom",
  url: "https://example.com/snake-article",
  imageUrl: "https://img.com/source-hero.jpg",
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

  it("includes topic tagging rules with site topics", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("Tagging Rules");
    expect(prompt).toContain("The FIRST tag MUST be one of the site's topics");
    expect(prompt).toContain("AI, gadgets");
  });
});

describe("buildUserPrompt", () => {
  it("includes the source article title and text body", () => {
    const prompt = buildUserPrompt(mockSource, mockParsedContent);
    expect(prompt).toContain("Snake Found in Bedroom");
    expect(prompt).toContain("A snake was found in a bedroom.");
  });

  it("includes YouTube embed placeholder", () => {
    const prompt = buildUserPrompt(mockSource, mockParsedContent);
    expect(prompt).toContain("youtube.com/embed/abc");
  });

  it("includes inline image info", () => {
    const prompt = buildUserPrompt(mockSource, mockParsedContent);
    expect(prompt).toContain("https://img.com/removal.jpg");
  });

  it("prefers source imageUrl over parsed featuredImageUrl", () => {
    const prompt = buildUserPrompt(mockSource, mockParsedContent);
    expect(prompt).toContain("https://img.com/source-hero.jpg");
  });

  it("falls back to parsed featuredImageUrl when source has no image", () => {
    const noImageSource: SourceArticle = { ...mockSource, imageUrl: null };
    const prompt = buildUserPrompt(noImageSource, mockParsedContent);
    expect(prompt).toContain("https://img.com/snake.jpg");
  });
});
