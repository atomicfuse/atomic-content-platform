// ---------------------------------------------------------------------------
// Domains Dashboard API client
// External service: https://domains-dashboard-53a6--atomic.cloudgrid.io
// No authentication required.
// ---------------------------------------------------------------------------

const BASE =
  process.env.DOMAINS_DASHBOARD_URL ??
  "https://domains-dashboard-53a6--atomic.cloudgrid.io";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UptimeCheck {
  state: "ok" | "n/a" | "unknown";
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  overallStatus: string | null;
  checkedAt: string | null;
}

export interface SslCheck {
  state: "ok" | "n/a" | "unknown";
  status: string | null;
  daysLeft: number | null;
  expiresAt: string | null;
}

export interface DomainExpiryCheck {
  state: "ok" | "n/a" | "unknown";
  daysLeft: number | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
}

export interface ExternalChecks {
  uptime: UptimeCheck;
  ssl: SslCheck;
  domain: DomainExpiryCheck;
}

// ---------------------------------------------------------------------------
// Unknown fallback blocks
// ---------------------------------------------------------------------------

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
  return {
    state: "unknown",
    daysLeft: null,
    expiresAt: null,
    autoRenew: null,
  };
}

function unknownChecks(): ExternalChecks {
  return { uptime: unknownUptime(), ssl: unknownSsl(), domain: unknownDomain() };
}

// ---------------------------------------------------------------------------
// Pure mapper — testable core
// ---------------------------------------------------------------------------

/**
 * Map a Domains Dashboard `latestSnapshot` → our three external check blocks.
 * `null` / non-object snapshot → all "unknown".
 */
export function mapSnapshotToChecks(snapshot: unknown): ExternalChecks {
  if (snapshot == null || typeof snapshot !== "object") {
    return unknownChecks();
  }

  // Cast to a loose record so we can access nested fields safely.
  const s = snapshot as Record<string, unknown>;

  const health =
    s.health != null && typeof s.health === "object"
      ? (s.health as Record<string, unknown>)
      : null;

  const ssl =
    s.ssl != null && typeof s.ssl === "object"
      ? (s.ssl as Record<string, unknown>)
      : null;

  const renewal =
    s.renewal != null && typeof s.renewal === "object"
      ? (s.renewal as Record<string, unknown>)
      : null;

  const overallStatus =
    typeof s.overallStatus === "string" ? s.overallStatus : null;

  const statusCode =
    health != null && typeof health.statusCode === "number"
      ? health.statusCode
      : null;

  const responseTimeMs =
    health != null && typeof health.responseTimeMs === "number"
      ? health.responseTimeMs
      : null;

  const healthCheckedAt =
    health != null && typeof health.checkedAt === "string"
      ? health.checkedAt
      : null;

  // ok = statusCode is present and in the 2xx–3xx range.
  const ok = statusCode != null && statusCode >= 200 && statusCode < 400;

  const uptime: UptimeCheck = {
    state: "ok",
    ok,
    statusCode,
    responseTimeMs,
    overallStatus,
    checkedAt: healthCheckedAt,
  };

  const sslCheck: SslCheck = {
    state: "ok",
    status: ssl != null && typeof ssl.status === "string" ? ssl.status : null,
    daysLeft:
      ssl != null && typeof ssl.daysLeft === "number" ? ssl.daysLeft : null,
    expiresAt:
      ssl != null && typeof ssl.expiresAt === "string" ? ssl.expiresAt : null,
  };

  const domainCheck: DomainExpiryCheck = {
    state: "ok",
    daysLeft:
      renewal != null && typeof renewal.daysLeft === "number"
        ? renewal.daysLeft
        : null,
    expiresAt:
      renewal != null && typeof renewal.expiresAt === "string"
        ? renewal.expiresAt
        : null,
    autoRenew:
      renewal != null && typeof renewal.autoRenew === "boolean"
        ? renewal.autoRenew
        : null,
  };

  return { uptime, ssl: sslCheck, domain: domainCheck };
}

// ---------------------------------------------------------------------------
// Fetchers (thin wrappers — not unit-tested against network)
// ---------------------------------------------------------------------------

/** Fetch all monitored domains and index by domain name → ExternalChecks. */
export async function fetchAllDomains(): Promise<Map<string, ExternalChecks>> {
  try {
    const res = await fetch(`${BASE}/api/domains`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const data = (await res.json()) as Array<{
      domain: string;
      latestSnapshot: unknown;
    }>;
    const map = new Map<string, ExternalChecks>();
    for (const item of data) {
      map.set(item.domain, mapSnapshotToChecks(item.latestSnapshot));
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Fetch the set of blacklisted domain names. Returns an empty set on error. */
export async function fetchBlacklistedDomains(): Promise<Set<string>> {
  try {
    const res = await fetch(`${BASE}/api/domains`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Set();
    const data = (await res.json()) as Array<{
      domain: string;
      isBlacklisted?: boolean;
    }>;
    return new Set(
      data.filter((d) => d.isBlacklisted === true).map((d) => d.domain),
    );
  } catch {
    return new Set();
  }
}

/** Fetch a single domain's ExternalChecks. 404 or any error → all "unknown". */
export async function fetchDomainChecks(
  domain: string,
): Promise<ExternalChecks> {
  try {
    const res = await fetch(`${BASE}/api/domains/${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return unknownChecks();
    if (!res.ok) return unknownChecks();
    const data = (await res.json()) as { latestSnapshot: unknown };
    return mapSnapshotToChecks(data.latestSnapshot);
  } catch {
    return unknownChecks();
  }
}
