/**
 * Pure edge-trigger alert evaluation engine.
 *
 * Design contract — lastFiredAt persistence:
 * ─────────────────────────────────────────
 * `evaluateCondition` sets `lastFiredAt = now` in `newState` whenever
 * `shouldFire` is true. The RUNNER (Task 5) persists `newState` ONLY after
 * a successful Slack send. On send failure the runner persists nothing,
 * leaving the old state intact — so the alert retries on the next tick and
 * `lastFiredAt` is never advanced on a failed send. This keeps the engine
 * pure and fully testable while honoring the invariant: "Slack failure must
 * not advance lastFiredAt".
 */

import type { AlertState, EvalInput, EvalResult } from "./types.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluates a single alert condition against its current persisted state.
 * Pure — no I/O, no Date.now(). `now` is injected by the caller.
 */
export function evaluateCondition(
  state: AlertState,
  input: EvalInput,
  now: Date,
): EvalResult {
  // Recovery: condition is no longer alerting
  if (!input.alerting) {
    return {
      newState: {
        ...state,
        status: "ok",
        firstDetectedAt: null,
        lastValue: input.value,
        // lastFiredAt intentionally preserved (historical record)
      },
      shouldFire: false,
    };
  }

  // Entering alerting (transition from ok → alerting)
  if (state.status === "ok") {
    return {
      newState: {
        ...state,
        status: "alerting",
        firstDetectedAt: now,
        lastValue: input.value,
        lastFiredAt: now,
      },
      shouldFire: true,
    };
  }

  // Still alerting (state.status === "alerting")
  if (input.policy === "transition_only") {
    return {
      newState: {
        ...state,
        lastValue: input.value,
        // status stays "alerting", firstDetectedAt/lastFiredAt unchanged
      },
      shouldFire: false,
    };
  }

  // transition_then_daily / transition_then_interval: re-fire after interval
  const intervalMs =
    input.policy === "transition_then_interval" && input.intervalMs
      ? input.intervalMs
      : TWENTY_FOUR_HOURS_MS;

  const elapsed =
    state.lastFiredAt == null
      ? Infinity
      : now.getTime() - state.lastFiredAt.getTime();

  if (elapsed >= intervalMs) {
    return {
      newState: {
        ...state,
        lastValue: input.value,
        lastFiredAt: now,
      },
      shouldFire: true,
    };
  }

  return {
    newState: {
      ...state,
      lastValue: input.value,
    },
    shouldFire: false,
  };
}
