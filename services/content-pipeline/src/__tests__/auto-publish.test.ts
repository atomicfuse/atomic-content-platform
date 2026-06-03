import { describe, it, expect, vi } from "vitest";
import { shouldAutoPublish, isBinaryPath, collectFilesForPublish } from "../queue/scheduler-flow.js";
import type { SiteRunResult } from "../agents/scheduled-publisher/history.js";

describe("shouldAutoPublish", () => {
  it("returns true for live site with successful articles", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "success",
      articlesCreated: 3,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(true);
  });

  it("returns true for live site with partial success", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "partial",
      articlesCreated: 1,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(true);
  });

  it("returns false for non-live site", () => {
    const result: SiteRunResult = {
      domain: "chaibeseret",
      status: "success",
      articlesCreated: 2,
      articlesRequested: 2,
    };
    expect(shouldAutoPublish(result, "staging")).toBe(false);
  });

  it("returns false for live site with zero articles created", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "no_content",
      articlesCreated: 0,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(false);
  });

  it("returns false for errored site", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "error",
      articlesCreated: 0,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(false);
  });

  it("returns true for ready site (treated as live)", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "success",
      articlesCreated: 2,
      articlesRequested: 2,
    };
    expect(shouldAutoPublish(result, "ready")).toBe(false);
  });
});

describe("isBinaryPath", () => {
  it("classifies image/font assets as binary", () => {
    for (const p of [
      "sites/x/assets/logo.png",
      "sites/x/assets/favicon.ICO",
      "sites/x/assets/hero.jpeg",
      "sites/x/assets/icon.svg",
      "sites/x/assets/font.woff2",
    ]) {
      expect(isBinaryPath(p)).toBe(true);
    }
  });

  it("classifies text/content files as non-binary", () => {
    for (const p of [
      "sites/x/site.yaml",
      "sites/x/articles/my-post.md",
      "sites/x/data.json",
      "sites/x/README",
    ]) {
      expect(isBinaryPath(p)).toBe(false);
    }
  });
});

describe("collectFilesForPublish (binary-safe auto-publish)", () => {
  it("routes binary assets to base64 blobs and text to inline content", async () => {
    const paths = [
      "sites/x/articles/post.md",
      "sites/x/site.yaml",
      "sites/x/assets/logo.png",
      "sites/x/assets/favicon.png",
    ];
    const readText = vi.fn(async (p: string) => `text:${p}`);
    const readBinaryBase64 = vi.fn(async (p: string) => `b64:${p}`);

    const { files, binaryFiles } = await collectFilesForPublish(paths, readText, readBinaryBase64);

    // logo.png + favicon.png must NOT go through the UTF-8 text reader —
    // that is the exact path that corrupted every site logo.
    expect(readText).not.toHaveBeenCalledWith("sites/x/assets/logo.png");
    expect(readBinaryBase64).toHaveBeenCalledWith("sites/x/assets/logo.png");

    expect(files.map((f) => f.path).sort()).toEqual([
      "sites/x/articles/post.md",
      "sites/x/site.yaml",
    ]);
    expect(binaryFiles.map((f) => f.path).sort()).toEqual([
      "sites/x/assets/favicon.png",
      "sites/x/assets/logo.png",
    ]);
    expect(binaryFiles.find((f) => f.path.endsWith("logo.png"))?.base64).toBe("b64:sites/x/assets/logo.png");
  });
});
