import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeArticle, writeAsset, type WriterConfig } from "../lib/writer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const mockCreateOrUpdateFileContents = vi.fn().mockResolvedValue({ data: { commit: { sha: "abc123" } } });
const mockGetContent = vi.fn().mockRejectedValue(new Error("Not Found"));

const mockOctokit = {
  repos: {
    getContent: mockGetContent,
    createOrUpdateFileContents: mockCreateOrUpdateFileContents,
  },
};

vi.mock("node:fs/promises");
vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => mockOctokit),
  commitFile: vi.fn().mockResolvedValue("abc123"),
  parseRepo: vi.fn((repo: string) => {
    const [owner, repoName] = repo.split("/");
    return { owner, repo: repoName };
  }),
}));

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset getContent to simulate "file does not exist" by default
  mockGetContent.mockRejectedValue(new Error("Not Found"));
  mockCreateOrUpdateFileContents.mockResolvedValue({ data: { commit: { sha: "abc123" } } });
});

const sampleContent = `---\ntitle: Test\n---\n\nBody`;

describe("writeArticle (local mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: "/tmp/network",
    github: { token: "", repo: "" },
  };

  it("writes file to local filesystem at correct path", async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeArticle(config, "coolnews.dev", "my-slug", sampleContent);

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      path.join("/tmp/network", "sites", "coolnews.dev", "articles", "my-slug.md"),
      sampleContent,
      "utf-8",
    );
  });
});

describe("writeArticle (GitHub mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: undefined,
    github: { token: "token", repo: "owner/repo" },
  };

  it("commits file via GitHub API", async () => {
    const { commitFile } = await import("../lib/github.js");
    await writeArticle(config, "coolnews.dev", "my-slug", sampleContent);

    expect(commitFile).toHaveBeenCalledWith(
      expect.anything(),
      "owner/repo",
      expect.objectContaining({
        path: "sites/coolnews.dev/articles/my-slug.md",
        content: sampleContent,
      }),
    );
  });
});

describe("writeAsset (local mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: "/tmp/network",
    github: { token: "", repo: "" },
  };

  it("writes buffer to local filesystem at correct path", async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    const data = Buffer.from("fake-image-bytes");
    await writeAsset(config, "coolnews.dev", "images/hero.png", data);

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      path.join("/tmp/network", "sites", "coolnews.dev", "images", "hero.png"),
      data,
    );
  });
});

describe("writeAsset (GitHub mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: undefined,
    github: { token: "token", repo: "owner/repo" },
  };

  it("calls Octokit createOrUpdateFileContents with base64-encoded content directly", async () => {
    const data = Buffer.from("fake-image-bytes");
    await writeAsset(config, "coolnews.dev", "images/hero.png", data);

    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        path: "sites/coolnews.dev/images/hero.png",
        content: data.toString("base64"),
      }),
    );
  });

  it("does not double-encode: content passed to Octokit equals data.toString('base64')", async () => {
    const data = Buffer.from("binary\x00data\xff");
    await writeAsset(config, "coolnews.dev", "images/test.png", data);

    const call = mockCreateOrUpdateFileContents.mock.calls[0]![0];
    expect(call.content).toBe(data.toString("base64"));
    // Ensure it was NOT re-encoded (double-encoding would differ)
    expect(call.content).not.toBe(Buffer.from(data.toString("base64")).toString("base64"));
  });
});
