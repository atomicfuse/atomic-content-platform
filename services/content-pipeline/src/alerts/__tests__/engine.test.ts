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
    const r1 = evaluateCondition(okState("s:failed_articles"), { alerting: true, value: 5, policy: "transition_then_daily" }, t0);
    expect(r1.shouldFire).toBe(true);
    const sameDay = evaluateCondition(r1.newState, { alerting: true, value: 6, policy: "transition_then_daily" }, new Date("2026-06-07T21:00:00Z")); // +12h
    expect(sameDay.shouldFire).toBe(false);
    const nextDay = evaluateCondition(sameDay.newState, { alerting: true, value: 7, policy: "transition_then_daily" }, new Date("2026-06-08T09:30:00Z")); // +24.5h from t0
    expect(nextDay.shouldFire).toBe(true);
    expect(nextDay.newState.lastFiredAt).toEqual(new Date("2026-06-08T09:30:00Z"));
  });

  it("does not fire when not alerting from ok", () => {
    const r = evaluateCondition(okState(), { alerting: false, value: 0, policy: "transition_only" }, t0);
    expect(r.shouldFire).toBe(false);
    expect(r.newState.status).toBe("ok");
  });
});
