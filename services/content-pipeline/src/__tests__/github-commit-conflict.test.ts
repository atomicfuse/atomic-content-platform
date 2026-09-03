import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRef = vi.fn();
const mockGetCommit = vi.fn();
const mockCreateTree = vi.fn();
const mockCreateCommit = vi.fn();
const mockUpdateRef = vi.fn();
const mockCreateBlob = vi.fn();

vi.mock("@octokit/plugin-retry", () => ({ retry: (cls: unknown) => cls }));
vi.mock("@octokit/plugin-throttling", () => ({ throttling: (cls: unknown) => cls }));
vi.mock("@octokit/rest", () => {
  class MockOctokit {
    git = {
      getRef: mockGetRef,
      getCommit: mockGetCommit,
      createTree: mockCreateTree,
      createCommit: mockCreateCommit,
      updateRef: mockUpdateRef,
      createBlob: mockCreateBlob,
    };
    static plugin() {
      return MockOctokit;
    }
  }
  return { Octokit: MockOctokit };
});

/** Build a GitHub-style non-fast-forward error (HTTP 422). */
function nonFastForwardError(): Error & { status: number } {
  const err = new Error(
    "Update is not a fast forward - https://docs.github.com/rest/git/refs#update-a-reference",
  ) as Error & { status: number };
  err.status = 422;
  return err;
}

describe("commitBatch — non-fast-forward conflict recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function wireRefAtSha(sha: string): void {
    mockGetRef.mockResolvedValue({ data: { object: { sha } } });
    mockGetCommit.mockResolvedValue({ data: { tree: { sha: `tree-of-${sha}` } } });
    mockCreateTree.mockImplementation(async (args: { base_tree: string }) => ({
      data: { sha: `newtree-from-${args.base_tree}` },
    }));
    mockCreateCommit.mockResolvedValue({ data: { sha: "new-commit-sha" } });
  }

  it("re-reads the ref and retries when updateRef returns 'not a fast forward'", async () => {
    const { commitBatch, createOctokit, clearTreeCache } = await import("../lib/github.js");

    // First the branch head is at base-1; another writer advances it to base-2
    // between our read and our updateRef, so the first updateRef is rejected.
    mockGetRef
      .mockResolvedValueOnce({ data: { object: { sha: "base-1" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "base-2" } } });
    mockGetCommit.mockImplementation(async (args: { commit_sha: string }) => ({
      data: { tree: { sha: `tree-of-${args.commit_sha}` } },
    }));
    mockCreateTree.mockImplementation(async (args: { base_tree: string }) => ({
      data: { sha: `newtree-from-${args.base_tree}` },
    }));
    mockCreateCommit.mockResolvedValue({ data: { sha: "final-commit-sha" } });
    mockUpdateRef
      .mockRejectedValueOnce(nonFastForwardError())
      .mockResolvedValueOnce({ data: {} });

    const octokit = createOctokit("fake-token");
    const sha = await commitBatch(
      octokit,
      "owner/repo",
      [{ path: "sites/x/articles/a.md", content: "hi" }],
      [],
      "feat: add a",
      "staging/x",
    );

    expect(sha).toBe("final-commit-sha");
    // It re-read the ref (2 getRef calls) and retried updateRef (2 calls).
    expect(mockGetRef).toHaveBeenCalledTimes(2);
    expect(mockUpdateRef).toHaveBeenCalledTimes(2);
    // The retry rebuilt the tree on the NEW base (base-2), not the stale one.
    expect(mockCreateTree).toHaveBeenLastCalledWith(
      expect.objectContaining({ base_tree: "tree-of-base-2" }),
    );

    clearTreeCache();
  });

  it("succeeds on the first try without re-reading when there is no conflict", async () => {
    const { commitBatch, createOctokit, clearTreeCache } = await import("../lib/github.js");

    wireRefAtSha("base-1");
    mockUpdateRef.mockResolvedValue({ data: {} });

    const octokit = createOctokit("fake-token");
    await commitBatch(
      octokit,
      "owner/repo",
      [{ path: "sites/x/articles/a.md", content: "hi" }],
      [],
      "feat: add a",
      "staging/x",
    );

    expect(mockGetRef).toHaveBeenCalledTimes(1);
    expect(mockUpdateRef).toHaveBeenCalledTimes(1);

    clearTreeCache();
  });

  it("gives up after exhausting retries on persistent conflict", async () => {
    const { commitBatch, createOctokit, clearTreeCache } = await import("../lib/github.js");

    wireRefAtSha("base-1");
    mockUpdateRef.mockRejectedValue(nonFastForwardError());

    const octokit = createOctokit("fake-token");
    await expect(
      commitBatch(
        octokit,
        "owner/repo",
        [{ path: "sites/x/articles/a.md", content: "hi" }],
        [],
        "feat: add a",
        "staging/x",
      ),
    ).rejects.toThrow(/fast forward/i);

    // More than one attempt was made.
    expect(mockUpdateRef.mock.calls.length).toBeGreaterThan(1);

    clearTreeCache();
  });

  it("serializes concurrent commits to the same branch (no in-process race)", async () => {
    const { commitBatch, createOctokit, clearTreeCache } = await import("../lib/github.js");

    let inFlight = 0;
    let maxInFlight = 0;
    mockGetRef.mockResolvedValue({ data: { object: { sha: "base-1" } } });
    mockGetCommit.mockResolvedValue({ data: { tree: { sha: "tree-of-base-1" } } });
    mockCreateTree.mockResolvedValue({ data: { sha: "new-tree" } });
    mockCreateCommit.mockResolvedValue({ data: { sha: "new-commit" } });
    mockUpdateRef.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: {} };
    });

    const octokit = createOctokit("fake-token");
    await Promise.all([
      commitBatch(octokit, "owner/repo", [{ path: "a.md", content: "1" }], [], "m1", "staging/x"),
      commitBatch(octokit, "owner/repo", [{ path: "b.md", content: "2" }], [], "m2", "staging/x"),
      commitBatch(octokit, "owner/repo", [{ path: "c.md", content: "3" }], [], "m3", "staging/x"),
    ]);

    // Per-branch serialization means updateRef never overlaps for the same branch.
    expect(maxInFlight).toBe(1);

    clearTreeCache();
  });
});
