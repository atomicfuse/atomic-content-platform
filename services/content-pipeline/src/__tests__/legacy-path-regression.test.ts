import { describe, it, expect } from "vitest";
import { isPerTopicSite } from "../agents/content-generation/per-topic-fetch.js";
import type { SiteBrief } from "../types.js";

describe("legacy-path regression — a site without topics_v2 must use the legacy path", () => {
  function legacyBrief(overrides: Partial<SiteBrief> = {}): SiteBrief {
    return {
      audience: "General",
      tone: "informative",
      article_types: { standard: 100 },
      topics: ["Foo"],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: ["Monday"], preferred_time: "10:00" },
      bundle_ids: ["b1", "b2"],
      vertical: "Travel",
      vertical_id: "v1",
      ...overrides,
    } as SiteBrief;
  }

  it("isPerTopicSite is false for a brief with bundle_ids but no topics_v2", () => {
    expect(isPerTopicSite(legacyBrief())).toBe(false);
  });

  it("isPerTopicSite is false for a brief with neither bundle_ids nor topics_v2", () => {
    expect(isPerTopicSite(legacyBrief({ bundle_ids: undefined }))).toBe(false);
  });

  it("isPerTopicSite is false for a brief with bundle_ids AND empty topics_v2 array", () => {
    expect(isPerTopicSite(legacyBrief({ topics_v2: [] }))).toBe(false);
  });

  it("isPerTopicSite is true ONLY when topics_v2 has at least one element", () => {
    const brief = legacyBrief({
      bundle_ids: undefined,
      topics_v2: [
        {
          name: "X",
          source: { type: "filter", category_ids: ["c1"], tag_ids: [] },
          schedule: { articles_per_week: 1, preferred_days: ["Monday"] },
        },
      ],
    });
    expect(isPerTopicSite(brief)).toBe(true);
  });
});
