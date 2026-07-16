import { describe, it, expect } from "vitest";
import {
  parseDedupIndex,
  serializeDedupIndex,
  dedupIndexPath,
  normalizeUrl,
  normalizeTitleKey,
} from "../agents/content-generation/agent.js";

describe("dedup index — serialization", () => {
  it("parseDedupIndex returns ExistingArticles for valid JSON", () => {
    const raw = JSON.stringify({
      version: 1,
      urls: ["example.com/article-1", "other.com/post"],
      titles: ["some great article", "another post"],
    });

    const result = parseDedupIndex(raw);

    expect(result).not.toBeNull();
    expect(result!.urls.size).toBe(2);
    expect(result!.urls.has("example.com/article-1")).toBe(true);
    expect(result!.titles.size).toBe(2);
    expect(result!.titles.has("another post")).toBe(true);
  });

  it("parseDedupIndex returns null for invalid JSON", () => {
    expect(parseDedupIndex("not json")).toBeNull();
  });

  it("parseDedupIndex returns null for wrong version", () => {
    const raw = JSON.stringify({ version: 99, urls: [], titles: [] });
    expect(parseDedupIndex(raw)).toBeNull();
  });

  it("parseDedupIndex returns null for missing arrays", () => {
    const raw = JSON.stringify({ version: 1, urls: "not-array", titles: [] });
    expect(parseDedupIndex(raw)).toBeNull();
  });

  it("serializeDedupIndex round-trips through parseDedupIndex", () => {
    const original = {
      urls: new Set(["example.com/a", "other.com/b"]),
      titles: new Set(["first title", "second title"]),
      ids: new Set(["agg-item-1", "agg-item-2"]),
    };

    const serialized = serializeDedupIndex(original);
    const restored = parseDedupIndex(serialized);

    expect(restored).not.toBeNull();
    expect(restored!.urls).toEqual(original.urls);
    expect(restored!.titles).toEqual(original.titles);
    expect(restored!.ids).toEqual(original.ids);
  });

  it("serializes as version 2 with an ids array", () => {
    const serialized = serializeDedupIndex({
      urls: new Set(["example.com/a"]),
      titles: new Set(["a title"]),
      ids: new Set(["agg-1"]),
    });
    const data = JSON.parse(serialized) as { version: number; ids: string[] };
    expect(data.version).toBe(2);
    expect(data.ids).toEqual(["agg-1"]);
  });

  it("parses a legacy v1 index (no ids) with an empty ids set — back-compat", () => {
    const raw = JSON.stringify({
      version: 1,
      urls: ["example.com/article-1"],
      titles: ["some great article"],
    });

    const result = parseDedupIndex(raw);

    expect(result).not.toBeNull();
    expect(result!.urls.size).toBe(1);
    expect(result!.ids.size).toBe(0);
  });

  it("parses a v2 index with ids", () => {
    const raw = JSON.stringify({
      version: 2,
      urls: ["example.com/article-1"],
      titles: ["some great article"],
      ids: ["agg-item-9"],
    });

    const result = parseDedupIndex(raw);

    expect(result).not.toBeNull();
    expect(result!.ids.has("agg-item-9")).toBe(true);
  });
});

describe("dedupIndexPath", () => {
  it("constructs path under the site directory", () => {
    expect(dedupIndexPath("coolnews.dev")).toBe("sites/coolnews.dev/dedup-index.json");
  });
});

describe("normalizeUrl", () => {
  it("strips www prefix and trailing slash", () => {
    expect(normalizeUrl("https://www.example.com/article/")).toBe("example.com/article");
  });

  it("lowercases host and path", () => {
    expect(normalizeUrl("https://Example.COM/Article-One")).toBe("example.com/article-one");
  });

  it("handles invalid URLs gracefully", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("normalizeTitleKey", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitleKey("Hello, World! (2026)")).toBe("hello world 2026");
  });

  it("collapses whitespace", () => {
    expect(normalizeTitleKey("  multiple   spaces  here  ")).toBe("multiple spaces here");
  });
});
