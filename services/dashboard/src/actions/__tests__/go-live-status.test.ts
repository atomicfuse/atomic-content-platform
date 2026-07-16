import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
  upsertDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
  updateDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
  upsertSiteConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  writeDashboardIndex: vi.fn().mockResolvedValue(undefined),
  updateSiteInIndex: vi.fn().mockResolvedValue(undefined),
  addSitesToIndex: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  mergeBranchToMain: vi.fn(),
  deleteBranch: vi.fn().mockResolvedValue(undefined),
  branchExists: vi.fn().mockResolvedValue(false),
  triggerWorkflowViaPush: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn(),
  readFileContent: vi.fn(),
  commitNetworkFiles: vi.fn().mockResolvedValue(undefined),
  copySiteTreeToMain: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/cloudflare", () => ({
  listZones: vi.fn(),
  registerWorkerCustomDomain: vi.fn(),
  deregisterWorkerCustomDomain: vi.fn(),
  deleteConflictingDnsRecords: vi.fn(),
  putKVEntry: vi.fn(),
  deleteKVEntry: vi.fn(),
  getKVEntry: vi.fn(),
  listKVKeys: vi.fn(),
  bulkPutKV: vi.fn(),
  bulkDeleteKV: vi.fn(),
  deleteR2Objects: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({
  workerPreviewUrl: vi.fn((f: string) => `https://staging.workers.dev/?_atl_site=${f}`),
  getKvNamespaces: vi.fn(() => ({ staging: "kv-staging", prod: "kv-prod" })),
  R2_BUCKET_PROD: "atl-assets-prod",
}));
vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn() }));
vi.mock("@/lib/email-routing", () => ({ enableEmailRouting: vi.fn(), createEmailRoutingRule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { goLive } from "../wizard";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { updateDashboardIndexEntry } from "@/lib/db/dashboard-index";
import { updateSiteInIndex } from "@/lib/github";

function siteEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: "dogslabs",
    staging_branch: "staging/dogslabs",
    status: "Live",
    custom_domain: null,
    ...overrides,
  };
}

describe("goLive — status must respect an attached custom domain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps status Live when the site already has a custom domain attached", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [siteEntry({ custom_domain: "dogslabs.com" })],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);

    await goLive("dogslabs");

    expect(updateSiteInIndex).toHaveBeenCalledWith("dogslabs", { status: "Live" });
    expect(updateDashboardIndexEntry).toHaveBeenCalledWith("dogslabs", { status: "Live" });
  });

  it("sets status Ready when the site has no custom domain", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [siteEntry({ status: "Staging", custom_domain: null })],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);

    await goLive("dogslabs");

    expect(updateSiteInIndex).toHaveBeenCalledWith("dogslabs", { status: "Ready" });
    expect(updateDashboardIndexEntry).toHaveBeenCalledWith("dogslabs", { status: "Ready" });
  });
});
