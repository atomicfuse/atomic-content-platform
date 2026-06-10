import type { SiteStatus } from "@/types/dashboard";

/* ─── Alert Labels ─── */

export const ALERT_LABELS: Record<string, string> = {
  sync_failed: "Content sync failed",
  in_review: "Too many articles in review",
  tracking_off: "No analytics configured (GA4/GTM)",
  monthly_creation_alert: "Below monthly article target",
  zero_articles_14d: "No articles created in 14 days",
};

export const ALERT_CONDITION_IDS = Object.keys(ALERT_LABELS);

/* ─── Types ─── */

export interface OpsRow {
  domain: string;
  status: SiteStatus;
  customDomain: string | null;
  vertical: string;
  failedArticles7d: number;
  failedArticles30d: number;
  imageGenFailed7d: number;
  imageGenFailed30d: number;
  reviewCount: number;
  generalImages: number;
  todayCreated: number;
  todayExpected: number;
  thisWeekCreated: number;
  schedule: {
    articlesPerDay: number;
    preferredDays: string[];
    weeklyTarget: number;
    nextRun: string | null;
  } | null;
  recentArticles: {
    title: string;
    score: number | null;
    status: string;
    slug: string;
    publishDate: string;
  }[];
  lastAdded: { at: string; source: string; count: number } | null;
  lastFailedAt: string | null;
  uptime: { state: string; ok: boolean; statusCode: number | null; responseTimeMs: number | null };
  sync: { state: string; ok: boolean | null; syncedAt: string | null; error: string | null };
  ssl: { state: string; status: string | null; daysLeft: number | null; expiresAt: string | null };
  tracking: { state: string; ga4: boolean; gtm: boolean; pixel: boolean };
  domainExpiry: { state: string; daysLeft: number | null; expiresAt: string | null; autoRenew: boolean | null };
  alerts: { condition: string; severity: string; since: string; value: number | null }[];
  tier: 0 | 1 | 2 | 3 | 4;
}

export type CardId =
  | "ALL_LIVE"
  | "ATTENTION"
  | "FAILED_ARTICLES"
  | "SITES_DOWN"
  | "SYNC_FAILED"
  | "PUBLISHED_TODAY"
  | "IN_REVIEW";

export interface CostStripData {
  aiSpendToday: number;
  avgPerArticle7d: number;
  expectedMonthly: number;
  totalTokensIn: number;
  totalTokensOut: number;
  r2: { totalBytes: number; totalImages: number; capacityPct: number };
}

/* ─── Tier ─── */

function within24h(syncedAt: string | null): boolean {
  if (!syncedAt) return false;
  return Date.now() - new Date(syncedAt).getTime() < 86_400_000;
}

export function computeTier(row: Omit<OpsRow, "tier">): 0 | 1 | 2 | 3 | 4 {
  // Staging-only sites have uptime.state === "n/a" — never tier 0
  if (row.uptime.state !== "n/a" && !row.uptime.ok) return 0;
  if (row.sync.ok !== null && !row.sync.ok && within24h(row.sync.syncedAt)) return 1;
  if (row.failedArticles7d > 3 || row.reviewCount > 15) return 2;
  if (row.alerts.length > 0) return 3;
  return 4;
}

/* ─── Card Predicates ─── */

export function cardPredicate(card: CardId): (row: OpsRow) => boolean {
  switch (card) {
    case "ALL_LIVE":
      return (r) => r.status === "Live";
    case "ATTENTION":
      return (r) => r.alerts.length > 0;
    case "FAILED_ARTICLES":
      return (r) => r.failedArticles7d > 3;
    case "SITES_DOWN":
      return (r) => r.uptime.state !== "n/a" && !r.uptime.ok;
    case "SYNC_FAILED":
      return (r) => r.sync.ok !== null && !r.sync.ok && within24h(r.sync.syncedAt);
    case "PUBLISHED_TODAY":
      return (r) => r.todayExpected > 0;
    case "IN_REVIEW":
      return (r) => r.reviewCount > 0;
  }
}

/* ─── Cost Strip ─── */

interface CostInput {
  todayUsd: number;
  avgPerArticle7dUsd: number;
  created7d: number;
  allTimeTokens: { input: number; output: number };
}

interface R2Input {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

interface ScheduleInput {
  articlesPerDay: number;
  preferredDays: string[];
}

export function computeCostStrip(
  costs: CostInput[],
  r2: R2Input,
  schedules: (ScheduleInput | null)[],
): CostStripData {
  let aiSpendToday = 0;
  let weightedCost7d = 0;
  let totalCreated7d = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const c of costs) {
    aiSpendToday += c.todayUsd;
    weightedCost7d += c.avgPerArticle7dUsd * c.created7d;
    totalCreated7d += c.created7d;
    totalTokensIn += c.allTimeTokens.input;
    totalTokensOut += c.allTimeTokens.output;
  }

