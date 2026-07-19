import { describe, it, expect, vi } from "vitest";
import { shouldAutoPublish, isBinaryPath, isImageAsset, isArticleMarkdownPath, collectFilesForPublish } from "../queue/scheduler-flow.js";
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

describe("isArticleMarkdownPath", () => {
  it("matches only .md files under /articles/", () => {
    expect(isArticleMarkdownPath("sites/x/articles/post.md")).toBe(true);
    expect(isArticleMarkdownPath("sites/x/articles/nested/deep-post.md")).toBe(true);
  });

  it("rejects placeholder and non-markdown files under /articles/", () => {
    // .gitkeep was being upserted into Mongo as an article with slug ".gitkeep"
    expect(isArticleMarkdownPath("sites/x/articles/.gitkeep")).toBe(false);
    expect(isArticleMarkdownPath("sites/x/articles/image.png")).toBe(false);
    expect(isArticleMarkdownPath("sites/x/site.yaml")).toBe(false);
    expect(isArticleMarkdownPath("sites/x/dedup-index.json")).toBe(false);
  });
});

describe("isImageAsset", () => {
  it("matches image assets that are now R2-native", () => {
    expect(isImageAsset("sites/x/assets/logo.png")).toBe(true);
    expect(isImageAsset("sites/x/assets/favicon.ICO")).toBe(true);
    expect(isImageAsset("sites/x/assets/images/hero.webp")).toBe(true);
    expect(isImageAsset("sites/x/site.yaml")).toBe(false);
    expect(isImageAsset("sites/x/articles/post.md")).toBe(false);
  });
});

describe("collectFilesForPublish (logos are R2-native)", () => {
  it("skips ALL image assets and never reads their bytes", async () => {
    const paths = [
      "sites/x/articles/post.md",
      "sites/x/site.yaml",
      "sites/x/assets/logo.png",
      "sites/x/assets/favicon.png",
      "sites/x/assets/images/hero.webp",
      "sites/x/assets/brand.woff2", // non-image binary still travels as base64
    ];
    const readText = vi.fn(async (p: string) => `text:${p}`);
    const readBinaryBase64 = vi.fn(async (p: string) => `b64:${p}`);

    const { files, binaryFiles } = await collectFilesForPublish(paths, readText, readBinaryBase64);

    // Images must never be read or committed — they live in R2 only. Reading
    // them through git is what corrupted every logo.
    for (const img of ["sites/x/assets/logo.png", "sites/x/assets/favicon.png", "sites/x/assets/images/hero.webp"]) {
      expect(readText).not.toHaveBeenCalledWith(img);
      expect(readBinaryBase64).not.toHaveBeenCalledWith(img);
    }

    expect(files.map((f) => f.path).sort()).toEqual([
      "sites/x/articles/post.md",
      "sites/x/site.yaml",
    ]);
    // Non-image binaries (fonts) still go through the base64 blob path.
    expect(binaryFiles.map((f) => f.path)).toEqual(["sites/x/assets/brand.woff2"]);
  });
});
