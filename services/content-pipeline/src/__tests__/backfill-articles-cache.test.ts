import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../lib/github.js", () => ({
  createOctokit: vi.fn(),
  clearTreeCache: vi.fn(() => { calls.push("clear"); }),
  listFiles: vi.fn(async (_o: unknown, _r: string, _p: string, branch: string) => { calls.push(`list:${branch}`); return ["new-slug.md"]; }),
  readFile: vi.fn(async () => "---\ntitle: T\n---\nbody"),
}));

describe("backfillArticles", () => {
  it("clears the (never-expiring) tree cache BEFORE listing a site, so a rename isn't read from a stale tree", async () => {
    const { backfillArticles } = await import("../scripts/backfill-mongo.js");
    const coll = { bulkWrite: vi.fn(), deleteMany: vi.fn(async () => ({ deletedCount: 1 })) };
    const db = { collection: () => coll } as never;
    const summary = { articlesBackfilled: 0, sitesProcessed: 0, errors: [] } as never;
    await backfillArticles(db, {} as never, "o/r", [{ domain: "scoopella", branch: "staging/scoopella" } as never], summary);
    expect(calls.indexOf("clear")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("clear")).toBeLessThan(calls.indexOf("list:staging/scoopella"));
    expect(coll.deleteMany).toHaveBeenCalledWith({ domain: "scoopella", branch: "main", slug: { $nin: ["new-slug"] } });
  });
});
