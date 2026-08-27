/**
 * autoPublishSite staging compare-and-swap (Bug B — 2026-08-27).
 *
 * autoPublishSite snapshots staging → commits to main → force-resets staging to
 * main HEAD. Commits landing on staging during that window were copied nowhere
 * and then destroyed by the reset. n8n image callbacks commit `featuredImage`
 * to staging ~20s after an article is created, squarely inside that window: on
 * 2026-08-27, 5 of 12 articles lost their image this way while every single
 * image generation succeeded.
 *
 * The regression assertion is "drift ⇒ updateRef is never called". Against the
 * pre-CAS implementation that assertion fails, because it always reset.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListFiles = vi.fn();
const mockReadFile = vi.fn();
const mockCommitBatch = vi.fn();
const mockClearTreeCache = vi.fn();
const mockUpsertArticles = vi.fn();
const mockDeleteStagingArticles = vi.fn();

vi.mock("../lib/github.js", () => ({
  createOctokit: vi.fn(),
  commitFile: vi.fn(),
  readFile: (...a: unknown[]) => mockReadFile(...a),
  readFileBase64: vi.fn(async () => "AAAA"),
  listFilesRecursive: (...a: unknown[]) => mockListFiles(...a),
  commitBatch: (...a: unknown[]) => mockCommitBatch(...a),
  clearTreeCache: (...a: unknown[]) => mockClearTreeCache(...a),
  parseRepo: (repo: string) => ({ owner: repo.split("/")[0], repo: repo.split("/")[1] }),
}));

vi.mock("../lib/db/articles.js", () => ({
  upsertArticlesBatch: (...a: unknown[]) => mockUpsertArticles(...a),
  deleteArticlesForSiteBranch: (...a: unknown[]) => mockDeleteStagingArticles(...a),
}));

const { autoPublishSite } = await import("../queue/scheduler-flow.js");

const REPO = "atomicfuse/atomic-labs-network";
const DOMAIN = "dogslabs";
const BRANCH = "staging/dogslabs";

/**
 * Fake Octokit whose staging getRef calls return `stagingShas` in order.
 * Calls for heads/main always return a fixed SHA and never consume the list.
 */
function makeOctokit(stagingShas: string[]): {
  octokit: never;
  updateRef: ReturnType<typeof vi.fn>;
  createRef: ReturnType<typeof vi.fn>;
} {
  const updateRef = vi.fn(async () => ({}));
  const createRef = vi.fn(async () => ({}));
  let i = 0;
  const getRef = vi.fn(async ({ ref }: { ref: string }) => {
    if (ref === "heads/main") return { data: { object: { sha: "MAIN_HEAD" } } };
    const sha = stagingShas[Math.min(i, stagingShas.length - 1)];
    i += 1;
    return { data: { object: { sha } } };
  });
  return {
    octokit: { rest: { git: { getRef, updateRef, createRef } } } as never,
    updateRef,
    createRef,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListFiles.mockResolvedValue([
    `sites/${DOMAIN}/site.yaml`,
    `sites/${DOMAIN}/articles/dante-rare-chimera-dog.md`,
  ]);
  mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) =>
    path.endsWith(".md")
      ? "---\ntitle: Dante\nfeaturedImage: /assets/images/dante-rare-chimera-dog.webp\n---\nbody"
      : "site: config",
  );
  mockCommitBatch.mockResolvedValue("COMMIT_SHA");
  mockUpsertArticles.mockResolvedValue(undefined);
  mockDeleteStagingArticles.mockResolvedValue(undefined);
});

describe("autoPublishSite — staging drift", () => {
  it("resets staging when nothing landed during the copy", async () => {
    const { octokit, updateRef } = makeOctokit(["SHA_A", "SHA_A"]);

    await autoPublishSite(octokit, REPO, DOMAIN, BRANCH);

    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
    expect(updateRef).toHaveBeenCalledTimes(1);
    expect(updateRef.mock.calls[0]?.[0]).toMatchObject({
      ref: `heads/${BRANCH}`,
      sha: "MAIN_HEAD",
      force: true,
    });
    expect(mockDeleteStagingArticles).toHaveBeenCalledWith(DOMAIN, BRANCH);
  });

  it("NEVER resets staging when commits landed during the copy", async () => {
    // Every attempt sees a different SHA before/after — persistent drift.
    const { octokit, updateRef, createRef } = makeOctokit([
      "SHA_A", "SHA_B", "SHA_C", "SHA_D", "SHA_E", "SHA_F",
    ]);

    await autoPublishSite(octokit, REPO, DOMAIN, BRANCH);

    // This is the whole point: the destructive reset must not happen.
    expect(updateRef).not.toHaveBeenCalled();
    expect(createRef).not.toHaveBeenCalled();
    // Staging Mongo docs must survive too — staging still holds those commits.
    expect(mockDeleteStagingArticles).not.toHaveBeenCalled();
    // Content still reached main, and was retried up to the cap.
    expect(mockCommitBatch).toHaveBeenCalledTimes(3);
  });

  it("re-copies then resets once staging settles", async () => {
    // Attempt 1 drifts (A→B); attempt 2 is stable (B→B).
    const { octokit, updateRef } = makeOctokit(["SHA_A", "SHA_B", "SHA_B", "SHA_B"]);

    await autoPublishSite(octokit, REPO, DOMAIN, BRANCH);

    expect(mockCommitBatch).toHaveBeenCalledTimes(2);
    expect(updateRef).toHaveBeenCalledTimes(1);
    expect(mockDeleteStagingArticles).toHaveBeenCalledTimes(1);
  });

  it("still publishes the late commit's content to main on the re-copy", async () => {
    const { octokit } = makeOctokit(["SHA_A", "SHA_B", "SHA_B", "SHA_B"]);
    // Second pass sees the image frontmatter the callback just committed.
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (!path.endsWith(".md")) return "site: config";
      return mockCommitBatch.mock.calls.length === 0
        ? "---\ntitle: Dante\nfeaturedImage: /assets/images/dogslabs-general-article.webp\n---\nbody"
        : "---\ntitle: Dante\nfeaturedImage: /assets/images/dante-rare-chimera-dog.webp\n---\nbody";
    });

    await autoPublishSite(octokit, REPO, DOMAIN, BRANCH);

    const lastBatch = mockCommitBatch.mock.calls.at(-1)?.[2] as Array<{ path: string; content: string }>;
    const article = lastBatch.find((f) => f.path.endsWith(".md"));
    expect(article?.content).toContain("dante-rare-chimera-dog.webp");
    expect(article?.content).not.toContain("general-article");
  });

  it("returns early without touching refs when the site dir is empty", async () => {
    mockListFiles.mockResolvedValue([]);
    const { octokit, updateRef } = makeOctokit(["SHA_A"]);

    await autoPublishSite(octokit, REPO, DOMAIN, BRANCH);

    expect(mockCommitBatch).not.toHaveBeenCalled();
    expect(updateRef).not.toHaveBeenCalled();
  });
});
