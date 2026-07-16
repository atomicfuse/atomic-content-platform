import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DashboardSiteEntry } from "@/types/dashboard";

// --- Mocks ---

const mockReadDashboardIndex = vi.fn();
const mockUpdateDashboardIndexEntry = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: (...args: unknown[]) => mockReadDashboardIndex(...args),
  upsertDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
  updateDashboardIndexEntry: (...args: unknown[]) =>
    mockUpdateDashboardIndexEntry(...args),
}));

vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn().mockResolvedValue(null),
  upsertSiteConfig: vi.fn().mockResolvedValue(undefined),
}));

const mockWriteDashboardIndex = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  writeDashboardIndex: (...args: unknown[]) =>
    mockWriteDashboardIndex(...args),
  updateSiteInIndex: vi.fn().mockResolvedValue(undefined),
  addSitesToIndex: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  mergeBranchToMain: vi.fn(),
  deleteBranch: vi.fn(),
  branchExists: vi.fn().mockResolvedValue(false),
  triggerWorkflowViaPush: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn(),
  readFileContent: vi.fn(),
  commitNetworkFiles: vi.fn().mockResolvedValue(undefined),
  copySiteTreeToMain: vi.fn().mockResolvedValue([]),
}));

const mockRegisterWorkerCustomDomain = vi.fn();
const mockDeregisterWorkerCustomDomain = vi.fn().mockResolvedValue(undefined);
const mockDeleteConflictingDnsRecords = vi.fn();
const mockPutKVEntry = vi.fn().mockResolvedValue(undefined);
const mockGetKVEntry = vi.fn().mockResolvedValue(null);
const mockListKVKeys = vi.fn().mockResolvedValue([]);
const mockBulkPutKV = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/cloudflare", () => ({
  listZones: vi.fn(),
  registerWorkerCustomDomain: (...args: unknown[]) =>
    mockRegisterWorkerCustomDomain(...args),
  deregisterWorkerCustomDomain: (...args: unknown[]) =>
    mockDeregisterWorkerCustomDomain(...args),
  deleteConflictingDnsRecords: (...args: unknown[]) =>
    mockDeleteConflictingDnsRecords(...args),
  putKVEntry: (...args: unknown[]) => mockPutKVEntry(...args),
  deleteKVEntry: vi.fn().mockResolvedValue(undefined),
  getKVEntry: (...args: unknown[]) => mockGetKVEntry(...args),
  listKVKeys: (...args: unknown[]) => mockListKVKeys(...args),
  bulkPutKV: (...args: unknown[]) => mockBulkPutKV(...args),
}));

vi.mock("@/lib/constants", () => ({
  workerPreviewUrl: vi.fn(
    (f: string) => `https://staging.workers.dev/?_atl_site=${f}`,
  ),
  getKvNamespaces: () => ({ prod: "prod-ns", staging: "staging-ns" }),
  KV_NAMESPACE_PROD: "prod-ns",
  KV_NAMESPACE_STAGING: "staging-ns",
}));

vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({
  extractFaviconFromLogo: vi.fn(),
}));
vi.mock("@/lib/email-routing", () => ({
  enableEmailRouting: vi.fn(),
  createEmailRoutingRule: vi.fn(),
}));
vi.mock("@/lib/author-names", () => ({
  generateAuthorName: vi.fn().mockReturnValue("Test Author"),
}));
vi.mock("@/lib/general-image", () => ({
  generateAndUploadDefaultSiteImage: vi.fn(),
}));
vi.mock("@/lib/r2-upload", () => ({ uploadToR2: vi.fn() }));
vi.mock("@/lib/domains-dashboard", () => ({
  fetchBlacklistedDomains: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// --- Helpers ---

function makeSite(
  overrides: Partial<DashboardSiteEntry> = {},
): DashboardSiteEntry {
  return {
    domain: "trendscores",
    site_name: "TrendScores",
    company: "ATL",
    vertical: "Entertainment",
    status: "Ready",
    custom_domain: null,
    zone_id: null,
    worker_pending_dns: true,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as DashboardSiteEntry;
}

function setupIndex(sites: DashboardSiteEntry[]): void {
  mockReadDashboardIndex.mockResolvedValue({ sites });
}

// --- Tests ---

describe("attachCustomDomain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors the rollback to MongoDB when CF registration fails", async () => {
    const site = makeSite({ status: "Ready", custom_domain: null, zone_id: null });
    setupIndex([site]);
    mockRegisterWorkerCustomDomain.mockRejectedValue(new Error("CF exploded"));

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow(/Failed to register/);

    // The optimistic mirror set Live+domain; the rollback must revert Mongo
    // too, or the UI shows an attached domain that never registered.
    const lastMirror = mockUpdateDashboardIndexEntry.mock.calls.at(-1)!;
    expect(lastMirror[0]).toBe("trendscores");
    expect(lastMirror[1]).toMatchObject({
      custom_domain: null,
      status: "Ready",
      zone_id: null,
    });
  });

  it("mirrors the rollback to MongoDB when KV seeding fails", async () => {
    const site = makeSite({ status: "Ready", custom_domain: null, zone_id: null });
    setupIndex([site]);
    mockRegisterWorkerCustomDomain.mockResolvedValue({ id: "cd-1" });
    mockPutKVEntry.mockRejectedValueOnce(new Error("KV down"));

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow(/KV seed failed/);

    const lastMirror = mockUpdateDashboardIndexEntry.mock.calls.at(-1)!;
    expect(lastMirror[1]).toMatchObject({ custom_domain: null, status: "Ready" });
  });

  it("registers Custom Domain on the worker on happy path", async () => {
    const site = makeSite();
    setupIndex([site]);
    mockRegisterWorkerCustomDomain.mockResolvedValue({ id: "cd-1" });

    const { attachCustomDomain } = await import("../wizard");
    const result = await attachCustomDomain(
      "trendscores",
      "trendscores.com",
      "zone-123",
    );

    expect(result).toEqual({ success: true });

    // Custom Domain was registered on the worker
    expect(mockRegisterWorkerCustomDomain).toHaveBeenCalledWith(
      "trendscores.com",
      "zone-123",
      "trendscores",
    );

    // KV hostname entry was seeded
    expect(mockPutKVEntry).toHaveBeenCalledWith(
      "prod-ns",
      "site:trendscores.com",
      JSON.stringify({ siteId: "trendscores" }),
      "trendscores",
    );

    // Index was written with status=Live
    expect(mockWriteDashboardIndex).toHaveBeenCalledTimes(1);
    const writtenIndex = mockWriteDashboardIndex.mock.calls[0]![0] as {
      sites: DashboardSiteEntry[];
    };
    const writtenSite = writtenIndex.sites.find(
      (s) => s.domain === "trendscores",
    )!;
    expect(writtenSite.custom_domain).toBe("trendscores.com");
    expect(writtenSite.status).toBe("Live");
    expect(writtenSite.worker_pending_dns).toBe(false);
  });

  it("auto-deletes conflicting DNS records and retries on 'externally managed DNS' error", async () => {
    const site = makeSite();
    setupIndex([site]);

    // First call fails with "externally managed DNS", retry succeeds
    mockRegisterWorkerCustomDomain
      .mockRejectedValueOnce(
        new Error(
          "Failed to register custom domain trendscores.com: externally managed DNS records",
        ),
      )
      .mockResolvedValueOnce({ id: "cd-1" });

    mockDeleteConflictingDnsRecords.mockResolvedValue(2);

    const { attachCustomDomain } = await import("../wizard");
    const result = await attachCustomDomain(
      "trendscores",
      "trendscores.com",
      "zone-123",
    );

    expect(result).toEqual({ success: true });

    // deleteConflictingDnsRecords was called to clean up
    expect(mockDeleteConflictingDnsRecords).toHaveBeenCalledWith(
      "zone-123",
      "trendscores.com",
      "trendscores",
    );

    // registerWorkerCustomDomain was retried
    expect(mockRegisterWorkerCustomDomain).toHaveBeenCalledTimes(2);

    // Site was marked Live (no rollback)
    const writtenIndex = mockWriteDashboardIndex.mock.calls[0]![0] as {
      sites: DashboardSiteEntry[];
    };
    const writtenSite = writtenIndex.sites.find(
      (s) => s.domain === "trendscores",
    )!;
    expect(writtenSite.status).toBe("Live");
  });

  it("rolls back index when DNS cleanup + retry still fails", async () => {
    const site = makeSite();
    setupIndex([site]);

    // Both attempts fail
    mockRegisterWorkerCustomDomain.mockRejectedValue(
      new Error(
        "Failed to register custom domain trendscores.com: externally managed DNS records",
      ),
    );
    mockDeleteConflictingDnsRecords.mockResolvedValue(0);

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow("Failed to register trendscores.com on Cloudflare after DNS cleanup");

    // Index was rolled back (second writeDashboardIndex call)
    expect(mockWriteDashboardIndex).toHaveBeenCalledTimes(2);
    const rollbackCommitMsg = mockWriteDashboardIndex.mock.calls[1]![1] as string;
    expect(rollbackCommitMsg).toContain("rollback");

    // KV was NOT seeded (we didn't get past step 2)
    expect(mockPutKVEntry).not.toHaveBeenCalled();
  });

  it("rolls back index on unexpected CF registration errors", async () => {
    const site = makeSite();
    setupIndex([site]);

    mockRegisterWorkerCustomDomain.mockRejectedValue(
      new Error("Failed to register custom domain: 403 Forbidden"),
    );

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow("Failed to register trendscores.com on Cloudflare: ");

    // No DNS cleanup attempted for non-"externally managed DNS" errors
    expect(mockDeleteConflictingDnsRecords).not.toHaveBeenCalled();

    // Index was rolled back
    expect(mockWriteDashboardIndex).toHaveBeenCalledTimes(2);
  });

  it("rolls back CF registration + index when KV seed fails", async () => {
    const site = makeSite();
    setupIndex([site]);

    mockRegisterWorkerCustomDomain.mockResolvedValue({ id: "cd-1" });
    mockPutKVEntry.mockRejectedValue(new Error("KV write failed"));

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow("KV seed failed");

    // CF domain was deregistered
    expect(mockDeregisterWorkerCustomDomain).toHaveBeenCalledWith(
      "trendscores.com",
      "trendscores",
    );

    // Index was rolled back
    expect(mockWriteDashboardIndex).toHaveBeenCalledTimes(2);
    const rollbackCommitMsg = mockWriteDashboardIndex.mock.calls[1]![1] as string;
    expect(rollbackCommitMsg).toContain("rollback");
  });

  it("rejects duplicate custom domain across sites", async () => {
    const site = makeSite();
    const otherSite = makeSite({
      domain: "othernews",
      custom_domain: "trendscores.com",
    });
    setupIndex([site, otherSite]);

    const { attachCustomDomain } = await import("../wizard");
    await expect(
      attachCustomDomain("trendscores", "trendscores.com", "zone-123"),
    ).rejects.toThrow('already attached to site "othernews"');

    // No CF registration attempted
    expect(mockRegisterWorkerCustomDomain).not.toHaveBeenCalled();
  });
});

describe("detachCustomDomain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deregisters Custom Domain from worker and deletes KV hostname entry", async () => {
    const site = makeSite({
      custom_domain: "trendscores.com",
      status: "Live",
      zone_id: "zone-123",
      worker_pending_dns: false,
    });
    setupIndex([site]);

    const { detachCustomDomain } = await import("../wizard");
    const result = await detachCustomDomain("trendscores");

    expect(result).toEqual({ success: true });

    // CF domain was deregistered
    expect(mockDeregisterWorkerCustomDomain).toHaveBeenCalledWith(
      "trendscores.com",
      "trendscores",
    );

    // Index was updated first (critical ordering)
    expect(mockWriteDashboardIndex).toHaveBeenCalledTimes(1);
    const writtenIndex = mockWriteDashboardIndex.mock.calls[0]![0] as {
      sites: DashboardSiteEntry[];
    };
    const writtenSite = writtenIndex.sites.find(
      (s) => s.domain === "trendscores",
    )!;
    expect(writtenSite.custom_domain).toBeNull();
    expect(writtenSite.status).toBe("Ready");
  });

  it("throws when no custom domain is attached", async () => {
    const site = makeSite({ custom_domain: null });
    setupIndex([site]);

    const { detachCustomDomain } = await import("../wizard");
    await expect(detachCustomDomain("trendscores")).rejects.toThrow(
      "No custom domain to detach",
    );
  });
});
