export type ConditionId = "failed_articles" | "sync_failed" | "in_review" | "tracking_off";

export type FirePolicy = "transition_only" | "transition_then_daily";

export interface AlertState {
  _id: string;                 // `${domain}:${conditionId}` (or `__network__:${reminderId}`)
  status: "ok" | "alerting";
  firstDetectedAt: Date | null;
  lastFiredAt: Date | null;
  lastValue: number | null;
}

export interface EvalInput {
  alerting: boolean;
  value: number | null;
  policy: FirePolicy;
}

export interface EvalResult {
  newState: AlertState;
  shouldFire: boolean;
}
