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
  getBranchHeadSha: vi.fn(),
  resetBranchToMainIfUnchanged: vi.fn(),
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

import { goLive, publishStagingToProduction } from "../wizard";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { copySiteTreeToMain, createBranch, deleteBranch, getBranchHeadSha, resetBranchToMainIfUnchanged } from "@/lib/github";

/**
 * Publishing copies staging → main, then points staging at main. Commits landing on staging in
 * between (n8n hero-image callbacks keep arriving after generation) used to be wiped by the
 * delete + recreate of the branch: never published, gone from staging too.
 */
describe("publishing never wipes commits that land on staging mid-publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDashboardIndex).mockResolvedValue({
      sites: [{ domain: "buzzbriefdaily", staging_branch: "staging/buzzbriefdaily", status: "Live", custom_domain: "buzzbriefdaily.com" }],
    } as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);
    vi.mocked(copySiteTreeToMain).mockResolvedValue([]);
  });

  it("copies once and moves staging to main when nothing arrived meanwhile", async () => {
    vi.mocked(getBranchHeadSha).mockResolvedValue("s1");
    vi.mocked(resetBranchToMainIfUnchanged).mockResolvedValue(true);
    await publishStagingToProduction("buzzbriefdaily");
    expect(copySiteTreeToMain).toHaveBeenCalledTimes(1);
    expect(resetBranchToMainIfUnchanged).toHaveBeenCalledWith("staging/buzzbriefdaily", "s1");
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(createBranch).not.toHaveBeenCalled();
  });

  it("copies again when a commit landed on staging during the publish", async () => {
    vi.mocked(getBranchHeadSha).mockResolvedValueOnce("s1").mockResolvedValueOnce("s2");
    vi.mocked(resetBranchToMainIfUnchanged).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await publishStagingToProduction("buzzbriefdaily");
    expect(copySiteTreeToMain).toHaveBeenCalledTimes(2);
    expect(resetBranchToMainIfUnchanged).toHaveBeenLastCalledWith("staging/buzzbriefdaily", "s2");
  });

  it("leaves a busy staging branch untouched (nothing lost) after 3 tries", async () => {
    vi.mocked(getBranchHeadSha).mockResolvedValue("moving");
    vi.mocked(resetBranchToMainIfUnchanged).mockResolvedValue(false);
    await expect(publishStagingToProduction("buzzbriefdaily")).resolves.toBeUndefined();
    expect(copySiteTreeToMain).toHaveBeenCalledTimes(3);
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it("go-live uses the same safe reset", async () => {
    vi.mocked(getBranchHeadSha).mockResolvedValue("s1");
    vi.mocked(resetBranchToMainIfUnchanged).mockResolvedValue(true);
    await goLive("buzzbriefdaily");
    expect(resetBranchToMainIfUnchanged).toHaveBeenCalledWith("staging/buzzbriefdaily", "s1");
    expect(deleteBranch).not.toHaveBeenCalled();
  });
});
