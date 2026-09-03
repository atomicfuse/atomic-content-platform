/**
 * Alert condition inputs for the ops-console Slack Alerts feature.
 *
 * `gatherInputs` fans out to independent data sources in parallel.
 * Each source is independently failure-isolated: an error in one never
 * blanks the others — safe defaults are returned instead.
 */

import { getKVEntry, credentialsFor } from "../lib/kv.js";
import { getKvNamespaces } from "../lib/cloudflare-accounts.js";
import { readSyncStatus } from "../checks/sync.js";
import { readTracking } from "../checks/tracking.js";
import type { TrackingCheck } from "../checks/tracking.js";
import { sumFieldWithStatus } from "../stats/repo.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AlertInputs {
  syncOk: boolean | null;
  /** Alert when neither GA4 nor GTM is present.
   *  Always `false` when tracking state is "unknown" (read failure —
   *  avoid false positives). */
  trackingOff: boolean;
  reviewCount: number;
  /** Sum of `created` from generation_events with status success/partial in last 30d. */
  createdLast30d: number;
  /** Sum of `failed` from generation_events in last 30d. */
  failedLast30d: number;
  /** Sum of `created` from generation_events with status success/partial in last 14d. */
  createdLast14d: number;
  /** Expected monthly article count from the schedule. */
  expectedMonthly: number;
  /** Human-readable site name from site.yaml. */
  siteName: string;
  /** Count of articles using a general/default image. */
  generalImages: number;
}

// ---------------------------------------------------------------------------
// computeTrackingOff — exported for direct unit-testing
// ---------------------------------------------------------------------------

/**
 * Determine whether the tracking configuration warrants an alert.
 *
 * Logic: `!ga4 && !gtm` — alert when no analytics provider is configured.
 *
 * Exception: if `state === "unknown"` (couldn't read config), return `false`
 * to avoid false-positive alerts on read failures.
 */
export function computeTrackingOff(
  t: { ga4: boolean; gtm: boolean; state: string },
): boolean {
  if (t.state === "unknown") return false;
  return !t.ga4 && !t.gtm;
}

// ---------------------------------------------------------------------------
// reviewCount
// ---------------------------------------------------------------------------

interface ArticleIndexEntry {
  status?: string;
  featuredImage?: string;
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
// generalImagesCount — counts articles using the default general image
// ---------------------------------------------------------------------------

/**
 * Read `article-index:<domain>` from the PROD KV namespace and return the
 * count of entries whose `featuredImage` is missing or contains "general-article".
 *
 * Returns 0 on null response, non-array value, or any error.
 * Never throws — failure-isolated.
 */
export async function generalImagesCount(domain: string): Promise<number> {
  try {
    const creds = credentialsFor(domain);
    const ns = getKvNamespaces(domain);
    const raw = await getKVEntry(ns.prod, `article-index:${domain}`, creds);
    if (!Array.isArray(raw)) return 0;
    return (raw as ArticleIndexEntry[]).filter(
      (entry) =>
        !entry.featuredImage ||
        entry.featuredImage.includes("general-article"),
    ).length;
  } catch (err) {
    console.error(`[alerts/inputs] generalImagesCount failed for ${domain}:`, err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// gatherInputs
// ---------------------------------------------------------------------------

/** Schedule info needed to compute expectedMonthly. */
export interface ScheduleInfo {
  articlesPerDay: number;
  preferredDays: string[];
}

/**
 * Gather all inputs needed to evaluate alert conditions for a site.
 *
 * All sources run in parallel (Promise.all). Each is wrapped in its own
 * try/catch so one failing source never blocks or blanks the others.
 *
 * `schedule` and `siteName` are injected by the caller (run.ts) since they
 * require reading site briefs which the runner already does.
 */
export async function gatherInputs(
  domain: string,
  now: Date,
  opts?: {
    schedule?: ScheduleInfo | null;
    siteName?: string;
  },
): Promise<AlertInputs> {
  const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const cutoff14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const successStatuses = ["success", "partial"];

  const [syncOk, tracking, rc, createdLast30d, failedLast30d, createdLast14d, gi] =
    await Promise.all([
      // (1) syncOk — default null on failure
      readSyncStatus(domain)
        .then((s) => s.ok)
        .catch((err: unknown) => {
          console.error(`[alerts/inputs] readSyncStatus failed for ${domain}:`, err);
          return null as boolean | null;
        }),

      // (2) tracking — default "unknown" shape → computeTrackingOff returns false
      readTracking(domain).catch((err: unknown): TrackingCheck => {
        console.error(`[alerts/inputs] readTracking failed for ${domain}:`, err);
        return { state: "unknown", ga4: false, gtm: false, pixel: false };
      }),

      // (3) reviewCount — already failure-isolated internally, but wrap anyway
      reviewCount(domain),

      // (4) createdLast30d — sum of created with status success/partial
      sumFieldWithStatus(domain, "created", cutoff30d, successStatuses).catch(
        (err: unknown) => {
          console.error(`[alerts/inputs] sumFieldWithStatus(created,30d) failed for ${domain}:`, err);
          return 0;
        },
      ),

      // (5) failedLast30d — sum of failed from all events in last 30d
      sumFieldWithStatus(domain, "failed", cutoff30d, successStatuses.concat("error")).catch(
        (err: unknown) => {
          console.error(`[alerts/inputs] sumFieldWithStatus(failed,30d) failed for ${domain}:`, err);
          return 0;
        },
      ),

      // (6) createdLast14d — sum of created with status success/partial
      sumFieldWithStatus(domain, "created", cutoff14d, successStatuses).catch(
        (err: unknown) => {
          console.error(`[alerts/inputs] sumFieldWithStatus(created,14d) failed for ${domain}:`, err);
          return 0;
        },
      ),

      // (7) generalImages count
      generalImagesCount(domain),
    ]);

  // Compute expectedMonthly from the schedule
  const schedule = opts?.schedule;
  const expectedMonthly = schedule
    ? Math.round(schedule.articlesPerDay * schedule.preferredDays.length * 4.33)
    : 0;

  return {
    syncOk,
    trackingOff: computeTrackingOff(tracking),
    reviewCount: rc,
    createdLast30d,
    failedLast30d,
    createdLast14d,
    expectedMonthly,
    siteName: opts?.siteName ?? domain,
    generalImages: gi,
  };
}
