import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../agents/content-generation/api-client.js", () => ({
  getContent: vi.fn(),
  getSettings: vi.fn(),
  resolveTopicTagIds: vi.fn(),
}));

import { getContent } from "../agents/content-generation/api-client.js";
import {
  fetchNewItemsForBundle,
  fetchNewItemsUnion,
  type FetchUnionDeps,
  type FetchPagination,
} from "../agents/content-generation/agent.js";
import type { ContentItem } from "../agents/content-generation/types.js";

function item(id: string, url: string, title: string): ContentItem {
  return {
    id,
    url,
    title,
    description: "",
    summary: "",
    thumbnail: null,
    content_type: "article",
    vertical: null,
    categories: [],
    tags: [],
    audience_types: [],
    source: { name: "test" },
    published_at: "2026-01-01T00:00:00Z",
    language: "EN",
  } as ContentItem;
}

const TEST_PAGINATION: FetchPagination = { maxPages: 1 };

function makeDeps(overrides: Partial<FetchUnionDeps> = {}): FetchUnionDeps {
  return {
    targetCount: 10,
    existing: { urls: new Set(), titles: new Set() },
    bundleIds: ["b1", "b2"],
    mergedCategoryIds: [],
    language: "EN",
    // Deterministic ordering for tests: rotate by 0 → original order preserved.
    bundleOrderSeed: 0,
    ...overrides,
  };
}

function makeResp(items: ContentItem[]) {
  return {
    items,
    page: 1,
    total_pages: 1,
    total_count: items.length,
    total_returned: items.length,
    page_size: 20,
  };
}

const emptyResp = makeResp([]);

