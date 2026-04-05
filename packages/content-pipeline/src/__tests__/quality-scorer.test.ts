import { describe, it, expect, vi } from "vitest";
import {
  buildQualityScoringPrompt,
  resolveStatus,
  resolveWeights,
  calculateWeightedScore,
  DEFAULT_QUALITY_WEIGHTS,
  scoreArticle,
  type ArticleToScore,
} from "../agents/content-quality/scorer.js";
import type { SiteBrief, QualityScoreBreakdown } from "@atomic-platform/shared-types";

// Mock AI module
vi.mock("../lib/ai.js", () => ({
  generateContent: vi.fn().mockResolvedValue(
    JSON.stringify({
      seo_quality: 85,
      tone_match: 90,
      content_length: 75,
      factual_accuracy: 80,
      keyword_relevance: 70,
      note: "Good article with strong tone match.",
    }),
  ),
}));

const mockBrief: SiteBrief = {
  audience: "Tech readers",
  tone: "Conversational",
  article_types: { standard: 100 },
  topics: ["AI", "gadgets"],
  seo_keywords_focus: ["tech news"],
  content_guidelines: ["Be clear", "Use examples"],
  review_percentage: 0,
  schedule: { articles_per_week: 3, preferred_days: [], preferred_time: "10:00" },
  vertical: "Tech",
  audience_type: "Adult 25-44",
  language: "EN",
};

const mockArticle: ArticleToScore = {
  title: "Test Article About AI",
  description: "A great article about artificial intelligence.",
  body: "This is the body of the article. ".repeat(50),
  tags: ["AI", "tech"],
  type: "standard",
};

describe("buildQualityScoringPrompt", () => {
  it("includes site context in system prompt", () => {
    const { systemPrompt } = buildQualityScoringPrompt(mockArticle, "CoolNews", mockBrief);
    expect(systemPrompt).toContain("CoolNews");
    expect(systemPrompt).toContain("Tech readers");
    expect(systemPrompt).toContain("Conversational");
    expect(systemPrompt).toContain("AI, gadgets");
    expect(systemPrompt).toContain("tech news");
  });

  it("includes all five scoring criteria in system prompt", () => {
    const { systemPrompt } = buildQualityScoringPrompt(mockArticle, "CoolNews", mockBrief);
    expect(systemPrompt).toContain("seo_quality");
    expect(systemPrompt).toContain("tone_match");
    expect(systemPrompt).toContain("content_length");
    expect(systemPrompt).toContain("factual_accuracy");
    expect(systemPrompt).toContain("keyword_relevance");
  });

  it("includes article data in user prompt", () => {
    const { userPrompt } = buildQualityScoringPrompt(mockArticle, "CoolNews", mockBrief);
    expect(userPrompt).toContain("Test Article About AI");
    expect(userPrompt).toContain("A great article about artificial intelligence.");
    expect(userPrompt).toContain("AI, tech");
    expect(userPrompt).toContain("Word Count:");
  });

  it("includes content guidelines", () => {
    const { systemPrompt } = buildQualityScoringPrompt(mockArticle, "CoolNews", mockBrief);
    expect(systemPrompt).toContain("Be clear; Use examples");
  });
});

