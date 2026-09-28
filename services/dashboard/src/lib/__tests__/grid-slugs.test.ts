import { describe, expect, it } from "vitest";
import { resolveTopicSlugs, slugifyTopic } from "../grid-slugs";

describe("slugifyTopic (mirror of site-worker normalize.ts)", () => {
  it("turns & into 'and'", () => {
    expect(slugifyTopic("Food & Drink")).toBe("food-and-drink");
  });
  it("strips accents", () => {
    expect(slugifyTopic("Café Crème")).toBe("cafe-creme");
    expect(slugifyTopic("Ñandú  Über")).toBe("nandu-uber");
  });
  it("trims leading/trailing separators", () => {
    expect(slugifyTopic("  --Travel!!  ")).toBe("travel");
  });
});

describe("resolveTopicSlugs (mirror of site-worker normalizeTopics)", () => {
  it("slugifies an explicit slug instead of the label", () => {
    expect(resolveTopicSlugs([{ label: "Eats", slug: "Food & Drink" }])).toEqual([{ label: "Eats", slug: "food-and-drink" }]);
  });
  it("suffixes duplicates -2, -3 …", () => {
    expect(resolveTopicSlugs([{ label: "Travel" }, { label: "travel" }, { label: "TRAVEL" }]).map((t) => t.slug)).toEqual(["travel", "travel-2", "travel-3"]);
  });
  it("skips label-less topics and falls back to 'topic' for unsluggable labels", () => {
    expect(resolveTopicSlugs([{ label: "  " }, { label: "!!!" }, { label: "Tech", slug: "  " }])).toEqual([
      { label: "!!!", slug: "topic" },
      { label: "Tech", slug: "tech" },
    ]);
  });
});
