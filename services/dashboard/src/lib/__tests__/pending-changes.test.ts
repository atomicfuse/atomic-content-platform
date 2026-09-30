import { describe, it, expect } from "vitest";
import {
  summarisePendingFiles,
  unconfirmedDeletions,
  GITHUB_COMPARE_FILE_CAP,
  type CompareFile,
} from "@/lib/pending-changes";

function file(filename: string, status: string, previous_filename?: string): CompareFile {
  return previous_filename ? { filename, status, previous_filename } : { filename, status };
}

describe("summarisePendingFiles", () => {
  it("counts added, modified and removed files for the domain", () => {
    const summary = summarisePendingFiles("coolnews", [
      file("sites/coolnews/site.yaml", "modified"),
      file("sites/coolnews/articles/a.md", "added"),
      file("sites/coolnews/articles/b.md", "added"),
      file("sites/coolnews/assets/logo.png", "changed"),
      file("sites/coolnews/articles/old.md", "removed"),
    ]);
    expect(summary.added).toBe(2);
    expect(summary.modified).toBe(2);
    expect(summary.removed).toBe(1);
    expect(summary.files).toHaveLength(5);
    expect(summary.files[0]).toEqual({ filename: "sites/coolnews/site.yaml", status: "modified" });
    expect(summary.truncated).toBe(false);
  });

  it("lists slugs of removed article markdown files as deletedArticles", () => {
    const summary = summarisePendingFiles("coolnews", [
      file("sites/coolnews/articles/gone-one.md", "removed"),
      file("sites/coolnews/articles/gone-two.md", "removed"),
      file("sites/coolnews/assets/images/gone-one.webp", "removed"),
      file("sites/coolnews/articles/kept.md", "modified"),
    ]);
    expect(summary.deletedArticles).toEqual(["gone-one", "gone-two"]);
    expect(summary.removed).toBe(3);
  });

  it("ignores files that belong to other domains (including prefix look-alikes)", () => {
    const summary = summarisePendingFiles("coolnews", [
      file("sites/coolnews/site.yaml", "modified"),
      file("sites/othersite/articles/x.md", "removed"),
      file("sites/coolnews.com/site.yaml", "modified"),
      file("dashboard-index.yaml", "modified"),
    ]);
    expect(summary.files.map((f) => f.filename)).toEqual(["sites/coolnews/site.yaml"]);
    expect(summary.deletedArticles).toEqual([]);
    expect(summary.removed).toBe(0);
  });

  it("counts renames as modified and treats a renamed-away article slug as deleted", () => {
    const summary = summarisePendingFiles("coolnews", [
      file("sites/coolnews/articles/new-slug.md", "renamed", "sites/coolnews/articles/old-slug.md"),
    ]);
    expect(summary.modified).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.files[0]?.status).toBe("renamed");
    expect(summary.deletedArticles).toEqual(["old-slug"]);
  });

  it("flags truncated when GitHub returned its 300-file cap (counting all files, not just this domain)", () => {
    const files: CompareFile[] = [];
    for (let i = 0; i < GITHUB_COMPARE_FILE_CAP - 1; i++) {
      files.push(file(`sites/other/articles/a-${i}.md`, "added"));
    }
    files.push(file("sites/coolnews/site.yaml", "modified"));
    expect(files).toHaveLength(300);
    const summary = summarisePendingFiles("coolnews", files);
    expect(summary.truncated).toBe(true);
    expect(summary.files).toHaveLength(1);

    const under = summarisePendingFiles("coolnews", files.slice(1));
    expect(under.truncated).toBe(false);
  });
});

describe("unconfirmedDeletions", () => {
  it("returns only fresh deletions that were not in the reviewed list", () => {
    expect(unconfirmedDeletions(["a", "b"], ["a", "b"])).toEqual([]);
    expect(unconfirmedDeletions(["a"], ["a", "c"])).toEqual(["c"]);
    expect(unconfirmedDeletions([], [])).toEqual([]);
    // Fewer deletions than reviewed is fine (nothing new to confirm).
    expect(unconfirmedDeletions(["a", "b"], ["b"])).toEqual([]);
  });
});
