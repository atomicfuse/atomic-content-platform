import { describe, it, expect } from "vitest";
import {
  computePerRunTarget,
  isTopicEligibleToday,
  articleMatchesTopicFilter,
  resolveArticleTopics,
  isPerTopicSite,
} from "../agents/content-generation/per-topic-fetch.js";
import type { TopicV2, SiteBrief } from "../types.js";
import type { ContentItem } from "../agents/content-generation/types.js";

function makeTopic(overrides: Partial<TopicV2> = {}): TopicV2 {
  return {
    name: "Wine & Beer",
    source: { type: "filter", category_ids: ["cat-alc"], tag_ids: ["tag-wine"] },
    schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "i1",
    url: "https://example.com/a",
    title: "An article",
    description: "",
    summary: "",
    thumbnail: null,
    content_type: "article",
    vertical: null,
    categories: [],
    tags: [],
    audience_types: [],
    source: { name: "test" },
    published_at: "2026-06-02T00:00:00Z",
    language: "EN",
    category_ids: ["cat-alc"],
    tag_ids: ["tag-wine"],
    ...overrides,
  } as ContentItem;
}

describe("computePerRunTarget", () => {
  it("returns ceil(articles_per_week / preferred_days.length)", () => {
    expect(computePerRunTarget({ articles_per_week: 3, preferred_days: ["Mon", "Wed", "Fri"] })).toBe(1);
    expect(computePerRunTarget({ articles_per_week: 2, preferred_days: ["Tue", "Thu"] })).toBe(1);
    expect(computePerRunTarget({ articles_per_week: 5, preferred_days: ["Mon", "Wed"] })).toBe(3);
  });

  it("returns 0 when articles_per_week is 0", () => {
    expect(computePerRunTarget({ articles_per_week: 0, preferred_days: ["Mon"] })).toBe(0);
  });

  it("returns 0 when preferred_days is empty", () => {
    expect(computePerRunTarget({ articles_per_week: 5, preferred_days: [] })).toBe(0);
  });
});

describe("isTopicEligibleToday", () => {
  // 2026-06-02 is a Tuesday — known fixed date for these tests
  const TUESDAY = new Date("2026-06-02T12:00:00Z");
  const WEDNESDAY = new Date("2026-06-03T12:00:00Z");

  it("returns true when today is in preferred_days", () => {
    expect(isTopicEligibleToday({ articles_per_week: 1, preferred_days: ["Tuesday"] }, TUESDAY)).toBe(true);
  });

  it("returns false when today is not in preferred_days", () => {
    expect(isTopicEligibleToday({ articles_per_week: 1, preferred_days: ["Tuesday"] }, WEDNESDAY)).toBe(false);
  });

  it("returns false when articles_per_week is 0 even on preferred day", () => {
    expect(isTopicEligibleToday({ articles_per_week: 0, preferred_days: ["Tuesday"] }, TUESDAY)).toBe(false);
  });
});

describe("articleMatchesTopicFilter", () => {
  it("matches when item categories include any topic category AND item tags include any topic tag", () => {
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: ["tag-wine", "tag-other"] });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(true);
  });

  it("does NOT match when categories overlap but tags don't (AND across)", () => {
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: ["tag-other"] });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(false);
  });

  it("does NOT match when tags overlap but categories don't", () => {
    const item = makeItem({ category_ids: ["cat-other"], tag_ids: ["tag-wine"] });
    expect(articleMatchesTopicFilter(item, makeTopic())).toBe(false);
  });

  it("ignores empty dimensions (tag_ids empty → no tag constraint)", () => {
    const topic = makeTopic({ source: { type: "filter", category_ids: ["cat-alc"], tag_ids: [] } });
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: [] });
    expect(articleMatchesTopicFilter(item, topic)).toBe(true);
  });

  it("bundle-source matches only when wasFetchedFromBundleId equals topic's bundle_id", () => {
    const topic = makeTopic({ source: { type: "bundle", bundle_id: "b1" } });
    const item = makeItem();
    expect(articleMatchesTopicFilter(item, topic, "b1")).toBe(true);
    expect(articleMatchesTopicFilter(item, topic, "b2")).toBe(false);
    expect(articleMatchesTopicFilter(item, topic)).toBe(false);
  });
});

describe("resolveArticleTopics", () => {
  it("puts the primary topic first and adds matching secondaries", () => {
    const primary = makeTopic({ name: "Wine & Beer" });
    const allTopics: TopicV2[] = [
      primary,
      {
        name: "Food around the world",
        source: { type: "filter", category_ids: ["cat-alc", "cat-dining"], tag_ids: ["tag-wine", "tag-food"] },
        schedule: { articles_per_week: 2, preferred_days: [] },
      },
      {
        name: "Tech News",
        source: { type: "filter", category_ids: ["cat-tech"], tag_ids: ["tag-ai"] },
        schedule: { articles_per_week: 1, preferred_days: [] },
      },
    ];
    const item = makeItem({ category_ids: ["cat-alc"], tag_ids: ["tag-wine"] });

    const result = resolveArticleTopics(item, primary, allTopics);
    expect(result).toEqual(["Wine & Beer", "Food around the world"]);
  });

  it("skips bundle-source topics when evaluating secondaries (can't match without round-trip)", () => {
    const primary = makeTopic({ name: "Wine & Beer" });
    const allTopics: TopicV2[] = [
      primary,
      {
        name: "Linked News",
        source: { type: "bundle", bundle_id: "b-news" },
        schedule: { articles_per_week: 1, preferred_days: [] },
      },
    ];
    const item = makeItem();
    const result = resolveArticleTopics(item, primary, allTopics);
    expect(result).toEqual(["Wine & Beer"]);
  });
});

describe("isPerTopicSite", () => {
  it("returns true when topics_v2 is a non-empty array", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [], preferred_time: "14:00" },
      topics_v2: [
        {
          name: "Wine & Beer",
          source: { type: "filter", category_ids: ["c1"], tag_ids: [] },
          schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
        },
      ],
    };
    expect(isPerTopicSite(brief)).toBe(true);
  });

  it("returns false when topics_v2 is undefined", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [], preferred_time: "14:00" },
    };
    expect(isPerTopicSite(brief)).toBe(false);
  });

  it("returns false when topics_v2 is an empty array", () => {
    const brief: SiteBrief = {
      audience: "x",
      tone: "x",
      article_types: { standard: 100 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 0,
      schedule: { articles_per_day: 1, preferred_days: [], preferred_time: "14:00" },
      topics_v2: [],
    };
    expect(isPerTopicSite(brief)).toBe(false);
  });
});
