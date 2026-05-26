import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeArticle, writeAsset, type WriterConfig } from "../lib/writer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const mockOctokit = {
  repos: {},
};

const mockUploadToR2 = vi.fn().mockResolvedValue(true);

vi.mock("node:fs/promises");
vi.mock("../lib/github.js", () => {
  const mock = vi.fn(() => mockOctokit);
  return {
    createOctokit: mock,
    createGitHubClient: mock,
    commitFile: vi.fn().mockResolvedValue("abc123"),
    parseRepo: vi.fn((repo: string) => {
      const [owner, repoName] = repo.split("/");
      return { owner, repo: repoName };
    }),
  };
});
vi.mock("../lib/r2-upload.js", () => ({
  uploadToR2: (...args: unknown[]): unknown => mockUploadToR2(...args),
}));

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadToR2.mockResolvedValue(true);
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

  it("uploads asset to R2 with the correct key", async () => {
    const data = Buffer.from("fake-image-bytes");
    await writeAsset(config, "coolnews.dev", "images/hero.png", data);

    expect(mockUploadToR2).toHaveBeenCalledWith(
      "coolnews.dev/images/hero.png",
      data,
    );
  });

  it("passes raw Buffer to R2 without encoding", async () => {
    const data = Buffer.from("binary\x00data\xff");
    await writeAsset(config, "coolnews.dev", "images/test.png", data);

    const [r2Key, uploadedData] = mockUploadToR2.mock.calls[0]!;
    expect(r2Key).toBe("coolnews.dev/images/test.png");
    expect(uploadedData).toBe(data);
  });
});
