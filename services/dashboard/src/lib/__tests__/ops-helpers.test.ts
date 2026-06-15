import { describe, it, expect } from "vitest";
import {
  computeTier,
  cardPredicate,
  computeCostStrip,
  type OpsRow,
  type CardId,
} from "../ops-helpers";

// Minimal OpsRow factory for testing
function makeRow(overrides: Partial<OpsRow> = {}): OpsRow {
  return {
    domain: "test",
    status: "Live",
    customDomain: null,
    vertical: "",
    failedArticles7d: 0,
    failedArticles30d: 0,
    imageGenFailed7d: 0,
    imageGenFailed30d: 0,
    reviewCount: 0,
    generalImages: 0,
    todayCreated: 0,
    todayExpected: 0,
    thisWeekCreated: 0,
    schedule: null,
    recentArticles: [],
    lastAdded: null,
    lastFailedAt: null,
    uptime: { state: "ok", ok: true, statusCode: 200, responseTimeMs: 100 },
    sync: { state: "ok", ok: true, syncedAt: new Date().toISOString(), error: null },
    ssl: { state: "ok", status: "active", daysLeft: 90, expiresAt: null },
    tracking: { state: "ok", ga4: true, gtm: true, pixel: true },
    domainExpiry: { state: "ok", daysLeft: 300, expiresAt: null, autoRenew: true },
    alerts: [],
    tier: 4,
    ...overrides,
  };
}

describe("computeTier", () => {
  it("returns 0 for site down", () => {
    expect(computeTier(makeRow({ uptime: { state: "ok", ok: false, statusCode: 503, responseTimeMs: null } }))).toBe(0);
  });

  it("returns 4 for staging-only site with n/a uptime", () => {
    expect(computeTier(makeRow({ uptime: { state: "n/a", ok: false, statusCode: null, responseTimeMs: null } }))).toBe(4);
  });

  it("returns 1 for sync failed within 24h", () => {
    const recentSync = new Date(Date.now() - 3600_000).toISOString();
    expect(computeTier(makeRow({ sync: { state: "ok", ok: false, syncedAt: recentSync, error: "fail" } }))).toBe(1);
  });

  it("returns 2 for high failed articles", () => {
    expect(computeTier(makeRow({ failedArticles7d: 5 }))).toBe(2);
  });

  it("returns 2 for high review count", () => {
    expect(computeTier(makeRow({ reviewCount: 20 }))).toBe(2);
  });

  it("returns 3 for any other alert", () => {
    expect(computeTier(makeRow({ alerts: [{ condition: "tracking_off", severity: "warn", since: "", value: null }] }))).toBe(3);
  });

  it("returns 4 for healthy site", () => {
    expect(computeTier(makeRow())).toBe(4);
  });
});

describe("cardPredicate", () => {
  it("ALL_LIVE filters to Live status only", () => {
    const fn = cardPredicate("ALL_LIVE");
    expect(fn(makeRow({ status: "Live" }))).toBe(true);
    expect(fn(makeRow({ status: "Staging" }))).toBe(false);
  });

  it("ATTENTION filters to rows with alerts", () => {
    const fn = cardPredicate("ATTENTION");
    expect(fn(makeRow({ alerts: [{ condition: "x", severity: "warn", since: "", value: null }] }))).toBe(true);
    expect(fn(makeRow())).toBe(false);
  });

  it("SITES_DOWN excludes staging-only sites", () => {
    const fn = cardPredicate("SITES_DOWN");
    expect(fn(makeRow({ uptime: { state: "ok", ok: false, statusCode: 503, responseTimeMs: null } }))).toBe(true);
    expect(fn(makeRow({ uptime: { state: "n/a", ok: false, statusCode: null, responseTimeMs: null } }))).toBe(false);
  });

  it("IN_REVIEW filters to rows with any review count", () => {
    const fn = cardPredicate("IN_REVIEW");
    expect(fn(makeRow({ reviewCount: 1 }))).toBe(true);
    expect(fn(makeRow({ reviewCount: 0 }))).toBe(false);
  });
});

describe("computeCostStrip", () => {
  it("returns zeroes for empty input", () => {
    const result = computeCostStrip([], { totalBytes: 0, totalImages: 0, capacityPct: 0, lastUpdated: null }, []);
    expect(result.aiSpendToday).toBe(0);
    expect(result.avgPerArticle7d).toBe(0);
    expect(result.expectedMonthly).toBe(0);
  });

  it("computes network-wide totals with expected monthly", () => {
    const costs = [
      { todayUsd: 1.0, avgPerArticle7dUsd: 0.50, created7d: 10, allTimeTokens: { input: 1000, output: 500 } },
      { todayUsd: 0.5, avgPerArticle7dUsd: 0.60, created7d: 5, allTimeTokens: { input: 2000, output: 1000 } },
    ];
    const r2 = { totalBytes: 5 * 1024 ** 3, totalImages: 100, capacityPct: 50, lastUpdated: null };
    const schedules = [
      { articlesPerDay: 2, preferredDays: ["Monday", "Wednesday", "Friday"] },
      { articlesPerDay: 1, preferredDays: ["Monday", "Tuesday"] },
    ];
    const result = computeCostStrip(costs as never[], r2, schedules);
    expect(result.aiSpendToday).toBeCloseTo(1.5, 2);
    expect(result.avgPerArticle7d).toBeCloseTo(0.533, 2);
    expect(result.totalTokensIn).toBe(3000);
    expect(result.totalTokensOut).toBe(1500);
    expect(result.r2.totalImages).toBe(100);
    expect(result.expectedMonthly).toBeCloseTo(18.46, 0);
  });
});
