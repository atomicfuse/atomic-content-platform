// ---------------------------------------------------------------------------
// Site Checks merge core
//
// Stitches together two data sources keyed on DIFFERENT identifiers:
//   - content-pipeline `/site-checks` → sync + tracking, keyed by SITE FOLDER
//     NAME (e.g. `travelswire`) — matches KV `sync-status:<folder>`.
//   - Domains Dashboard → uptime + ssl + domain, keyed by the site's CUSTOM
//     DOMAIN (e.g. `travelswire.com`).
//
// The merge takes the dashboard index as the authoritative site list, looks up
// sync/tracking by folder name and external checks by `custom_domain`. Sites
// with no `custom_domain` (staging-only) get external blocks = `{ state: "n/a" }`.
// ---------------------------------------------------------------------------

import type {
  DomainExpiryCheck,
  ExternalChecks,
  SslCheck,
  UptimeCheck,
} from "./domains-dashboard";

// ---------------------------------------------------------------------------
// ATL (content-pipeline) check shapes — mirrors
// services/content-pipeline/src/checks/{sync,tracking}.ts.
// ---------------------------------------------------------------------------

export interface SyncCheck {
  state: "ok" | "unknown";
  ok: boolean | null;
  syncedAt: string | null;
  gitSha: string | null;
  error: string | null;
}

export interface TrackingCheck {
  state: "ok" | "unknown";
  ga4: boolean;
  gtm: boolean;
  pixel: boolean;
}

/** One raw site from the content-pipeline `/site-checks` proxy. */
export interface AtlChecks {
  siteDomain: string;
  sync: SyncCheck;
  tracking: TrackingCheck;
}

// ---------------------------------------------------------------------------
// Merged output
// ---------------------------------------------------------------------------

export interface MergedChecks {
  uptime: UptimeCheck;
  ssl: SslCheck;
  domain: DomainExpiryCheck;
  sync: SyncCheck;
  tracking: TrackingCheck;
}

export interface MergedSite {
  /** Site folder name (consistent with the rest of the dashboard). */
  siteDomain: string;
  checks: MergedChecks;
}

/** Minimal slice of a dashboard-index site entry the merge needs. */
export interface IndexSite {
  domain: string;
  custom_domain: string | null;
}

// ---------------------------------------------------------------------------
// Fallback blocks
// ---------------------------------------------------------------------------

export function unknownSync(): SyncCheck {
  return { state: "unknown", ok: null, syncedAt: null, gitSha: null, error: null };
}

export function unknownTracking(): TrackingCheck {
  return { state: "unknown", ga4: false, gtm: false, pixel: false };
}

function naUptime(): UptimeCheck {
  return {
    state: "n/a",
    ok: false,
    statusCode: null,
    responseTimeMs: null,
    overallStatus: null,
    checkedAt: null,
  };
}

function naSsl(): SslCheck {
  return { state: "n/a", status: null, daysLeft: null, expiresAt: null };
}

function naDomain(): DomainExpiryCheck {
  return { state: "n/a", daysLeft: null, expiresAt: null, autoRenew: null };
}

/** External blocks for a staging-only site (no custom domain). */
export function naExternal(): ExternalChecks {
  return { uptime: naUptime(), ssl: naSsl(), domain: naDomain() };
}

function unknownUptime(): UptimeCheck {
  return {
    state: "unknown",
    ok: false,
    statusCode: null,
    responseTimeMs: null,
    overallStatus: null,
    checkedAt: null,
  };
}

function unknownSsl(): SslCheck {
  return { state: "unknown", status: null, daysLeft: null, expiresAt: null };
}

function unknownDomain(): DomainExpiryCheck {
  return { state: "unknown", daysLeft: null, expiresAt: null, autoRenew: null };
}

/** External blocks when a site HAS a custom domain but it isn't in the map. */
export function unknownExternal(): ExternalChecks {
  return { uptime: unknownUptime(), ssl: unknownSsl(), domain: unknownDomain() };
}

// ---------------------------------------------------------------------------
// Pure merge — testable core
// ---------------------------------------------------------------------------

/**
 * Merge one site's external checks (by custom domain) with its ATL checks
 * (by folder name) into a single `MergedSite`.
 */
export function mergeSite(
  site: IndexSite,
  atlByFolder: Map<string, AtlChecks>,
  externalByDomain: Map<string, ExternalChecks>,
): MergedSite {
  const folder = site.domain;
  const atl = atlByFolder.get(folder);

  // External: keyed by custom domain. Staging-only → n/a. Has a domain but no
  // entry in the map (Domains Dashboard down or domain not monitored) → unknown.
  const external = site.custom_domain
    ? (externalByDomain.get(site.custom_domain) ?? unknownExternal())
    : naExternal();

  return {
    siteDomain: folder,
    checks: {
      uptime: external.uptime,
      ssl: external.ssl,
      domain: external.domain,
      sync: atl?.sync ?? unknownSync(),
      tracking: atl?.tracking ?? unknownTracking(),
    },
  };
}

/**
 * Merge the full site list. Dashboard index is the authoritative list; each
 * site gets sync/tracking by folder name and uptime/ssl/domain by custom domain.
 */
export function mergeChecks(
  indexSites: IndexSite[],
  atlByFolder: Map<string, AtlChecks>,
  externalByDomain: Map<string, ExternalChecks>,
): MergedSite[] {
  return indexSites.map((site) =>
    mergeSite(site, atlByFolder, externalByDomain),
  );
}
