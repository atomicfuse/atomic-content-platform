import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRef = vi.fn();
const mockGetTree = vi.fn();
const mockGetBlob = vi.fn();
const mockCreateRef = vi.fn();
const mockCreateTree = vi.fn();
const mockCreateCommit = vi.fn();
const mockUpdateRef = vi.fn();
const mockCreateBlob = vi.fn();

vi.mock("@octokit/plugin-retry", () => ({ retry: (cls: unknown) => cls }));
vi.mock("@octokit/plugin-throttling", () => ({
  throttling: (cls: unknown) => cls,
}));
vi.mock("@octokit/rest", () => {
  class MockOctokit {
    git = {
      getRef: mockGetRef,
      getTree: mockGetTree,
      getBlob: mockGetBlob,
      createRef: mockCreateRef,
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

describe("blob cache in readFile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function setupMocks(sha = "abc123", fileContent = "hello world"): void {
    mockGetRef.mockResolvedValue({
      data: { object: { sha: "tree-root-sha" } },
    });
    mockGetTree.mockResolvedValue({
      data: {
        truncated: false,
        tree: [{ path: "sites/test/site.yaml", type: "blob", sha }],
      },
    });
    mockGetBlob.mockResolvedValue({
      data: {
        content: Buffer.from(fileContent).toString("base64"),
      },
    });
  }

  it("second read of same SHA does not call getBlob again", async () => {
    setupMocks("sha-same", "content-a");

    const { readFile, createOctokit, clearTreeCache, clearBlobCache } =
      await import("../lib/github.js");

    const octokit = createOctokit("fake-token");

    const first = await readFile(
      octokit,
      "owner/repo",
      "sites/test/site.yaml",
    );
    expect(first).toBe("content-a");
    expect(mockGetBlob).toHaveBeenCalledTimes(1);

    const second = await readFile(
      octokit,
      "owner/repo",
      "sites/test/site.yaml",
    );
    expect(second).toBe("content-a");
    expect(mockGetBlob).toHaveBeenCalledTimes(1);

    // cleanup
    clearTreeCache();
    clearBlobCache();
  });

  it("different SHA triggers a new getBlob call", async () => {
    const { readFile, createOctokit, clearTreeCache, clearBlobCache } =
      await import("../lib/github.js");

    // First file with sha-1
    mockGetRef.mockResolvedValue({
      data: { object: { sha: "tree-root-sha" } },
    });
    mockGetTree.mockResolvedValue({
      data: {
        truncated: false,
        tree: [{ path: "sites/test/site.yaml", type: "blob", sha: "sha-1" }],
      },
    });
    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("content-1").toString("base64") },
    });

    const octokit = createOctokit("fake-token");
    const first = await readFile(
      octokit,
      "owner/repo",
      "sites/test/site.yaml",
    );
    expect(first).toBe("content-1");
    expect(mockGetBlob).toHaveBeenCalledTimes(1);

    // Clear tree cache so it re-fetches with different SHA
    clearTreeCache();
    mockGetTree.mockResolvedValue({
      data: {
        truncated: false,
        tree: [{ path: "sites/test/site.yaml", type: "blob", sha: "sha-2" }],
      },
    });
    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("content-2").toString("base64") },
    });

    const second = await readFile(
      octokit,
      "owner/repo",
      "sites/test/site.yaml",
    );
    expect(second).toBe("content-2");
    expect(mockGetBlob).toHaveBeenCalledTimes(2);

    clearTreeCache();
    clearBlobCache();
  });

  it("clearBlobCache forces re-fetch", async () => {
    setupMocks("sha-clear", "original");

    const { readFile, createOctokit, clearTreeCache, clearBlobCache } =
      await import("../lib/github.js");

    const octokit = createOctokit("fake-token");

    await readFile(octokit, "owner/repo", "sites/test/site.yaml");
    expect(mockGetBlob).toHaveBeenCalledTimes(1);

    clearBlobCache();

    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("updated").toString("base64") },
    });

    const result = await readFile(
      octokit,
      "owner/repo",
      "sites/test/site.yaml",
    );
    expect(result).toBe("updated");
    expect(mockGetBlob).toHaveBeenCalledTimes(2);

    clearTreeCache();
    clearBlobCache();
  });
});