  const avgPerArticle7d = totalCreated7d > 0 ? weightedCost7d / totalCreated7d : 0;

  let projectedMonthlyArticles = 0;
  for (const s of schedules) {
    if (s) {
      projectedMonthlyArticles += s.articlesPerDay * s.preferredDays.length * 4.33;
    }
  }
  const expectedMonthly = avgPerArticle7d * projectedMonthlyArticles;

  return {
    aiSpendToday,
    avgPerArticle7d,
    expectedMonthly,
    totalTokensIn,
    totalTokensOut,
    r2: { totalBytes: r2.totalBytes, totalImages: r2.totalImages, capacityPct: r2.capacityPct },
  };
}

/* ─── Merge ─── */

export interface StatsInput {
  siteDomain: string;
  failedArticles?: { last7d: number; last30d: number };
  imageGenFailed?: { last7d: number; last30d: number };
  reviewCount?: number;
  generalImages?: number;
  today?: { created: number; expected: number };
  thisWeek?: { created: number; expected: number };
  schedule?: {
    articlesPerDay: number;
    preferredDays: string[];
    weeklyTarget: number;
    nextRun: string | null;
  } | null;
  recentArticles?: OpsRow["recentArticles"];
  lastAdded?: OpsRow["lastAdded"];
  lastFailedAt?: string | null;
}

export interface ChecksInput {
  siteDomain: string;
  checks: {
    uptime: OpsRow["uptime"];
    ssl: OpsRow["ssl"];
    domain: OpsRow["domainExpiry"];
    sync: OpsRow["sync"];
    tracking: OpsRow["tracking"];
  };
}

export interface AttentionInput {
  siteDomain: string;
  alerting: OpsRow["alerts"];
}

export interface IndexInput {
  domain: string;
  status: SiteStatus;
  custom_domain: string | null;
  vertical: string;
}

export function mergeOpsRows(
  index: IndexInput[],
  stats: StatsInput[],
  checks: ChecksInput[],
  attention: AttentionInput[],
): OpsRow[] {
  const statsMap = new Map(stats.map((s) => [s.siteDomain, s]));
  const checksMap = new Map(checks.map((c) => [c.siteDomain, c]));
  const attentionMap = new Map(attention.map((a) => [a.siteDomain, a]));

  const defaultUptime: OpsRow["uptime"] = { state: "unknown", ok: true, statusCode: null, responseTimeMs: null };
  const defaultSync: OpsRow["sync"] = { state: "unknown", ok: true, syncedAt: null, error: null };
  const defaultSsl: OpsRow["ssl"] = { state: "unknown", status: null, daysLeft: null, expiresAt: null };
  const defaultTracking: OpsRow["tracking"] = { state: "unknown", ga4: false, gtm: false, pixel: false };
  const defaultDomainExpiry: OpsRow["domainExpiry"] = { state: "unknown", daysLeft: null, expiresAt: null, autoRenew: null };

  return index.map((site) => {
    const s = statsMap.get(site.domain);
    const c = checksMap.get(site.domain);
    const a = attentionMap.get(site.domain);

    const partial: Omit<OpsRow, "tier"> = {
      domain: site.domain,
      status: site.status as SiteStatus,
      customDomain: site.custom_domain,
      vertical: site.vertical ?? "",
      failedArticles7d: s?.failedArticles?.last7d ?? 0,
      failedArticles30d: s?.failedArticles?.last30d ?? 0,
      imageGenFailed7d: s?.imageGenFailed?.last7d ?? 0,
      imageGenFailed30d: s?.imageGenFailed?.last30d ?? 0,
      reviewCount: s?.reviewCount ?? 0,
      generalImages: s?.generalImages ?? 0,
      todayCreated: s?.today?.created ?? 0,
      todayExpected: s?.today?.expected ?? 0,
      thisWeekCreated: s?.thisWeek?.created ?? 0,
      schedule: s?.schedule ?? null,
      recentArticles: s?.recentArticles ?? [],
      lastAdded: s?.lastAdded ?? null,
      lastFailedAt: s?.lastFailedAt ?? null,
      uptime: c?.checks.uptime ?? defaultUptime,
      sync: c?.checks.sync ?? defaultSync,
      ssl: c?.checks.ssl ?? defaultSsl,
      tracking: c?.checks.tracking ?? defaultTracking,
      domainExpiry: c?.checks.domain ?? defaultDomainExpiry,
      alerts: a?.alerting ?? [],
    };

    return { ...partial, tier: computeTier(partial) };
  });
}

/* ─── Sort ─── */

export function sortByTier(rows: OpsRow[]): OpsRow[] {
  return [...rows].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.domain.localeCompare(b.domain);
  });
}
