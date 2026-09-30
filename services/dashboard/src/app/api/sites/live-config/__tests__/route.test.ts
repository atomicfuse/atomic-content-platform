import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DashboardSiteEntry } from "@/types/dashboard";

const getDashboardIndexMock = vi.fn();
const getKVEntryMock = vi.fn();

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: (...args: unknown[]) => getDashboardIndexMock(...args),
}));

vi.mock("@/lib/cloudflare", () => ({
  getKVEntry: (...args: unknown[]) => getKVEntryMock(...args),
}));

// Real getKvNamespaces (no Dev1 domains used in these tests) — deterministic,
// no external dependency, so it's left unmocked.

function makeSite(overrides: Partial<DashboardSiteEntry> = {}): DashboardSiteEntry {
  return {
    domain: "coolnews",
    company: "ATL",
    vertical: "News",
    status: "Live",
    site_id: "site_123",
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: "2026-01-01T00:00:00Z",
    created_at: "2025-06-15T00:00:00Z",
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: "staging/coolnews",
    preview_url: null,
    saved_previews: null,
    custom_domain: null,
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  getDashboardIndexMock.mockReset();
  getKVEntryMock.mockReset();
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/sites/live-config", () => {
  it("returns {} and never calls KV when Cloudflare credentials are missing", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const { GET } = await import("../route");
    const res = await GET();
    expect(await res.json()).toEqual({});
    expect(getKVEntryMock).not.toHaveBeenCalled();
    expect(getDashboardIndexMock).not.toHaveBeenCalled();
  });

  it("reads a Live site from the prod namespace", async () => {
    getDashboardIndexMock.mockResolvedValue({ sites: [makeSite({ domain: "live-site", status: "Live" })] });
    getKVEntryMock.mockImplementation(async (namespaceId: string, key: string) => {
      if (key === "site-config:live-site") {
        return JSON.stringify({
          theme: { template: "grid" },
          tracking: { ga4: "G-1", facebook_pixel: "FB-1", gtm: "GTM-1", google_ads: "AW-1" },
          brief: { schedule: { articles_per_day: 2, preferred_days: ["Monday"] } },
        });
      }
      if (key === "sync-status:live-site") {
        return JSON.stringify({ syncedAt: "2026-01-05T00:00:00Z" });
      }
      return null;
    });

    const { GET } = await import("../route");
    const res = await GET();
    const data = await res.json();

    expect(data["live-site"]).toEqual({
      template: "grid",
      ga4: "G-1",
      facebook_pixel: "FB-1",
      gtm: "GTM-1",
      google_ads: "AW-1",
      articles_per_day: 2,
      publish_days: ["Monday"],
      last_synced_at: "2026-01-05T00:00:00Z",
    });

    // Live site → prod namespace (KV_NAMESPACE_PROD from constants.ts).
    const namespaceIdsUsed = getKVEntryMock.mock.calls.map((call) => call[0]);
    expect(new Set(namespaceIdsUsed).size).toBe(1);
  });

  it("reads a non-Live site from the staging namespace (different namespace id than prod)", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "live-site", status: "Live" }),
        makeSite({ domain: "staging-site", status: "Staging" }),
      ],
    });
    getKVEntryMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    await GET();

    const namespacesByDomain = new Map<string, string>();
    for (const call of getKVEntryMock.mock.calls) {
      const [namespaceId, key, domain] = call as [string, string, string];
      if (key.startsWith("site-config:")) namespacesByDomain.set(domain, namespaceId);
    }
    expect(namespacesByDomain.get("live-site")).not.toBe(namespacesByDomain.get("staging-site"));
  });

  it("falls back to articles_per_week / preferred_days.length when articles_per_day is absent", async () => {
    getDashboardIndexMock.mockResolvedValue({ sites: [makeSite({ domain: "site-a" })] });
    getKVEntryMock.mockImplementation(async (_ns: string, key: string) => {
      if (key === "site-config:site-a") {
        return JSON.stringify({
          brief: { schedule: { articles_per_week: 5, preferred_days: ["Monday", "Wednesday"] } },
        });
      }
      return null;
    });

    const { GET } = await import("../route");
    const data = await (await GET()).json();
    expect(data["site-a"].articles_per_day).toBe(3); // ceil(5/2)
  });

  it("gives all-null values for a site whose KV read throws, without failing the whole response", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [makeSite({ domain: "broken-site" }), makeSite({ domain: "ok-site" })],
    });
    getKVEntryMock.mockImplementation(async (_ns: string, key: string) => {
      if (key.includes("broken-site")) throw new Error("KV unavailable");
      if (key === "site-config:ok-site") {
        return JSON.stringify({ theme: { template: "modern" } });
      }
      return null;
    });

    const { GET } = await import("../route");
    const data = await (await GET()).json();

    expect(data["broken-site"]).toEqual({
      template: null,
      ga4: null,
      facebook_pixel: null,
      gtm: null,
      google_ads: null,
      articles_per_day: null,
      publish_days: null,
      last_synced_at: null,
    });
    expect(data["ok-site"].template).toBe("modern");
  });

  it("returns all-null values (template 'modern') when site-config is missing entirely, still succeeding", async () => {
    getDashboardIndexMock.mockResolvedValue({ sites: [makeSite({ domain: "no-config" })] });
    getKVEntryMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const data = await (await GET()).json();
    expect(data["no-config"]).toEqual({
      template: null,
      ga4: null,
      facebook_pixel: null,
      gtm: null,
      google_ads: null,
      articles_per_day: null,
      publish_days: null,
      last_synced_at: null,
    });
  });

  it("caches the response for subsequent calls within the TTL (dashboard index read only once)", async () => {
    getDashboardIndexMock.mockResolvedValue({ sites: [makeSite({ domain: "site-a" })] });
    getKVEntryMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    await GET();
    await GET();

    expect(getDashboardIndexMock).toHaveBeenCalledTimes(1);
  });
});
