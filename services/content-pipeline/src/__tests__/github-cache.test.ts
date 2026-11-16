import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRef = vi.fn();
const mockGetTree = vi.fn();
const mockGetBlob = vi.fn();
const mockGetContent = vi.fn();

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
    };
    repos = {
      getContent: mockGetContent,
    };
    static plugin() {
      return MockOctokit;
    }
  }
  return { Octokit: MockOctokit };
});

function b64(text: string): string {
  return Buffer.from(text).toString("base64");
}

/** GitHub's contents API wraps base64 at 60 chars with newlines. */
function wrappedB64(text: string): string {
  return (b64(text).match(/.{1,60}/g) ?? []).join("\n");
}

function fileResponse(text: string, sha = "sha-1"): { data: Record<string, unknown> } {
  return {
    data: { type: "file", encoding: "base64", content: wrappedB64(text), sha, size: text.length },
  };
}

function notFound(): Error & { status: number } {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

describe("readFile reads a single file by path (no repo tree)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses the contents API with path + branch and never downloads a tree", async () => {
    mockGetContent.mockResolvedValue(fileResponse("domain: cozysupper\n"));
    const { readFile, createOctokit } = await import("../lib/github.js");

    const text = await readFile(createOctokit("t"), "owner/repo", "sites/cozysupper/site.yaml", "staging/cozysupper");

    expect(text).toBe("domain: cozysupper\n");
    expect(mockGetContent).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      path: "sites/cozysupper/site.yaml",
      ref: "staging/cozysupper",
    });
    expect(mockGetTree).not.toHaveBeenCalled();
    expect(mockGetRef).not.toHaveBeenCalled();
  });

  it("defaults to main when no branch is given", async () => {
    mockGetContent.mockResolvedValue(fileResponse("x"));
    const { readFile, createOctokit } = await import("../lib/github.js");

    await readFile(createOctokit("t"), "owner/repo", "org.yaml");

    expect(mockGetContent).toHaveBeenCalledWith(expect.objectContaining({ ref: "main" }));
  });

  it("decodes multi-byte UTF-8 correctly across wrapped base64 lines", async () => {
    const text = "שלום — café ✓ ".repeat(20);
    mockGetContent.mockResolvedValue(fileResponse(text));
    const { readFile, createOctokit } = await import("../lib/github.js");

    expect(await readFile(createOctokit("t"), "owner/repo", "a.md")).toBe(text);
  });

  it("maps a 404 to the existing 'Expected file at …, got nothing' error", async () => {
    mockGetContent.mockRejectedValue(notFound());
    const { readFile, createOctokit } = await import("../lib/github.js");

    await expect(readFile(createOctokit("t"), "owner/repo", "sites/x/missing.md", "main")).rejects.toThrow(
      /^Expected file at sites\/x\/missing\.md, got nothing$/,
    );
  });

  it("treats a directory path as a missing file", async () => {
    mockGetContent.mockResolvedValue({ data: [{ type: "file", path: "sites/x/a.md" }] });
    const { readFile, createOctokit } = await import("../lib/github.js");

    await expect(readFile(createOctokit("t"), "owner/repo", "sites/x")).rejects.toThrow(
      /^Expected file at sites\/x, got nothing$/,
    );
  });

  it("propagates non-404 errors unchanged", async () => {
    const boom = Object.assign(new Error("Server Error"), { status: 502 });
    mockGetContent.mockRejectedValue(boom);
    const { readFile, createOctokit } = await import("../lib/github.js");

    await expect(readFile(createOctokit("t"), "owner/repo", "a.md")).rejects.toBe(boom);
  });

  it("falls back to the blob API for files over 1MB (contents API omits the body)", async () => {
    mockGetContent.mockResolvedValue({
      data: { type: "file", encoding: "none", content: "", sha: "big-sha", size: 2_000_000 },
    });
    mockGetBlob.mockResolvedValue({ data: { content: wrappedB64("large body") } });
    const { readFile, createOctokit } = await import("../lib/github.js");

    expect(await readFile(createOctokit("t"), "owner/repo", "big.json")).toBe("large body");
    expect(mockGetBlob).toHaveBeenCalledWith({ owner: "owner", repo: "repo", file_sha: "big-sha" });
  });

  it("readFileBase64 returns the exact bytes as unwrapped base64", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    mockGetContent.mockResolvedValue({
      data: { type: "file", encoding: "base64", content: bytes.toString("base64"), sha: "png", size: bytes.length },
    });
    const { readFileBase64, createOctokit } = await import("../lib/github.js");

    const out = await readFileBase64(createOctokit("t"), "owner/repo", "sites/x/logo.png", "staging/x");
    expect(Buffer.from(out, "base64").equals(bytes)).toBe(true);
    expect(out).not.toContain("\n");
  });
});

