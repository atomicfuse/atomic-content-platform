import { describe, it, expect, vi, beforeEach } from "vitest";
import { COLLECTIONS } from "../stats/types.js";

describe("COLLECTIONS", () => {
  it("includes weekly_summaries and review_counts", () => {
    expect(COLLECTIONS.weeklySummaries).toBe("weekly_summaries");
    expect(COLLECTIONS.reviewCounts).toBe("review_counts");
  });
});
