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

describe("buildScheduleFromBrief — site-level schedule (single source of truth)", () => {
  it("uses site-level schedule for topics_v2 sites (per-topic schedules ignored)", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 2, preferred_days: ["Monday"] } },
        { schedule: { articles_per_week: 3, preferred_days: ["Wednesday"] } },
      ],
      // site-level schedule is now the single source of truth
      schedule: { articles_per_day: 99, preferred_days: ["Sunday"] },
    });
    // Per-topic schedules are ignored; only brief.schedule is used
    expect(result).toEqual({
      articlesPerDay: 99,
      preferredDays: ["Sunday"],
      weeklyTarget: 99,
    });
  });

  it("respects site-level schedule with multiple preferred days", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 2, preferred_days: ["Monday", "Wednesday"] } },
        { schedule: { articles_per_week: 2, preferred_days: ["Wednesday", "Thursday"] } },
      ],
      schedule: { articles_per_week: 4, preferred_days: ["Monday", "Wednesday", "Thursday"] },
    });
    // Site-level schedule is used; per-topic ignored
    expect(result?.preferredDays).toEqual(["Monday", "Wednesday", "Thursday"]);
    expect(result?.articlesPerDay).toBe(2); // ceil(4 / 3)
    expect(result?.weeklyTarget).toBe(6); // 2 per day * 3 days
  });

  it("uses site-level schedule order (no sorting of topics)", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 1, preferred_days: ["Friday"] } },
        { schedule: { articles_per_week: 1, preferred_days: ["Monday"] } },
        { schedule: { articles_per_week: 1, preferred_days: ["Wednesday"] } },
      ],
      schedule: { articles_per_week: 3, preferred_days: ["Friday", "Monday", "Wednesday"] },
    });
    // Site-level schedule order is preserved (per-topic sorting ignored)
    expect(result?.preferredDays).toEqual(["Friday", "Monday", "Wednesday"]);
  });

  it("uses site-level schedule when topics_v2 is empty array", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [],
      schedule: { articles_per_day: 2, preferred_days: ["Monday"] },
    });
    // Site-level schedule applies regardless of topics_v2 state
    expect(result?.articlesPerDay).toBe(2);
  });

  it("returns null when site-level schedule is absent (even with topics_v2)", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { schedule: { articles_per_week: 0, preferred_days: ["Monday"] } },
      ],
      // no schedule field
    });
    // No site-level schedule → null (per-topic model deprecated)
    expect(result).toBeNull();
  });

  it("uses site-level schedule in real-world topics_v2 config", () => {
    const result = buildScheduleFromBrief({
      topics_v2: [
        { name: "Unexplained Events", schedule: { articles_per_week: 2, preferred_days: ["Wednesday"] } },
        { name: "Ancient Mysteries", schedule: { articles_per_week: 2, preferred_days: ["Thursday"] } },
        { name: "Conspiracy Theories", schedule: { articles_per_week: 2, preferred_days: ["Tuesday"] } },
        { name: "Strange Phenomena", schedule: { articles_per_week: 2, preferred_days: ["Thursday"] } },
      ],
      // site-level schedule is the source of truth for when/how-many
      schedule: { articles_per_day: 1, preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday"] },
    });
    // Topics ignored; site-level schedule used
    expect(result?.weeklyTarget).toBe(4); // 1 per day * 4 days
    expect(result?.preferredDays).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday"]);
    expect(result?.articlesPerDay).toBe(1);
  });
});