describe("tree cache (directory listings) is bounded", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetRef.mockResolvedValue({ data: { object: { sha: "ref" } } });
    mockGetTree.mockImplementation(() =>
      Promise.resolve({ data: { truncated: false, tree: [{ path: "sites/s/articles/a.md", type: "blob", sha: "a" }] } }),
    );
  });

  it("caches a branch tree between listings", async () => {
    const { listFiles, createOctokit } = await import("../lib/github.js");
    const octokit = createOctokit("t");

    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/s");
    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/s");

    expect(mockGetTree).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used branch beyond TREE_CACHE_MAX", async () => {
    const { listFiles, createOctokit, TREE_CACHE_MAX } = await import("../lib/github.js");
    const octokit = createOctokit("t");

    for (let i = 0; i <= TREE_CACHE_MAX; i++) {
      await listFiles(octokit, "owner/repo", "sites/s/articles", `staging/site-${i}`);
    }
    expect(mockGetTree).toHaveBeenCalledTimes(TREE_CACHE_MAX + 1);

    // site-0 was the oldest and must have been evicted → refetch.
    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/site-0");
    expect(mockGetTree).toHaveBeenCalledTimes(TREE_CACHE_MAX + 2);

    // The newest one is still cached.
    await listFiles(octokit, "owner/repo", "sites/s/articles", `staging/site-${TREE_CACHE_MAX}`);
    expect(mockGetTree).toHaveBeenCalledTimes(TREE_CACHE_MAX + 2);
  });

  it("a cache hit refreshes recency so a hot branch is not evicted", async () => {
    const { listFiles, createOctokit, TREE_CACHE_MAX } = await import("../lib/github.js");
    const octokit = createOctokit("t");

    await listFiles(octokit, "owner/repo", "sites/s/articles", "main");
    for (let i = 1; i < TREE_CACHE_MAX; i++) {
      await listFiles(octokit, "owner/repo", "sites/s/articles", `staging/site-${i}`);
    }
    // Touch main, then add one more branch → the oldest non-main entry goes.
    await listFiles(octokit, "owner/repo", "sites/s/articles", "main");
    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/extra");
    const callsBefore = mockGetTree.mock.calls.length;

    await listFiles(octokit, "owner/repo", "sites/s/articles", "main");
    expect(mockGetTree).toHaveBeenCalledTimes(callsBefore);
  });

  it("clearTreeCache(branch) only evicts that branch", async () => {
    const { listFiles, createOctokit, clearTreeCache } = await import("../lib/github.js");
    const octokit = createOctokit("t");

    await listFiles(octokit, "owner/repo", "sites/s/articles", "main");
    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/s1");
    clearTreeCache("staging/s1");

    await listFiles(octokit, "owner/repo", "sites/s/articles", "main");
    expect(mockGetTree).toHaveBeenCalledTimes(2);
    await listFiles(octokit, "owner/repo", "sites/s/articles", "staging/s1");
    expect(mockGetTree).toHaveBeenCalledTimes(3);
  });
});
