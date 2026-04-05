import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildQueryParams,
  filterByRelevance,
  type AggregatorArticle,
} from "../agents/content-generation/aggregator.js";
import type { SiteBrief } from "@atomic-platform/shared-types";

const baseBrief: SiteBrief = {
  audience: "Tech readers",
  tone: "Conversational",
  article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
  topics: ["AI", "gadgets", "streaming"],
  seo_keywords_focus: ["tech news"],
  content_guidelines: ["Be clear"],
  review_percentage: 5,
  schedule: { articles_per_week: 3, preferred_days: ["Monday"], preferred_time: "10:00" },
  vertical: "Tech",
  audience_type: "Adult 25-44",
  language: "EN",
};

describe("buildQueryParams", () => {
  it("maps brief fields to API params", () => {
    const params = buildQueryParams(baseBrief);

    expect(params.vertical).toBe("Tech");
    expect(params.audience_type).toBe("Adult 25-44");
    expect(params.language).toBe("EN");
    expect(params.limit).toBe(3);
    expect(params.source_quality).toBe("High");
    expect(params.freshness).toBe("This week");
    // listicle is highest weight → "Listicle"
    expect(params.content_format).toBe("Listicle");
  });

  it("defaults language to EN when not set", () => {
    const brief = { ...baseBrief, language: undefined };
    const params = buildQueryParams(brief);
    expect(params.language).toBe("EN");
  });

  it("uses Today freshness for news-related topics", () => {
    const brief = { ...baseBrief, topics: ["breaking news", "politics"] };
    const params = buildQueryParams(brief);
    expect(params.freshness).toBe("Today");
  });

  it("respects custom limit parameter", () => {
    const params = buildQueryParams(baseBrief, 10);
    expect(params.limit).toBe(10);
  });

  it("omits vertical and audience_type when not set in brief", () => {
    const brief = { ...baseBrief, vertical: undefined, audience_type: undefined };
    const params = buildQueryParams(brief);
    expect(params.vertical).toBeUndefined();
    expect(params.audience_type).toBeUndefined();
  });
});

describe("filterByRelevance", () => {
  const articles: AggregatorArticle[] = [
    {
      url: "https://example.com/1",
      title: "New AI breakthrough in machine learning",
      source: "test",
      image_url: null,
      published_date: "2026-03-30T10:00:00Z",
      vertical: "Tech",
      audience_type: "Adult 25-44",
      content_format: "Opinion",
      language: "EN",
      freshness: "This week",
      source_quality: "High",
    },
    {
      url: "https://example.com/2",
      title: "Best streaming devices for 2026",
      source: "test",
      image_url: null,
      published_date: "2026-03-29T10:00:00Z",
      vertical: "Tech",
      audience_type: "Adult 25-44",
      content_format: "Listicle",
      language: "EN",
      freshness: "This week",
      source_quality: "High",
    },
    {
      url: "https://example.com/3",
      title: "Celebrity chef opens new restaurant",
      source: "test",
      image_url: null,
      published_date: "2026-03-28T10:00:00Z",
      vertical: "Lifestyle",
      audience_type: "Adult 25-44",
      content_format: "Opinion",
      language: "EN",
      freshness: "This week",
      source_quality: "Medium",
    },
  ];

  it("ranks articles by topic keyword matches", () => {
    const result = filterByRelevance(articles, ["AI", "streaming"]);

    // Both AI and streaming articles match, celebrity does not
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe("https://example.com/1");
    expect(result[1]!.url).toBe("https://example.com/2");
  });

  it("returns all articles when no topics match", () => {
    const result = filterByRelevance(articles, ["quantum computing"]);
    expect(result).toHaveLength(3); // No matches → return all
  });

  it("returns all articles when topics array is empty", () => {
    const result = filterByRelevance(articles, []);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when input is empty", () => {
    const result = filterByRelevance([], ["AI"]);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const result = filterByRelevance(articles, ["ai"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe("https://example.com/1");
  });
});
