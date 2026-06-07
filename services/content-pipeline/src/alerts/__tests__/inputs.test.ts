import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted to the top of the module by Vitest
// ---------------------------------------------------------------------------

const mockGetKVEntry = vi.fn();
const mockCredentialsFor = vi.fn();
const mockGetKvNamespaces = vi.fn();
const mockReadSyncStatus = vi.fn();
const mockReadTracking = vi.fn();
const mockGetSiteStats = vi.fn();

vi.mock("../../lib/kv.js", () => ({
  getKVEntry: (...args: unknown[]): unknown => mockGetKVEntry(...args),
  credentialsFor: (...args: unknown[]): unknown => mockCredentialsFor(...args),
}));

vi.mock("../../lib/cloudflare-accounts.js", () => ({
  getKvNamespaces: (...args: unknown[]): unknown => mockGetKvNamespaces(...args),
}));

vi.mock("../../checks/sync.js", () => ({
  readSyncStatus: (...args: unknown[]): unknown => mockReadSyncStatus(...args),
}));

vi.mock("../../checks/tracking.js", () => ({
  readTracking: (...args: unknown[]): unknown => mockReadTracking(...args),
}));

vi.mock("../../stats/repo.js", () => ({
  getSiteStats: (...args: unknown[]): unknown => mockGetSiteStats(...args),
}));

// Import AFTER mocks (vi.mock is hoisted, but the import must be below)
import {
  reviewCount,
  gatherInputs,
  computeTrackingOff,
} from "../inputs.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const FAKE_CREDS = { accountId: "acct123", token: "tok123" };
const FAKE_NS = { prod: "ns-prod-id", staging: "ns-staging-id" };
const DOMAIN = "travelswire";
const NOW = new Date("2026-06-07T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockCredentialsFor.mockReturnValue(FAKE_CREDS);
  mockGetKvNamespaces.mockReturnValue(FAKE_NS);
});

