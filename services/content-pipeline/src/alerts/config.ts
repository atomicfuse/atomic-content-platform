/**
 * Alert configuration for the Slack alerting system.
 *
 * Defaults are used when `scheduler/alerts.yaml` is absent from the network
 * repo or cannot be parsed. `mergeAlertConfig` is a pure deep-merge that the
 * test suite exercises directly; `loadAlertConfig` is a thin wrapper that
 * reads the file via an injected reader (Octokit-backed in production, a stub
 * in tests).
 */

import { parse as parseYaml } from "yaml";

export interface AlertConfig {
  enabled: boolean;
  syncFailed: { enabled: boolean };
  inReview: { enabled: boolean; limit: number };
  trackingOff: { enabled: boolean };
  monthlyCreationAlert: { enabled: boolean; failureThresholdPct: number };
  zeroArticles14d: { enabled: boolean };
  reminders: {
    createNewSite: { enabled: boolean; everyDays: number };
    generalImages: { enabled: boolean };
  };
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  syncFailed: { enabled: true },
  inReview: { enabled: true, limit: 15 },
  trackingOff: { enabled: true },
  monthlyCreationAlert: { enabled: true, failureThresholdPct: 70 },
  zeroArticles14d: { enabled: true },
  reminders: {
    createNewSite: { enabled: true, everyDays: 14 },
    generalImages: { enabled: true },
  },
};

/**
 * Safely read a boolean from a parsed object field.
 * Returns the default if the field is absent or not a boolean.
 */
function safeBool(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

/**
 * Safely read a number from a parsed object field.
 * Returns the default if the field is absent or not a finite number.
 */
function safeNum(value: unknown, defaultValue: number): number {
  return typeof value === "number" && isFinite(value) ? value : defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge a partial parsed config over defaults (missing keys → defaults). Pure.
 *
 * Validates types defensively: non-boolean booleans and non-number numbers are
 * silently ignored and the default value is kept instead.
 */
export function mergeAlertConfig(parsed: unknown): AlertConfig {
  if (!isRecord(parsed)) {
    return { ...DEFAULT_ALERT_CONFIG };
  }

  const sf = isRecord(parsed.syncFailed) ? parsed.syncFailed : {};
  const ir = isRecord(parsed.inReview) ? parsed.inReview : {};
  const to = isRecord(parsed.trackingOff) ? parsed.trackingOff : {};
  const mca = isRecord(parsed.monthlyCreationAlert) ? parsed.monthlyCreationAlert : {};
  const za = isRecord(parsed.zeroArticles14d) ? parsed.zeroArticles14d : {};
  const rem = isRecord(parsed.reminders) ? parsed.reminders : {};
  const cns = isRecord(rem.createNewSite) ? rem.createNewSite : {};
  const gi = isRecord(rem.generalImages) ? rem.generalImages : {};

  return {
    enabled: safeBool(parsed.enabled, DEFAULT_ALERT_CONFIG.enabled),
    syncFailed: {
      enabled: safeBool(sf.enabled, DEFAULT_ALERT_CONFIG.syncFailed.enabled),
    },
    inReview: {
      enabled: safeBool(ir.enabled, DEFAULT_ALERT_CONFIG.inReview.enabled),
      limit: safeNum(ir.limit, DEFAULT_ALERT_CONFIG.inReview.limit),
    },
    trackingOff: {
      enabled: safeBool(to.enabled, DEFAULT_ALERT_CONFIG.trackingOff.enabled),
    },
    monthlyCreationAlert: {
      enabled: safeBool(mca.enabled, DEFAULT_ALERT_CONFIG.monthlyCreationAlert.enabled),
      failureThresholdPct: safeNum(mca.failureThresholdPct, DEFAULT_ALERT_CONFIG.monthlyCreationAlert.failureThresholdPct),
    },
    zeroArticles14d: {
      enabled: safeBool(za.enabled, DEFAULT_ALERT_CONFIG.zeroArticles14d.enabled),
    },
    reminders: {
      createNewSite: {
        enabled: safeBool(cns.enabled, DEFAULT_ALERT_CONFIG.reminders.createNewSite.enabled),
        everyDays: safeNum(cns.everyDays, DEFAULT_ALERT_CONFIG.reminders.createNewSite.everyDays),
      },
      generalImages: {
        enabled: safeBool(gi.enabled, DEFAULT_ALERT_CONFIG.reminders.generalImages.enabled),
      },
    },
  };
}

/**
 * Injected reader type — accepts an async function that returns raw YAML text.
 * Production uses Octokit; tests inject a stub.
 */
export type AlertConfigReader = () => Promise<string>;

/**
 * Read scheduler/alerts.yaml via the injected reader; absent/parse-error → defaults.
 * Never throws — always falls back to DEFAULT_ALERT_CONFIG on any error.
 *
 * In production, pass a reader that calls `readFile(octokit, networkRepo, "scheduler/alerts.yaml")`.
 * In tests, pass a stub that returns YAML text or throws.
 *
 * Example (production usage):
 * ```ts
 * const reader = () => readFile(octokit, config.networkRepo, "scheduler/alerts.yaml");
 * const alertConfig = await loadAlertConfig(reader);
 * ```
 */
export async function loadAlertConfig(
  reader?: AlertConfigReader,
): Promise<AlertConfig> {
  if (!reader) {
    return DEFAULT_ALERT_CONFIG;
  }
  try {
    const raw = await reader();
    const parsed: unknown = parseYaml(raw);
    return mergeAlertConfig(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[alert-config] Failed to load alerts.yaml, using defaults:", message);
    return DEFAULT_ALERT_CONFIG;
  }
}
