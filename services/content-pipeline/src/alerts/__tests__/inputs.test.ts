import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted to the top of the module by Vitest
// ---------------------------------------------------------------------------

const mockGetKVEntry = vi.fn();
const mockCredentialsFor = vi.fn();
const mockGetKvNamespaces = vi.fn();
const mockReadSyncStatus = vi.fn();
const mockReadTracking = vi.fn();
const mockSumFieldWithStatus = vi.fn();

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
  sumFieldWithStatus: (...args: unknown[]): unknown => mockSumFieldWithStatus(...args),
}));

// Import AFTER mocks (vi.mock is hoisted, but the import must be below)
import {
  reviewCount,
  generalImagesCount,
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
  it("returns false when GA4 is present (GTM absent)", () => {
    expect(
      computeTrackingOff({ ga4: true, gtm: false, state: "ok" }),
    ).toBe(false);
  });

  it("returns false when GTM is present (GA4 absent)", () => {
    expect(
      computeTrackingOff({ ga4: false, gtm: true, state: "ok" }),
    ).toBe(false);
  });

  it("returns false when GA4 and GTM are both present", () => {
    expect(
      computeTrackingOff({ ga4: true, gtm: true, state: "ok" }),
    ).toBe(false);
  });

  it("returns true when no analytics configured (no GA4, no GTM)", () => {
    expect(
      computeTrackingOff({ ga4: false, gtm: false, state: "ok" }),
    ).toBe(true);
  });

  it("returns false when state is 'unknown' regardless of flags (avoid false positives)", () => {
    expect(
      computeTrackingOff({ ga4: false, gtm: false, state: "unknown" }),
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
// generalImagesCount
// ---------------------------------------------------------------------------

describe("generalImagesCount", () => {
  it("counts articles with missing featuredImage", async () => {
    mockGetKVEntry.mockResolvedValue([
      { slug: "a1", status: "published" },
      { slug: "a2", status: "published", featuredImage: "https://r2.dev/img.webp" },
    ]);
    expect(await generalImagesCount(DOMAIN)).toBe(1);
  });

  it("counts articles with general-article in featuredImage", async () => {
    mockGetKVEntry.mockResolvedValue([
      { slug: "a1", featuredImage: "travelswire-general-article.webp" },
      { slug: "a2", featuredImage: "https://r2.dev/real-image.webp" },
      { slug: "a3", featuredImage: "another-general-article-img.webp" },
    ]);
    expect(await generalImagesCount(DOMAIN)).toBe(2);
  });

  it("returns 0 when getKVEntry returns null", async () => {
    mockGetKVEntry.mockResolvedValue(null);
    expect(await generalImagesCount(DOMAIN)).toBe(0);
  });

  it("returns 0 (never throws) when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("boom"));
    expect(await generalImagesCount(DOMAIN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// gatherInputs — composes sources, each failure-isolated
// ---------------------------------------------------------------------------

describe("gatherInputs", () => {
  beforeEach(() => {
    // Default happy-path: all deps succeed
    mockSumFieldWithStatus.mockResolvedValue(0);
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

  it("composes all fields from mocked dependencies", async () => {
    const inputs = await gatherInputs(DOMAIN, NOW, {
      schedule: { articlesPerDay: 2, preferredDays: ["Monday", "Wednesday", "Friday"] },
      siteName: "TravelSwire",
    });

    expect(inputs.syncOk).toBe(true);
    expect(inputs.trackingOff).toBe(false); // ga4=true → no alert
    expect(inputs.reviewCount).toBe(2);
    expect(inputs.siteName).toBe("TravelSwire");
    // 2 * 3 * 4.33 = 25.98 → rounded to 26
    expect(inputs.expectedMonthly).toBe(26);
  });

  it("defaults syncOk to null when readSyncStatus throws", async () => {
    mockReadSyncStatus.mockRejectedValue(new Error("kv unreachable"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.syncOk).toBeNull();
    expect(inputs.reviewCount).toBe(2);
  });

  it("defaults trackingOff to false when readTracking throws", async () => {
    mockReadTracking.mockRejectedValue(new Error("config read failed"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(false);
    expect(inputs.syncOk).toBe(true);
  });

  it("defaults reviewCount to 0 when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("kv timeout"));
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.reviewCount).toBe(0);
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

  it("sets trackingOff=false when pixel is absent but GA4 is present (pixel no longer checked)", async () => {
    mockReadTracking.mockResolvedValue({
      state: "ok",
      ga4: true,
      gtm: false,
      pixel: false,
    });
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.trackingOff).toBe(false);
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

  it("returns safe defaults when every dependency fails", async () => {
    mockSumFieldWithStatus.mockRejectedValue(new Error("boom"));
    mockReadSyncStatus.mockRejectedValue(new Error("boom"));
    mockReadTracking.mockRejectedValue(new Error("boom"));
    mockGetKVEntry.mockRejectedValue(new Error("boom"));

    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.syncOk).toBeNull();
    expect(inputs.trackingOff).toBe(false);
    expect(inputs.reviewCount).toBe(0);
    expect(inputs.createdLast30d).toBe(0);
    expect(inputs.failedLast30d).toBe(0);
    expect(inputs.createdLast14d).toBe(0);
    expect(inputs.expectedMonthly).toBe(0);
    expect(inputs.siteName).toBe(DOMAIN);
    expect(inputs.generalImages).toBe(0);
  });

  it("uses domain as siteName when opts not provided", async () => {
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.siteName).toBe(DOMAIN);
  });

  it("computes expectedMonthly as 0 when no schedule provided", async () => {
    const inputs = await gatherInputs(DOMAIN, NOW);
    expect(inputs.expectedMonthly).toBe(0);
  });
});