describe("resolveWeights", () => {
  it("returns default weights when none provided", () => {
    const weights = resolveWeights();
    expect(weights).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("returns default weights when undefined provided", () => {
    const weights = resolveWeights(undefined);
    expect(weights).toEqual(DEFAULT_QUALITY_WEIGHTS);
  });

  it("fills in missing weights with defaults", () => {
    const weights = resolveWeights({ seo_quality: 40, tone_match: 30 });
    expect(weights.seo_quality).toBe(40);
    expect(weights.tone_match).toBe(30);
    expect(weights.content_length).toBe(20);
    expect(weights.factual_accuracy).toBe(20);
    expect(weights.keyword_relevance).toBe(20);
  });

  it("uses all provided weights", () => {
    const custom = {
      seo_quality: 30,
      tone_match: 25,
      content_length: 15,
      factual_accuracy: 20,
      keyword_relevance: 10,
    };
    const weights = resolveWeights(custom);
    expect(weights).toEqual(custom);
  });
});

describe("calculateWeightedScore", () => {
  it("calculates equal-weighted average correctly", () => {
    const breakdown: QualityScoreBreakdown = {
      seo_quality: 80,
      tone_match: 80,
      content_length: 80,
      factual_accuracy: 80,
      keyword_relevance: 80,
    };
    const score = calculateWeightedScore(breakdown, DEFAULT_QUALITY_WEIGHTS);
    expect(score).toBe(80);
  });

  it("applies different weights correctly", () => {
    const breakdown: QualityScoreBreakdown = {
      seo_quality: 100,
      tone_match: 0,
      content_length: 0,
      factual_accuracy: 0,
      keyword_relevance: 0,
    };
    const weights = {
      seo_quality: 50,
      tone_match: 10,
      content_length: 10,
      factual_accuracy: 20,
      keyword_relevance: 10,
    };
    // 100*50 / 100 = 50
    const score = calculateWeightedScore(breakdown, weights);
    expect(score).toBe(50);
  });

  it("handles all zeros", () => {
    const breakdown: QualityScoreBreakdown = {
      seo_quality: 0,
      tone_match: 0,
      content_length: 0,
      factual_accuracy: 0,
      keyword_relevance: 0,
    };
    const score = calculateWeightedScore(breakdown, DEFAULT_QUALITY_WEIGHTS);
    expect(score).toBe(0);
  });

  it("handles perfect scores", () => {
    const breakdown: QualityScoreBreakdown = {
      seo_quality: 100,
      tone_match: 100,
      content_length: 100,
      factual_accuracy: 100,
      keyword_relevance: 100,
    };
    const score = calculateWeightedScore(breakdown, DEFAULT_QUALITY_WEIGHTS);
    expect(score).toBe(100);
  });
});

describe("resolveStatus", () => {
  it("returns published when score >= threshold", () => {
    expect(resolveStatus(80, 75)).toBe("published");
  });

  it("returns published when score equals threshold", () => {
    expect(resolveStatus(75, 75)).toBe("published");
  });

  it("returns review when score < threshold", () => {
    expect(resolveStatus(74, 75)).toBe("review");
  });

  it("uses default threshold of 75 when not provided", () => {
    expect(resolveStatus(75)).toBe("published");
    expect(resolveStatus(74)).toBe("review");
  });

  it("handles zero threshold (everything passes)", () => {
    expect(resolveStatus(0, 0)).toBe("published");
  });

  it("handles 100 threshold (only perfect passes)", () => {
    expect(resolveStatus(99, 100)).toBe("review");
    expect(resolveStatus(100, 100)).toBe("published");
  });
});

describe("scoreArticle", () => {
  it("returns quality result with overall score and breakdown", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockClient = {} as any;

    const result = await scoreArticle(mockClient, mockArticle, "CoolNews", mockBrief);

    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.breakdown.seo_quality).toBe(85);
    expect(result.breakdown.tone_match).toBe(90);
    expect(result.breakdown.content_length).toBe(75);
    expect(result.breakdown.factual_accuracy).toBe(80);
    expect(result.breakdown.keyword_relevance).toBe(70);
    expect(result.note).toBe("Good article with strong tone match.");
  });

  it("calculates weighted score from breakdown", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockClient = {} as any;

    const result = await scoreArticle(mockClient, mockArticle, "CoolNews", mockBrief);

    // Equal weights: (85+90+75+80+70) / 5 = 80
    expect(result.overallScore).toBe(80);
  });

  it("respects custom weights", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockClient = {} as any;
    const briefWithWeights = {
      ...mockBrief,
      quality_weights: {
        seo_quality: 50,
        tone_match: 10,
        content_length: 10,
        factual_accuracy: 20,
        keyword_relevance: 10,
      },
    };

    const result = await scoreArticle(
      mockClient,
      mockArticle,
      "CoolNews",
      briefWithWeights,
      briefWithWeights.quality_weights,
    );

    // (85*50 + 90*10 + 75*10 + 80*20 + 70*10) / 100
    // = (4250 + 900 + 750 + 1600 + 700) / 100 = 82
    expect(result.overallScore).toBe(82);
  });
});
