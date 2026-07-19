import { describe, it, expect, vi, beforeEach } from "vitest";

// Enable MongoDB reads for these tests (otherwise feature flag falls back to Git)
process.env.USE_MONGO_READS = "true";

const mockToArray = vi.fn();
const mockFindOne = vi.fn();
const mockCountDocuments = vi.fn();
const mockUpdateOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockDeleteMany = vi.fn();
const mockBulkWrite = vi.fn();
const mockAggregate = vi.fn(() => ({ toArray: mockToArray }));
const mockFind = vi.fn(() => ({
  sort: vi.fn().mockReturnThis(),
  toArray: mockToArray,
}));
const mockCollection = vi.fn(() => ({
  find: mockFind,
  findOne: mockFindOne,
  countDocuments: mockCountDocuments,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
  deleteMany: mockDeleteMany,
  bulkWrite: mockBulkWrite,
  aggregate: mockAggregate,
}));
const mockDb = { collection: mockCollection };

vi.mock("../../mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("article DB helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getArticlesMeta returns articles for a domain+branch", async () => {
    const { getArticlesMeta } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([
      { domain: "example.com", slug: "hello", branch: "staging/example.com", title: "Hello", status: "review" },
    ]);
    const result = await getArticlesMeta("example.com", "staging/example.com");
    expect(mockCollection).toHaveBeenCalledWith("articles");
    expect(mockFind).toHaveBeenCalledWith({ domain: "example.com", branch: "staging/example.com" });
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("hello");
  });

  it("getArticleMeta returns a single article or null", async () => {
    const { getArticleMeta } = await import("../articles.js");
    mockFindOne.mockResolvedValueOnce({ slug: "test", title: "Test" });
    const result = await getArticleMeta("example.com", "test", "staging/example.com");
    expect(mockFindOne).toHaveBeenCalledWith({
      domain: "example.com",
      slug: "test",
      branch: "staging/example.com",
    });
    expect(result?.title).toBe("Test");
  });

  it("countArticlesByStatus counts articles with matching status", async () => {
    const { countArticlesByStatus } = await import("../articles.js");
    mockCountDocuments.mockResolvedValueOnce(5);
    const count = await countArticlesByStatus("example.com", "staging/example.com", "review");
    expect(mockCountDocuments).toHaveBeenCalledWith({
      domain: "example.com",
      branch: "staging/example.com",
      status: "review",
    });
    expect(count).toBe(5);
  });

  it("upsertArticleMeta upserts with domain+slug+branch key", async () => {
    const { upsertArticleMeta } = await import("../articles.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertArticleMeta("example.com", "test-slug", "staging/example.com", {
      title: "Test",
      status: "review",
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com", slug: "test-slug", branch: "staging/example.com" },
      { $set: expect.objectContaining({ title: "Test", status: "review", updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("deleteArticleMeta deletes by domain+slug+branch", async () => {
    const { deleteArticleMeta } = await import("../articles.js");
    mockDeleteOne.mockResolvedValueOnce({ acknowledged: true });
    await deleteArticleMeta("example.com", "test-slug", "staging/example.com");
    expect(mockDeleteOne).toHaveBeenCalledWith({
      domain: "example.com",
      slug: "test-slug",
      branch: "staging/example.com",
    });
  });

  it("deleteArticlesForSite deletes all articles for a domain", async () => {
    const { deleteArticlesForSite } = await import("../articles.js");
    mockDeleteMany.mockResolvedValueOnce({ acknowledged: true, deletedCount: 10 });
    await deleteArticlesForSite("example.com");
    expect(mockDeleteMany).toHaveBeenCalledWith({ domain: "example.com" });
  });
});

// Auto-publish re-keys article docs from the staging branch to "main" and
// deletes the staging copies (scheduler-flow autoPublishSite), so reads must
// treat a site's articles as the union of both branches, deduped by slug.
describe("dual-branch article reads (staging ∪ main)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("countArticlesForSites matches staging+main per site and counts distinct slugs", async () => {
    const { countArticlesForSites } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([{ _id: "wineoceans", count: 42 }]);
    const counts = await countArticlesForSites([
      { domain: "wineoceans", staging_branch: "staging/wineoceans" },
      { domain: "wpsite", staging_branch: null },
    ]);
    expect(mockAggregate).toHaveBeenCalledWith([
      {
        $match: {
          slug: { $not: /^\./ },
          $or: [
            { domain: "wineoceans", branch: { $in: ["staging/wineoceans", "main"] } },
            { domain: "wpsite", branch: { $in: ["main"] } },
          ],
        },
      },
      { $group: { _id: "$domain", slugs: { $addToSet: "$slug" } } },
      { $project: { count: { $size: "$slugs" } } },
    ]);
    expect(counts).toEqual({ wineoceans: 42 });
  });

  it("countArticlesForSites returns {} for empty input without querying", async () => {
    const { countArticlesForSites } = await import("../articles.js");
    const counts = await countArticlesForSites([]);
    expect(counts).toEqual({});
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("readArticlesFromDb with a staging branch unions main and prefers the staging doc per slug", async () => {
    const { readArticlesFromDb } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([
      { domain: "wineoceans", slug: "a", branch: "main", title: "A main" },
      { domain: "wineoceans", slug: "a", branch: "staging/wineoceans", title: "A staging" },
      { domain: "wineoceans", slug: "b", branch: "main", title: "B main" },
    ]);
    const result = await readArticlesFromDb("wineoceans", "staging/wineoceans");
    expect(mockFind).toHaveBeenCalledWith({
      domain: "wineoceans",
      branch: { $in: ["staging/wineoceans", "main"] },
      slug: { $not: /^\./ },
    });
    expect(result.map((r) => r.slug)).toEqual(["a", "b"]);
    expect(result[0].title).toBe("A staging");
    expect(result[1].title).toBe("B main");
  });

  it("readArticlesFromDb without a branch reads main only", async () => {
    const { readArticlesFromDb } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([]);
    await readArticlesFromDb("wineoceans");
    expect(mockFind).toHaveBeenCalledWith({
      domain: "wineoceans",
      branch: "main",
      slug: { $not: /^\./ },
    });
  });

  // Legacy auto-publish runs upserted placeholder files (articles/.gitkeep)
  // into Mongo as articles with dot-prefixed slugs — reads must exclude them.
  it("readArticlesFromDb excludes dot-prefixed slugs in the query", async () => {
    const { readArticlesFromDb } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([]);
    await readArticlesFromDb("wineoceans", "staging/wineoceans");
    expect(mockFind).toHaveBeenCalledWith({
      domain: "wineoceans",
      branch: { $in: ["staging/wineoceans", "main"] },
      slug: { $not: /^\./ },
    });
  });

  it("countArticlesForSites excludes dot-prefixed slugs in the match stage", async () => {
    const { countArticlesForSites } = await import("../articles.js");
    mockToArray.mockResolvedValueOnce([]);
    await countArticlesForSites([{ domain: "wineoceans", staging_branch: "staging/wineoceans" }]);
    expect(mockAggregate).toHaveBeenCalledWith([
      {
        $match: {
          slug: { $not: /^\./ },
          $or: [{ domain: "wineoceans", branch: { $in: ["staging/wineoceans", "main"] } }],
        },
      },
      { $group: { _id: "$domain", slugs: { $addToSet: "$slug" } } },
      { $project: { count: { $size: "$slugs" } } },
    ]);
  });
});
