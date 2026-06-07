import { describe, it, expect } from "vitest";
import { buildScheduleSnapshot, computeNextRun } from "../schedule.js";

describe("buildScheduleSnapshot", () => {
  it("uses articles_per_day when present", () => {
    expect(buildScheduleSnapshot({ articles_per_day: 3, preferred_days: ["Monday","Wednesday"] } as any))
      .toEqual({ articlesPerDay: 3, preferredDays: ["Monday","Wednesday"], weeklyTarget: 6 });
  });
  it("falls back to ceil(articles_per_week / days)", () => {
    expect(buildScheduleSnapshot({ articles_per_week: 5, preferred_days: ["Mon","Wed","Fri"] } as any).articlesPerDay).toBe(2);
  });
  it("returns null for undefined schedule", () => {
    expect(buildScheduleSnapshot(undefined)).toBeNull();
  });
});

describe("computeNextRun", () => {
  it("returns null when scheduler disabled", () => {
    expect(computeNextRun({ enabled: false, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-07T00:00:00Z"))).toBeNull();
  });
  it("returns null with no preferred days or no run hours", () => {
    expect(computeNextRun({ enabled: true, run_at_hours: [], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-07T00:00:00Z"))).toBeNull();
    expect(computeNextRun({ enabled: true, run_at_hours: [14], timezone: "America/New_York" }, [], new Date("2026-06-07T00:00:00Z"))).toBeNull();
  });
  it("finds the next preferred-day at run hour (Sunday → Monday 14:00 ET)", () => {
    // 2026-06-07 is a Sunday; next Monday 14:00 America/New_York = 2026-06-08T18:00:00Z (EDT, UTC-4)
    const next = computeNextRun({ enabled: true, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-07T00:00:00Z"));
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-06-08T18:00:00.000Z");
  });
  it("returns the same-day later hour if now is before it on a preferred day", () => {
    // 2026-06-08 is Monday; now = 10:00 ET (14:00Z), run hour 14 ET → today 18:00Z
    const next = computeNextRun({ enabled: true, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-06-08T14:00:00Z"));
    expect(next!.toISOString()).toBe("2026-06-08T18:00:00.000Z");
  });
  it("handles winter EST (UTC-5): Sunday → Monday 14:00 EST", () => {
    // 2026-01-04 is a Sunday; next Monday 14:00 America/New_York = EST (UTC-5) = 2026-01-05T19:00:00Z
    const next = computeNextRun({ enabled: true, run_at_hours: [14], timezone: "America/New_York" }, ["Monday"], new Date("2026-01-04T00:00:00Z"));
    expect(next!.toISOString()).toBe("2026-01-05T19:00:00.000Z");
  });
});
