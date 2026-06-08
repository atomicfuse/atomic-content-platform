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

describe("buildScheduleFromBrief — legacy model (brief.schedule)", () => {
  it("uses articles_per_day when present", () => {
    const result = buildScheduleFromBrief({
      schedule: {
        articles_per_day: 3,
        preferred_days: ["Monday", "Wednesday"],
      },
    });
    expect(result).toEqual({
      articlesPerDay: 3,
      preferredDays: ["Monday", "Wednesday"],
      weeklyTarget: 6,
    });
  });

  it("falls back to ceil(articles_per_week / days)", () => {
    const result = buildScheduleFromBrief({
      schedule: {
        articles_per_week: 5,
        preferred_days: ["Monday", "Wednesday", "Friday"],
      },
    });
    expect(result?.articlesPerDay).toBe(2);
    expect(result?.weeklyTarget).toBe(6);
  });

  it("returns null for null/undefined input", () => {
    expect(buildScheduleFromBrief(null)).toBeNull();
    expect(buildScheduleFromBrief(undefined)).toBeNull();
  });

  it("handles missing preferred_days in schedule", () => {
    const result = buildScheduleFromBrief({
      schedule: { articles_per_day: 2 },
    });
    expect(result).toEqual({
      articlesPerDay: 2,
      preferredDays: [],
      weeklyTarget: 0,
    });
  });

  it("returns null when brief has no schedule", () => {
    expect(buildScheduleFromBrief({})).toBeNull();
  });
});

describe("buildScheduleFromBrief — per-topic model (topics_v2)", () => {
  it("aggregates per-topic schedules", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 2, preferred_days: ["Monday"] } },
        { schedule: { articles_per_week: 3, preferred_days: ["Wednesday"] } },
      ],
      // site-level schedule is vestigial and should be ignored
      schedule: { articles_per_day: 99, preferred_days: ["Sunday"] },
    });
    expect(result).toEqual({
      articlesPerDay: 3, // ceil(5 / 2)
      preferredDays: ["Monday", "Wednesday"],
      weeklyTarget: 5,
    });
  });

  it("deduplicates preferred days across topics", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 2, preferred_days: ["Monday", "Wednesday"] } },
        { schedule: { articles_per_week: 2, preferred_days: ["Wednesday", "Thursday"] } },
      ],
    });
    // Union: Monday, Wednesday, Thursday — 3 unique days
    // Total weekly: 4
    // Per day: ceil(4/3) = 2
    expect(result?.preferredDays).toEqual(["Monday", "Wednesday", "Thursday"]);
    expect(result?.weeklyTarget).toBe(4);
    expect(result?.articlesPerDay).toBe(2);
  });

  it("sorts preferred days by weekday order", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 1, preferred_days: ["Friday"] } },
        { schedule: { articles_per_week: 1, preferred_days: ["Monday"] } },
        { schedule: { articles_per_week: 1, preferred_days: ["Wednesday"] } },
      ],
    });
    expect(result?.preferredDays).toEqual(["Monday", "Wednesday", "Friday"]);
  });

  it("returns null for empty topics_v2 array (falls through to legacy)", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [],
      schedule: { articles_per_day: 2, preferred_days: ["Monday"] },
    });
    // Empty topics_v2 → falls through to legacy schedule
    expect(result?.articlesPerDay).toBe(2);
  });

  it("returns null when all topics have zero articles_per_week", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 0, preferred_days: ["Monday"] } },
      ],
    });
    expect(result).toBeNull();
  });

  it("handles real-world aliensrus-like config", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { name: "Unexplained Events", schedule: { articles_per_week: 2, preferred_days: ["Wednesday"] } },
        { name: "Ancient Mysteries", schedule: { articles_per_week: 2, preferred_days: ["Thursday"] } },
        { name: "Conspiracy Theories", schedule: { articles_per_week: 2, preferred_days: ["Tuesday"] } },
        { name: "Strange Phenomena", schedule: { articles_per_week: 2, preferred_days: ["Thursday"] } },
      ],
      schedule: { articles_per_day: 1, preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday"] },
    });
    // Total weekly: 2+2+2+2 = 8
    // Unique days: Tuesday, Wednesday, Thursday — 3 days
    // Per day: ceil(8/3) = 3
    expect(result?.weeklyTarget).toBe(8);
    expect(result?.preferredDays).toEqual(["Tuesday", "Wednesday", "Thursday"]);
    expect(result?.articlesPerDay).toBe(3);
  });
});
