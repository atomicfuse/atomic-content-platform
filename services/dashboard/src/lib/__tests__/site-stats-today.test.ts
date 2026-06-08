import { describe, it, expect } from "vitest";

import { computeTodayExpected, buildScheduleFromBrief } from "../site-stats";

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

describe("buildScheduleFromBrief", () => {
  it("uses articles_per_day when present", () => {
    const result = buildScheduleFromBrief({
      articles_per_day: 3,
      preferred_days: ["Monday", "Wednesday"],
    });
    expect(result).toEqual({
      articlesPerDay: 3,
      preferredDays: ["Monday", "Wednesday"],
      weeklyTarget: 6,
    });
  });

  it("falls back to ceil(articles_per_week / days)", () => {
    const result = buildScheduleFromBrief({
      articles_per_week: 5,
      preferred_days: ["Monday", "Wednesday", "Friday"],
    });
    expect(result?.articlesPerDay).toBe(2);
    expect(result?.weeklyTarget).toBe(6);
  });

  it("returns null for null/undefined input", () => {
    expect(buildScheduleFromBrief(null)).toBeNull();
    expect(buildScheduleFromBrief(undefined)).toBeNull();
  });

  it("handles missing preferred_days", () => {
    const result = buildScheduleFromBrief({ articles_per_day: 2 });
    expect(result).toEqual({
      articlesPerDay: 2,
      preferredDays: [],
      weeklyTarget: 0,
    });
  });

  it("handles articles_per_week with no preferred_days (defaults to 7)", () => {
    const result = buildScheduleFromBrief({ articles_per_week: 14 });
    expect(result?.articlesPerDay).toBe(2);
    expect(result?.weeklyTarget).toBe(0); // 0 because preferredDays is empty
  });
});