// ---------------------------------------------------------------------------
// computeTrackingOff — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("computeTrackingOff", () => {
  it("returns false when GA4 and pixel are both present (GTM absent)", () => {
    expect(
      computeTrackingOff({ ga4: true, gtm: false, pixel: true, state: "ok" }),
    ).toBe(false);
  });

  it("returns false when GTM and pixel are present (GA4 absent)", () => {
    expect(
      computeTrackingOff({ ga4: false, gtm: true, pixel: true, state: "ok" }),
    ).toBe(false);
  });

  it("returns false when GA4, GTM, and pixel are all present", () => {
    expect(
      computeTrackingOff({ ga4: true, gtm: true, pixel: true, state: "ok" }),
    ).toBe(false);
  });

  it("returns true when no analytics configured (no GA4, no GTM)", () => {
    // (!ga4 && !gtm) → true
    expect(
      computeTrackingOff({ ga4: false, gtm: false, pixel: true, state: "ok" }),
    ).toBe(true);
  });

  it("returns true when pixel is absent (even with GA4 present)", () => {
    // !pixel → true
    expect(
      computeTrackingOff({ ga4: true, gtm: false, pixel: false, state: "ok" }),
    ).toBe(true);
  });

  it("returns true when no analytics AND no pixel", () => {
    // both conditions true
    expect(
      computeTrackingOff({ ga4: false, gtm: false, pixel: false, state: "ok" }),
    ).toBe(true);
  });

  it("returns false when state is 'unknown' regardless of flags (avoid false positives)", () => {
    expect(
      computeTrackingOff({ ga4: false, gtm: false, pixel: false, state: "unknown" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reviewCount
// ---------------------------------------------------------------------------

describe("reviewCount", () => {
  it("returns count of entries with status=review", async () => {
    mockGetKVEntry.mockResolvedValue([
      { slug: "a1", status: "review" },
      { slug: "a2", status: "published" },
      { slug: "a3", status: "review" },
    ]);

    const result = await reviewCount(DOMAIN);

    expect(result).toBe(2);
    // Verify it reads from the prod namespace with the correct key
    expect(mockGetKVEntry).toHaveBeenCalledWith(
      FAKE_NS.prod,
      `article-index:${DOMAIN}`,
      FAKE_CREDS,
    );
  });

  it("returns 0 when getKVEntry returns null", async () => {
    mockGetKVEntry.mockResolvedValue(null);
    expect(await reviewCount(DOMAIN)).toBe(0);
  });

  it("returns 0 when getKVEntry returns a non-array", async () => {
    mockGetKVEntry.mockResolvedValue({ some: "object" });
    expect(await reviewCount(DOMAIN)).toBe(0);
  });

  it("returns 0 (never throws) when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("network timeout"));
    expect(await reviewCount(DOMAIN)).toBe(0);
  });

  it("returns 0 when all articles have non-review status", async () => {
    mockGetKVEntry.mockResolvedValue([
      { slug: "a1", status: "published" },
      { slug: "a2", status: "draft" },
    ]);
    expect(await reviewCount(DOMAIN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// gatherInputs — composes four sources, each failure-isolated
// ---------------------------------------------------------------------------

describe("gatherInputs", () => {
  beforeEach(() => {
    // Default happy-path: all deps succeed
    mockGetSiteStats.mockResolvedValue({
      siteDomain: DOMAIN,
      failedArticles: { last7d: 3, last30d: 10 },
      imageGenFailed: { last7d: 0, last30d: 0 },
      schedule: null,
      lastAdded: { at: null, source: null, count: null },
      lastFailedAt: null,
      thisWeek: { created: 5, expected: 7 },
    });
    mockReadSyncStatus.mockResolvedValue({
      state: "ok",
      ok: true,
      syncedAt: "2026-06-07T10:00:00Z",
      gitSha: "abc123",
      error: null,
    });
    mockReadTracking.mockResolvedValue({
      state: "ok",
      ga4: true,
      gtm: false,
      pixel: true,
    });
    mockGetKVEntry.mockResolvedValue([
      { slug: "a1", status: "review" },
      { slug: "a2", status: "review" },
    ]);
  });

  it("composes all four fields from mocked dependencies", async () => {
    const inputs = await gatherInputs(DOMAIN, NOW);

    expect(inputs.failedArticles7d).toBe(3);
    expect(inputs.syncOk).toBe(true);
    expect(inputs.trackingOff).toBe(false); // ga4=true, pixel=true → no alert
    expect(inputs.reviewCount).toBe(2);
  });

  it("defaults failedArticles7d to 0 when getSiteStats throws", async () => {
    mockGetSiteStats.mockRejectedValue(new Error("mongo unreachable"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.failedArticles7d).toBe(0);
    // Other fields still populated
    expect(inputs.syncOk).toBe(true);
    expect(inputs.reviewCount).toBe(2);
  });

  it("defaults syncOk to null when readSyncStatus throws", async () => {
    mockReadSyncStatus.mockRejectedValue(new Error("kv unreachable"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.syncOk).toBeNull();
    // Other fields still populated
    expect(inputs.failedArticles7d).toBe(3);
    expect(inputs.reviewCount).toBe(2);
  });

  it("defaults trackingOff to false when readTracking throws", async () => {
    mockReadTracking.mockRejectedValue(new Error("config read failed"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(false);
    // Other fields still populated
    expect(inputs.failedArticles7d).toBe(3);
    expect(inputs.syncOk).toBe(true);
  });

  it("defaults reviewCount to 0 when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("kv timeout"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.reviewCount).toBe(0);
    // Other fields still populated
    expect(inputs.failedArticles7d).toBe(3);
    expect(inputs.syncOk).toBe(true);
  });

  it("sets trackingOff=true when no analytics provider configured", async () => {
    mockReadTracking.mockResolvedValue({
      state: "ok",
      ga4: false,
      gtm: false,
      pixel: true,
    });
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(true);
  });

  it("sets trackingOff=true when pixel is absent", async () => {
    mockReadTracking.mockResolvedValue({
      state: "ok",
      ga4: true,
      gtm: false,
      pixel: false,
    });
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(true);
  });

  it("sets trackingOff=false when state=unknown (read failure → no false positive)", async () => {
    mockReadTracking.mockResolvedValue({
      state: "unknown",
      ga4: false,
      gtm: false,
      pixel: false,
    });
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(false);
  });

  it("returns all defaults when every dependency fails", async () => {
    mockGetSiteStats.mockRejectedValue(new Error("boom"));
    mockReadSyncStatus.mockRejectedValue(new Error("boom"));
    mockReadTracking.mockRejectedValue(new Error("boom"));
    mockGetKVEntry.mockRejectedValue(new Error("boom"));

    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs).toEqual({
      failedArticles7d: 0,
      syncOk: null,
      trackingOff: false,
      reviewCount: 0,
    });
  });
});
