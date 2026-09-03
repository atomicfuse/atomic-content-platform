export type ConditionId =
  | "sync_failed"
  | "in_review"
  | "tracking_off"
  | "monthly_creation_alert"
  | "zero_articles_14d";

export type FirePolicy =
  | "transition_only"
  | "transition_then_daily"
  | "transition_then_interval";

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
  /** Re-fire interval in ms. Required when policy is "transition_then_interval". */
  intervalMs?: number;
}

export interface EvalResult {
  newState: AlertState;
  shouldFire: boolean;
}
