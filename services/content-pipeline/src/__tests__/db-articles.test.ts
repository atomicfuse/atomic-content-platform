import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdateOne = vi.fn();
const mockBulkWrite = vi.fn();
const mockDeleteMany = vi.fn();
const mockCollection = vi.fn(() => ({
  updateOne: mockUpdateOne,
  bulkWrite: mockBulkWrite,
  deleteMany: mockDeleteMany,
}));
vi.mock("../lib/mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve({ collection: mockCollection })),
}));

describe("pipeline article DB helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upsertArticleMeta writes frontmatter to articles collection", async () => {
    const { upsertArticleMeta } = await import("../lib/db/articles.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertArticleMeta("example.com", "test", "staging/example.com", {
      title: "Test",
      status: "review",
    });
    expect(mockCollection).toHaveBeenCalledWith("articles");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com", slug: "test", branch: "staging/example.com" },
      { $set: expect.objectContaining({ title: "Test", status: "review" }) },
      { upsert: true },
    );
  });

  it("upsertArticlesBatch bulk-writes multiple articles", async () => {
    const { upsertArticlesBatch } = await import("../lib/db/articles.js");
    mockBulkWrite.mockResolvedValueOnce({ ok: 1 });
    await upsertArticlesBatch([
      { domain: "a.com", slug: "s1", branch: "staging/a.com", frontmatter: { title: "A" } },
      { domain: "a.com", slug: "s2", branch: "staging/a.com", frontmatter: { title: "B" } },
    ]);
    expect(mockBulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { domain: "a.com", slug: "s1", branch: "staging/a.com" },
          }),
        }),
      ]),
    );
  });

  it("swallows errors without throwing", async () => {
    const { upsertArticleMeta } = await import("../lib/db/articles.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("connection lost"));
    // Should not throw
    await upsertArticleMeta("x.com", "y", "main", { title: "Z" });
  });
});
