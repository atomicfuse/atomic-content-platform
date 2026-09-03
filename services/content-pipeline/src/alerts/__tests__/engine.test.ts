import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../engine.js";
import type { AlertState } from "../types.js";

const t0 = new Date("2026-06-07T09:00:00Z");
const okState = (id = "travelswire:in_review"): AlertState => ({
  _id: id,
  status: "ok",
  firstDetectedAt: null,
  lastFiredAt: null,
  lastValue: null,
});

describe("evaluateCondition", () => {
  it("transition_only fires once on ok→alerting, then stays quiet", () => {
    const r1 = evaluateCondition(okState(), { alerting: true, value: 17, policy: "transition_only" }, t0);
    expect(r1.shouldFire).toBe(true);
    expect(r1.newState.status).toBe("alerting");
    expect(r1.newState.firstDetectedAt).toEqual(t0);
    expect(r1.newState.lastFiredAt).toEqual(t0);
    const r2 = evaluateCondition(r1.newState, { alerting: true, value: 18, policy: "transition_only" }, new Date("2026-06-07T10:00:00Z"));
    expect(r2.shouldFire).toBe(false);
  });

  it("transition_only resets on recovery and can re-fire", () => {
    const a = evaluateCondition(okState(), { alerting: true, value: 16, policy: "transition_only" }, t0).newState;
    const rec = evaluateCondition(a, { alerting: false, value: 10, policy: "transition_only" }, new Date("2026-06-07T11:00:00Z"));
    expect(rec.shouldFire).toBe(false);
    expect(rec.newState.status).toBe("ok");
    const refire = evaluateCondition(rec.newState, { alerting: true, value: 20, policy: "transition_only" }, new Date("2026-06-08T09:00:00Z"));
    expect(refire.shouldFire).toBe(true);
  });

  it("transition_then_daily re-fires only after 24h", () => {
    const r1 = evaluateCondition(okState("s:sync_failed"), { alerting: true, value: 5, policy: "transition_then_daily" }, t0);
    expect(r1.shouldFire).toBe(true);
    const sameDay = evaluateCondition(r1.newState, { alerting: true, value: 6, policy: "transition_then_daily" }, new Date("2026-06-07T21:00:00Z")); // +12h
    expect(sameDay.shouldFire).toBe(false);
    const nextDay = evaluateCondition(sameDay.newState, { alerting: true, value: 7, policy: "transition_then_daily" }, new Date("2026-06-08T09:30:00Z")); // +24.5h from t0
    expect(nextDay.shouldFire).toBe(true);
    expect(nextDay.newState.lastFiredAt).toEqual(new Date("2026-06-08T09:30:00Z"));
  });

  it("transition_then_interval re-fires after the configured interval", () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const r1 = evaluateCondition(
      okState("s:monthly_creation_alert"),
      { alerting: true, value: 5, policy: "transition_then_interval", intervalMs: thirtyDaysMs },
      t0,
    );
    expect(r1.shouldFire).toBe(true);

    // 15 days later — should NOT re-fire
    const fifteenDaysLater = new Date(t0.getTime() + 15 * 24 * 60 * 60 * 1000);
    const r2 = evaluateCondition(
      r1.newState,
      { alerting: true, value: 3, policy: "transition_then_interval", intervalMs: thirtyDaysMs },
      fifteenDaysLater,
    );
    expect(r2.shouldFire).toBe(false);

    // 31 days later — should re-fire
    const thirtyOneDaysLater = new Date(t0.getTime() + 31 * 24 * 60 * 60 * 1000);
    const r3 = evaluateCondition(
      r2.newState,
      { alerting: true, value: 2, policy: "transition_then_interval", intervalMs: thirtyDaysMs },
      thirtyOneDaysLater,
    );
    expect(r3.shouldFire).toBe(true);
    expect(r3.newState.lastFiredAt).toEqual(thirtyOneDaysLater);
  });

  it("transition_then_interval with 14d interval", () => {
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const r1 = evaluateCondition(
      okState("s:zero_articles_14d"),
      { alerting: true, value: 0, policy: "transition_then_interval", intervalMs: fourteenDaysMs },
      t0,
    );
    expect(r1.shouldFire).toBe(true);

    // 7 days later — should NOT re-fire
    const sevenDaysLater = new Date(t0.getTime() + 7 * 24 * 60 * 60 * 1000);
    const r2 = evaluateCondition(
      r1.newState,
      { alerting: true, value: 0, policy: "transition_then_interval", intervalMs: fourteenDaysMs },
      sevenDaysLater,
    );
    expect(r2.shouldFire).toBe(false);

    // 15 days later — should re-fire
    const fifteenDaysLater = new Date(t0.getTime() + 15 * 24 * 60 * 60 * 1000);
    const r3 = evaluateCondition(
      r2.newState,
      { alerting: true, value: 0, policy: "transition_then_interval", intervalMs: fourteenDaysMs },
      fifteenDaysLater,
    );
    expect(r3.shouldFire).toBe(true);
  });

  it("does not fire when not alerting from ok", () => {
    const r = evaluateCondition(okState(), { alerting: false, value: 0, policy: "transition_only" }, t0);
    expect(r.shouldFire).toBe(false);
    expect(r.newState.status).toBe("ok");
  });
});