describe("fetchNewItemsUnion — fan-out across multiple bundles", () => {
  beforeEach(() => vi.mocked(getContent).mockReset());

  it("queries each bundle_id once and merges disjoint results", async () => {
    // b1 first, b2 second — deterministic because fetchNewItemsUnion iterates bundleIds in order
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("1", "https://x/a", "A")]))
      .mockResolvedValueOnce(makeResp([item("2", "https://x/b", "B")]))
      .mockResolvedValue(emptyResp);

    const result = await fetchNewItemsUnion(undefined, "test", makeDeps(), TEST_PAGINATION);

    expect(result.newItems.map((i) => i.id).sort()).toEqual(["1", "2"]);
    const calls = vi.mocked(getContent).mock.calls.filter((c) => c[0] !== undefined);
    expect(calls.length).toBe(2);
    expect(calls.map((c) => c[0]!.bundle_id).sort()).toEqual(["b1", "b2"]);
  });

  it("dedupes by id when same item id appears in two bundles", async () => {
    const dup = item("X", "https://x/dup", "Dup");
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([dup, item("1", "https://x/a", "A")]))
      .mockResolvedValueOnce(makeResp([dup, item("2", "https://x/b", "B")]))
      .mockResolvedValue(emptyResp);

    const result = await fetchNewItemsUnion(undefined, "test", makeDeps(), TEST_PAGINATION);
    expect(result.newItems.map((i) => i.id).sort()).toEqual(["1", "2", "X"]);
  });

  it("dedupes by url when item ids differ but url is identical", async () => {
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("a1", "https://x/same", "Title One")]))
      .mockResolvedValueOnce(makeResp([item("a2", "https://x/same", "Title Two")]))
      .mockResolvedValue(emptyResp);

    const result = await fetchNewItemsUnion(undefined, "test", makeDeps(), TEST_PAGINATION);
    expect(result.newItems).toHaveLength(1);
  });

  it("dedupes by title when item ids differ and urls differ but title is identical", async () => {
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("a1", "https://x/one", "Same Title")]))
      .mockResolvedValueOnce(makeResp([item("a2", "https://x/two", "Same Title")]))
      .mockResolvedValue(emptyResp);

    const result = await fetchNewItemsUnion(undefined, "test", makeDeps(), TEST_PAGINATION);
    expect(result.newItems).toHaveLength(1);
  });

  it("ALWAYS queries every bundle, even when targetCount is small", async () => {
    // Regression test for the bug where with 3 bundles and articles_per_day=1,
    // only bundle 1 was ever queried (early-stop on targetCount). Now we
    // query all bundles, then round-robin merge, then trim to targetCount.
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("a1", "https://x/a1", "A1")])) // b1
      .mockResolvedValueOnce(makeResp([item("b1", "https://x/b1", "B1")])) // b2
      .mockResolvedValueOnce(makeResp([item("c1", "https://x/c1", "C1")])) // b3
      .mockResolvedValue(emptyResp);

    const deps = makeDeps({
      bundleIds: ["b1", "b2", "b3"],
      targetCount: 1, // small target — would have stopped at b1 in the old code
    });
    const result = await fetchNewItemsUnion(undefined, "test", deps, TEST_PAGINATION);

    // Result is trimmed to targetCount=1, but ALL 3 bundles were queried.
    expect(result.newItems).toHaveLength(1);
    const calls = vi.mocked(getContent).mock.calls.filter((c) => c[0] !== undefined);
    const bundleIds = calls.map((c) => c[0]!.bundle_id).sort();
    expect(bundleIds).toEqual(["b1", "b2", "b3"]);
  });

  it("round-robin merges items across bundles (item 0 from each, then item 1 from each)", async () => {
    // b1 returns 2 items, b2 returns 2 items. Target is 4. Expected order
    // (with bundleOrderSeed=0): b1[0], b2[0], b1[1], b2[1].
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([
        item("a1", "https://x/a1", "A1"),
        item("a2", "https://x/a2", "A2"),
      ])) // b1
      .mockResolvedValueOnce(makeResp([
        item("b1", "https://x/b1", "B1"),
        item("b2", "https://x/b2", "B2"),
      ])) // b2
      .mockResolvedValue(emptyResp);

    const deps = makeDeps({ bundleIds: ["b1", "b2"], targetCount: 4 });
    const result = await fetchNewItemsUnion(undefined, "test", deps, TEST_PAGINATION);
    expect(result.newItems.map((i) => i.id)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("rotates the bundle order by bundleOrderSeed for fair first-slot coverage", async () => {
    // With seed=1 and bundleIds=["b1","b2","b3"], rotated order is ["b2","b3","b1"].
    // The first item to be selected is therefore from b2.
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("from-b2", "https://x/b2", "B2")])) // first call: b2
      .mockResolvedValueOnce(makeResp([item("from-b3", "https://x/b3", "B3")])) // second call: b3
      .mockResolvedValueOnce(makeResp([item("from-b1", "https://x/b1", "B1")])) // third call: b1
      .mockResolvedValue(emptyResp);

    const deps = makeDeps({
      bundleIds: ["b1", "b2", "b3"],
      bundleOrderSeed: 1,
      targetCount: 1,
    });
    const result = await fetchNewItemsUnion(undefined, "test", deps, TEST_PAGINATION);
    expect(result.newItems[0]!.id).toBe("from-b2");
  });

  it("filters out items already present in existing.urls", async () => {
    // normalizeUrl("https://x/known") => "x/known"
    vi.mocked(getContent)
      .mockResolvedValueOnce(makeResp([item("1", "https://x/known", "A"), item("2", "https://x/new", "B")]))
      .mockResolvedValue(emptyResp);

    const deps = makeDeps({
      bundleIds: ["b1"],
      existing: { urls: new Set(["x/known"]), titles: new Set() },
    });
    const result = await fetchNewItemsUnion(undefined, "test", deps, TEST_PAGINATION);
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0]!.id).toBe("2");
  });

  it("does NOT send site category_ids/tag_ids when bundle_id is set (avoids AND-intersection)", async () => {
    // Regression test for the bug where travelnights (vertical=Travel) subscribed
    // to a wine-content bundle (rules=[Food/Alcoholic-Beverages]) got zero results
    // because the aggregator intersected bundle rules AND site categories.
    vi.mocked(getContent).mockResolvedValue(makeResp([item("1", "https://x/a", "A")]));

    const deps = makeDeps({
      bundleIds: ["wine-bundle"],
      mergedCategoryIds: ["travel-tier1-id"], // site says Travel
    });
    await fetchNewItemsUnion(["travel-tag"], "narrow", deps, TEST_PAGINATION);

    const calls = vi.mocked(getContent).mock.calls.filter((c) => c[0] !== undefined);
    expect(calls.length).toBeGreaterThan(0);
    const params = calls[0]![0]!;
    expect(params.bundle_id).toBe("wine-bundle");
    // Site filters must be SUPPRESSED when a bundle is set — the bundle's
    // server-side rules are the intended filter.
    expect(params.category_ids).toBeUndefined();
    expect(params.tag_ids).toBeUndefined();
  });

  it("sends site category_ids/tag_ids on the no-bundle fallback path (bundleId=undefined)", async () => {
    vi.mocked(getContent).mockResolvedValue(makeResp([item("1", "https://x/a", "A")]));

    const deps = makeDeps({
      bundleIds: [],                         // no bundles → fan-out becomes [undefined]
      mergedCategoryIds: ["travel-tier1"],
    });
    // Bundle-less deps: fetchNewItemsUnion still iterates [undefined] (no-bundle fallback)
    const depsForNoBundle = { ...deps, bundleIds: [undefined] as (string | undefined)[] };
    await fetchNewItemsUnion(["travel-tag"], "narrow", depsForNoBundle, TEST_PAGINATION);

    const calls = vi.mocked(getContent).mock.calls.filter((c) => c[0] !== undefined);
    const params = calls[0]![0]!;
    expect(params.bundle_id).toBeUndefined();
    // No bundle → site filters apply (the original behavior).
    expect(params.category_ids).toEqual(["travel-tier1"]);
    expect(params.tag_ids).toEqual(["travel-tag"]);
  });
});
