/**
 * Alert condition inputs for the ops-console Slack Alerts feature (Plan 4, Task 4).
 *
 * `gatherInputs` fans out to four independent data sources in parallel.
 * Each source is independently failure-isolated: an error in one never
 * blanks the others — safe defaults are returned instead.
 */

import { getKVEntry, credentialsFor } from "../lib/kv.js";
import { getKvNamespaces } from "../lib/cloudflare-accounts.js";
import { readSyncStatus } from "../checks/sync.js";
import { readTracking } from "../checks/tracking.js";
import type { TrackingCheck } from "../checks/tracking.js";
import { getSiteStats } from "../stats/repo.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AlertInputs {
  failedArticles7d: number;
  syncOk: boolean | null;
  /** Alert when neither GA4 nor GTM is present, OR the Meta pixel is absent.
   *  Always `false` when tracking state is "unknown" (read failure —
   *  avoid false positives). */
  trackingOff: boolean;
  reviewCount: number;
}

// ---------------------------------------------------------------------------
// computeTrackingOff — exported for direct unit-testing
// ---------------------------------------------------------------------------

/**
 * Determine whether the tracking configuration warrants an alert.
 *
 * Spec #8: alert when GA/GTM or Meta Pixel is not present.
 * Logic: `(!ga4 && !gtm) || !pixel`
 *   - alert if neither GA4 nor GTM is configured (no analytics provider), OR
 *   - alert if the Meta pixel is missing.
 *
 * Exception: if `state === "unknown"` (couldn't read config), return `false`
 * to avoid false-positive alerts on read failures.
 */
export function computeTrackingOff(
  t: { ga4: boolean; gtm: boolean; pixel: boolean; state: string },
): boolean {
  if (t.state === "unknown") return false;
  return (!t.ga4 && !t.gtm) || !t.pixel;
}

// ---------------------------------------------------------------------------
// reviewCount
// ---------------------------------------------------------------------------

interface ArticleIndexEntry {
  status?: string;
}

/**
 * Read `article-index:<domain>` from the PROD KV namespace and return the
 * count of entries with `status === "review"`.
 *
 * Returns 0 on null response, non-array value, or any error.
 * Never throws — failure-isolated.
 */
export async function reviewCount(domain: string): Promise<number> {
  try {
    const creds = credentialsFor(domain);
    const ns = getKvNamespaces(domain);
    const raw = await getKVEntry(ns.prod, `article-index:${domain}`, creds);
    if (!Array.isArray(raw)) return 0;
    return (raw as ArticleIndexEntry[]).filter(
      (entry) => entry.status === "review",
    ).length;
  } catch (err) {
    console.error(`[alerts/inputs] reviewCount failed for ${domain}:`, err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// gatherInputs
// ---------------------------------------------------------------------------

/**
 * Gather all inputs needed to evaluate alert conditions for a site.
 *
 * All four sources run in parallel (Promise.all). Each is wrapped in its own
 * try/catch so one failing source never blocks or blanks the others.
 *
 * Defaults on failure:
 *   - failedArticles7d → 0
 *   - syncOk          → null
 *   - trackingOff     → false (no false-positive alerts)
 *   - reviewCount     → 0
 */
export async function gatherInputs(
  domain: string,
  now: Date,
): Promise<AlertInputs> {
  const [failedArticles7d, syncOk, tracking, rc] = await Promise.all([
    // (1) failedArticles7d — default 0 on failure
    getSiteStats(domain, now)
      .then((s) => s.failedArticles.last7d)
      .catch((err: unknown) => {
        console.error(`[alerts/inputs] getSiteStats failed for ${domain}:`, err);
        return 0;
      }),

    // (2) syncOk — default null on failure
    readSyncStatus(domain)
      .then((s) => s.ok)
      .catch((err: unknown) => {
        console.error(`[alerts/inputs] readSyncStatus failed for ${domain}:`, err);
        return null as boolean | null;
      }),

    // (3) tracking — default "unknown" shape → computeTrackingOff returns false
    readTracking(domain).catch((err: unknown): TrackingCheck => {
      console.error(`[alerts/inputs] readTracking failed for ${domain}:`, err);
      return { state: "unknown", ga4: false, gtm: false, pixel: false };
    }),

    // (4) reviewCount — already failure-isolated internally, but wrap anyway
    reviewCount(domain),
  ]);

  return {
    failedArticles7d,
    syncOk,
    trackingOff: computeTrackingOff(tracking),
    reviewCount: rc,
  };
}
