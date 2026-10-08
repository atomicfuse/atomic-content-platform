import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Git Data API commit under sites/** already starts sync-kv (the push event fires). An extra
 * `.build-trigger` commit afterwards only doubles the CI runs — the first one gets cancelled.
 */
const github = vi.hoisted(() => ({
  deleteFileFromBranch: vi.fn(async () => undefined),
  deleteFilesFromBranch: vi.fn(async () => undefined),
  triggerWorkflowViaPush: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [{ domain: "scoopella", staging_branch: "staging/scoopella" }] })),
  updateDashboardIndexEntry: vi.fn(), upsertDashboardIndexEntry: vi.fn(), addToDeleteHistory: vi.fn(),
}));
vi.mock("@/lib/github", () => ({
  ...github,
  updateSiteInIndex: vi.fn(), removeSiteFromIndex: vi.fn(), restoreSiteInIndex: vi.fn(),
  permanentlyRemoveFromTrash: vi.fn(), deleteSiteFilesFromRepo: vi.fn(), branchExists: vi.fn(), deleteBranch: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({
  deletePagesProject: vi.fn(), deleteKVEntry: vi.fn(), deleteKVByPrefix: vi.fn(), deleteR2ObjectsByPrefix: vi.fn(),
  deleteR2Objects: vi.fn(), deregisterWorkerCustomDomain: vi.fn(), getKVEntry: vi.fn(), putKVEntry: vi.fn(), bulkDeleteKV: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({ R2_BUCKET_PROD: "b", getKvNamespaces: () => ({ staging: "s", production: "p" }) }));
vi.mock("@/lib/db/articles", () => ({
  deleteArticleMeta: vi.fn(), deleteArticlesMeta: vi.fn(), deleteArticlesForSite: vi.fn(), upsertArticleMeta: vi.fn(), upsertArticlesMeta: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({ deleteSiteConfig: vi.fn() }));

import { deleteArticleFromStaging, deleteArticlesFromStaging } from "../sites";

beforeEach(() => vi.clearAllMocks());

describe("article deletion commits once — no extra sync-trigger commit", () => {
  it("single delete", async () => {
    await deleteArticleFromStaging("scoopella", "old-story");
    expect(github.deleteFileFromBranch).toHaveBeenCalledWith("sites/scoopella/articles/old-story.md", "staging/scoopella");
    expect(github.triggerWorkflowViaPush).not.toHaveBeenCalled();
  });
  it("bulk delete", async () => {
    await deleteArticlesFromStaging("scoopella", ["a", "b"]);
    expect(github.deleteFilesFromBranch).toHaveBeenCalled();
    expect(github.triggerWorkflowViaPush).not.toHaveBeenCalled();
  });
});
