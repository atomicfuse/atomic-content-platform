import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeArticle, type WriterConfig } from "../lib/writer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises");
vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => ({})),
  commitFile: vi.fn().mockResolvedValue("abc123"),
}));

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
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
