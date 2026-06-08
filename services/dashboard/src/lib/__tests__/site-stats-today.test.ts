import { describe, it, expect } from "vitest";

/**
 * computeTodayExpected — pure function extracted for testability.
 * Returns articlesPerDay if today is a preferred day, else 0.
 */
import { computeTodayExpected } from "../site-stats";

describe("computeTodayExpected", () => {
  it("returns articlesPerDay when today is a preferred day", () => {
    // 2026-06-08 is a Monday
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, ["Monday", "Wednesday"], now)).toBe(3);
  });

  it("returns 0 when today is not a preferred day", () => {
    // 2026-06-08 is a Monday
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, ["Tuesday", "Thursday"], now)).toBe(0);
  });

  it("returns 0 when preferredDays is empty", () => {
    const now = new Date("2026-06-08T14:00:00Z");
    expect(computeTodayExpected(3, [], now)).toBe(0);
  });

  it("handles Sunday correctly", () => {
    // 2026-06-14 is a Sunday
    const now = new Date("2026-06-14T14:00:00Z");
    expect(computeTodayExpected(2, ["Sunday"], now)).toBe(2);
  });
});
