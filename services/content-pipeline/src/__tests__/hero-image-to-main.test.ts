import { afterEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import matter from "gray-matter";
import { applyHeroImagesToMain, heroImageUpdateForMain } from "../agents/content-generation/hero-image-main.js";

const mockReadFile = vi.fn();
const mockCommitBatch = vi.fn();

vi.mock("../lib/github.js", () => ({
  clearTreeCache: (): void => {},
  readFile: (...args: unknown[]): unknown => mockReadFile(...args),
  commitBatch: (...args: unknown[]): unknown => mockCommitBatch(...args),
}));

vi.mock("../lib/db/articles.js", () => ({
  upsertArticleMeta: (): Promise<void> => Promise.resolve(),
}));

const mainDoc = (featured: string, extra = ""): string =>
  `---\ntitle: Luxor\nslug: luxor\nfeaturedImage: ${featured}\n${extra}---\n\nPublished body.\n`;
const HERO = "/assets/images/luxor.webp";

describe("heroImageUpdateForMain", () => {
  it("swaps the default image for the hero image on the published copy, keeping everything else", () => {
    const out = heroImageUpdateForMain(mainDoc("/assets/images/hiddenstorydaily-general-article.webp", "tags:\n  - A\n"), HERO, "Tomb near Luxor");
    expect(out).not.toBeNull();
    const parsed = matter(out!);
    expect(parsed.data.featuredImage).toBe(HERO);
    expect(parsed.data.image_alt).toBe("Tomb near Luxor");
    expect(parsed.data.tags).toEqual(["A"]);
    expect(parsed.content.trim()).toBe("Published body.");
  });
  it("leaves production alone when it already has this image", () => {
    expect(heroImageUpdateForMain(mainDoc(HERO), HERO, "x")).toBeNull();
  });
  it("never overwrites a non-default image someone chose for production", () => {
    expect(heroImageUpdateForMain(mainDoc("/assets/images/hand-picked.webp"), HERO, "x")).toBeNull();
  });
  it("treats a missing featuredImage as default (fill it in)", () => {
    expect(matter(heroImageUpdateForMain("---\ntitle: T\n---\nbody\n", HERO, "x")!).data.featuredImage).toBe(HERO);
  });

  // Production 2026-11-16: 354 of 355 hero images never reached main. The image callback parses the
  // staging article (byte-identical to main before the image) and mutates `data.featuredImage`;
  // gray-matter's cache then handed that same mutated object to this function, which saw "already
  // has this image" and skipped the commit without a log line.
  it("still updates main after the staging callback parsed and mutated the identical text", () => {
    const sharedText = mainDoc("/assets/images/bestpaleosecrets-general-article.webp", "tags:\n  - cache\n");
    const staging = matter(sharedText); // what the n8n callback did before the fix (default, cached parse)
    staging.data["featuredImage"] = HERO;

    const out = heroImageUpdateForMain(sharedText, HERO, "alt");

    expect(out).not.toBeNull();
    expect(matter(out! + "\n").data.featuredImage).toBe(HERO);
  });
});

describe("applyHeroImagesToMain", () => {
  const octokit = {} as Octokit;
  const image = { siteDomain: "s", slug: "luxor", imageUrl: HERO, altText: "alt" };

  afterEach(() => {
    vi.restoreAllMocks();
    mockReadFile.mockReset();
    mockCommitBatch.mockReset();
  });

  it("commits the hero image to main when main still shows the default image", async () => {
    mockReadFile.mockResolvedValue(mainDoc("/assets/images/s-general-article.webp"));
    mockCommitBatch.mockResolvedValue(undefined);

    await applyHeroImagesToMain(octokit, "o/r", [image]);

    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
    const [, , files, , , branch] = mockCommitBatch.mock.calls[0] as [unknown, unknown, Array<{ path: string; content: string }>, unknown, unknown, string];
    expect(branch).toBe("main");
    expect(files[0]?.path).toBe("sites/s/articles/luxor.md");
    expect(files[0]?.content).toContain(`featuredImage: ${HERO}`);
  });

  it("stays quiet when the article is not on main yet (not published)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadFile.mockRejectedValue(new Error("Expected file at sites/s/articles/luxor.md, got nothing"));

    await applyHeroImagesToMain(octokit, "o/r", [image]);

    expect(mockCommitBatch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs any other read failure instead of swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReadFile.mockRejectedValue(new Error("GitHub 502"));

    await applyHeroImagesToMain(octokit, "o/r", [image]);

    expect(mockCommitBatch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sites/s/articles/luxor.md"), "GitHub 502");
  });
});
