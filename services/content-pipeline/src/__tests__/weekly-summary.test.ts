import { describe, it, expect, vi, beforeEach } from "vitest";
import { COLLECTIONS } from "../stats/types.js";
import {
  getDayIndexAndWeekOf,
  updateWeeklySummary,
  getWeeklySummary,
} from "../stats/weekly-summary.js";

// MongoDB mocks — single setup used by all describe blocks
const mockUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
const mockFindOne = vi.fn().mockResolvedValue(null);
const mockToArray = vi.fn().mockResolvedValue([]);
const mockFind = vi.fn().mockReturnValue({ toArray: mockToArray });
const mockAggregateToArray = vi.fn().mockResolvedValue([]);
const mockAggregate = vi.fn().mockReturnValue({ toArray: mockAggregateToArray });
const mockCollection = vi.fn().mockReturnValue({
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
  find: mockFind,
  aggregate: mockAggregate,
});
vi.mock("../lib/mongo.js", () => ({
  getMongoDb: vi.fn().mockResolvedValue({
    collection: (...args: unknown[]) => mockCollection(...args),
  }),
}));

describe("COLLECTIONS", () => {
  it("includes weekly_summaries", () => {
    expect(COLLECTIONS.weeklySummaries).toBe("weekly_summaries");
  });

  it("does not include reviewCounts (removed)", () => {
    expect("reviewCounts" in COLLECTIONS).toBe(false);
  });
});

describe("getDayIndexAndWeekOf", () => {
  it("returns dayIndex=0 and the same date for a Sunday", () => {
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-14T12:00:00Z"));
    expect(result.dayIndex).toBe(0);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=1 and walks back to Sunday for a Monday", () => {
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.dayIndex).toBe(1);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=6 and walks back to Sunday for a Saturday", () => {
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-20T12:00:00Z"));
    expect(result.dayIndex).toBe(6);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles EST timezone correctly near midnight UTC", () => {
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-16T03:00:00Z"));
    expect(result.dayIndex).toBe(1);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles week boundary: early Sunday UTC is still Saturday EST", () => {
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-14T02:00:00Z"));
    expect(result.dayIndex).toBe(6);
    expect(result.weekOf).toBe("2026-06-07");
  });
});

describe("updateWeeklySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds $set with correct day index for triggered, skipped, and missing sites", async () => {
    await updateWeeklySummary({
      allSiteDomains: ["site-a", "site-b", "site-c"],
      siteResults: [{ domain: "site-a", articlesRequested: 2, articlesCreated: 2 }],
      skipped: [{ domain: "site-b", reason: "not a preferred day" }],
      timezone: "UTC",
      now: new Date("2026-06-15T12:00:00Z"),
    });

    expect(mockCollection).toHaveBeenCalledWith("weekly_summaries");
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);

    const [filter, update, options] = mockUpdateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: "2026-06-14" });
    expect(options).toEqual({ upsert: true });

    const $set = update.$set;
    expect($set["sites.site-a.1"]).toEqual({ expected: 2, created: 2 });
    expect($set["sites.site-b.1"]).toEqual({ expected: 0, created: 0 });
    expect($set["sites.site-c.1"]).toEqual({ expected: 0, created: 0 });
    expect($set.updatedAt).toBeInstanceOf(Date);
  });

  it("does not throw on MongoDB error (failure-isolated)", async () => {
    mockUpdateOne.mockRejectedValueOnce(new Error("Mongo down"));
    await expect(
      updateWeeklySummary({
        allSiteDomains: ["site-a"],
        siteResults: [{ domain: "site-a", articlesRequested: 1, articlesCreated: 1 }],
        skipped: [],
        timezone: "UTC",
        now: new Date("2026-06-15T12:00:00Z"),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("getWeeklySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sites from weekly_summaries with review counts from articles aggregation", async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: "2026-06-14",
      sites: {
        "site-a": [
          { expected: 0, created: 0 },
          { expected: 2, created: 2 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
          { expected: 0, created: 0 },
        ],
      },
      updatedAt: new Date(),
    });
    // articles aggregation returns review counts grouped by domain
    mockAggregateToArray.mockResolvedValueOnce([{ _id: "site-a", count: 3 }]);

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.weekOf).toBe("2026-06-14");
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]!.domain).toBe("site-a");
    expect(result.sites[0]!.needReview).toBe(3);
    expect(result.sites[0]!.days[1]).toEqual({ expected: 2, created: 2 });

    // Verify it queries the articles collection with aggregation
    expect(mockCollection).toHaveBeenCalledWith("articles");
    expect(mockAggregate).toHaveBeenCalledWith([
      { $match: { status: "review", branch: { $regex: /^staging\// } } },
      { $group: { _id: "$domain", count: { $sum: 1 } } },
    ]);
  });

  it("returns empty sites array when no document exists", async () => {
    mockFindOne.mockResolvedValueOnce(null);
    mockAggregateToArray.mockResolvedValueOnce([]);

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.sites).toEqual([]);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("floors negative review counts to 0", async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: "2026-06-14",
      sites: { "site-a": Array(7).fill({ expected: 0, created: 0 }) },
    });
    // Aggregation won't produce negative counts in practice, but test
    // the floor behavior for robustness
    mockAggregateToArray.mockResolvedValueOnce([{ _id: "site-a", count: -2 }]);

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.sites[0]!.needReview).toBe(0);
  });

  it("sorts sites alphabetically", async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: "2026-06-14",
      sites: {
        "zebra": Array(7).fill({ expected: 0, created: 0 }),
        "alpha": Array(7).fill({ expected: 0, created: 0 }),
        "mike": Array(7).fill({ expected: 0, created: 0 }),
      },
    });
    mockAggregateToArray.mockResolvedValueOnce([]);

    const result = await getWeeklySummary("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.sites.map((s) => s.domain)).toEqual(["alpha", "mike", "zebra"]);
  });
});
