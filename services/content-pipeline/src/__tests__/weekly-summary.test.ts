import { describe, it, expect, vi, beforeEach } from "vitest";
import { COLLECTIONS } from "../stats/types.js";
import { getDayIndexAndWeekOf } from "../stats/weekly-summary.js";

describe("COLLECTIONS", () => {
  it("includes weekly_summaries and review_counts", () => {
    expect(COLLECTIONS.weeklySummaries).toBe("weekly_summaries");
    expect(COLLECTIONS.reviewCounts).toBe("review_counts");
  });
});

describe("getDayIndexAndWeekOf", () => {
  it("returns dayIndex=0 and the same date for a Sunday", () => {
    // 2026-06-14 is a Sunday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-14T12:00:00Z"));
    expect(result.dayIndex).toBe(0);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=1 and walks back to Sunday for a Monday", () => {
    // 2026-06-15 is a Monday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-15T12:00:00Z"));
    expect(result.dayIndex).toBe(1);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("returns dayIndex=6 and walks back to Sunday for a Saturday", () => {
    // 2026-06-20 is a Saturday
    const result = getDayIndexAndWeekOf("UTC", new Date("2026-06-20T12:00:00Z"));
    expect(result.dayIndex).toBe(6);
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles EST timezone correctly near midnight UTC", () => {
    // 2026-06-16T03:00:00Z = Mon Jun 15 at 11 PM EST (still Monday EST)
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-16T03:00:00Z"));
    expect(result.dayIndex).toBe(1); // Monday in EST
    expect(result.weekOf).toBe("2026-06-14");
  });

  it("handles week boundary: early Sunday UTC is still Saturday EST", () => {
    // 2026-06-14T02:00:00Z = Sat Jun 13 at 10 PM EST (still Saturday)
    const result = getDayIndexAndWeekOf("EST", new Date("2026-06-14T02:00:00Z"));
    expect(result.dayIndex).toBe(6); // Saturday in EST
    expect(result.weekOf).toBe("2026-06-07"); // previous week's Sunday
  });
});
