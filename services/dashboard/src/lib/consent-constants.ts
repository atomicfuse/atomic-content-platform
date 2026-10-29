/**
 * Cookie-consent constants shared by the dashboard UI.
 *
 * Copies of the site-worker values in `packages/site-worker/src/lib/consent.ts`
 * (the dashboard can't import site-worker code). Keep them in sync.
 */

/** Countries where tracking waits for an explicit Accept (EU/EEA, UK, Switzerland). */
export const OPT_IN_COUNTRIES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB", "CH",
];

export const DEFAULT_CONSENT_MESSAGE =
  "We use cookies to measure traffic and improve your experience. You can accept, reject, or choose in Settings.";
