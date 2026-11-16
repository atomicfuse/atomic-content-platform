import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";
import { parseFrontmatter } from "../lib/frontmatter.js";

const ARTICLE = [
  "---",
  "title: 'Eat Paleo, Age Better'",
  "slug: eat-paleo-age-better",
  "featuredImage: /assets/images/bestpaleosecrets-general-article.webp",
  "tags:",
  "  - paleo",
  "  - longevity",
  "---",
  "",
  "Body paragraph.",
  "",
].join("\n");

describe("parseFrontmatter", () => {
  it("returns an independent data object for identical text (mutating one never leaks into the next)", () => {
    const first = parseFrontmatter(ARTICLE);
    first.data["featuredImage"] = "/assets/images/hero.webp";

    const second = parseFrontmatter(ARTICLE);

    expect(second.data.featuredImage).toBe("/assets/images/bestpaleosecrets-general-article.webp");
    expect(second.data).not.toBe(first.data);
  });

  it("parses exactly like gray-matter", () => {
    const ours = parseFrontmatter(ARTICLE);
    const theirs = matter(ARTICLE + "\n"); // distinct text so this check never reads a cached entry
    expect(ours.data).toEqual(theirs.data);
    expect(ours.content.trim()).toBe(theirs.content.trim());
  });

  it("does not add entries to gray-matter's process-wide cache", () => {
    const text = `${ARTICLE}\n<!-- ${Date.now()} -->\n`;
    parseFrontmatter(text);
    // `cache` exists at runtime but is missing from gray-matter's type definitions.
    const { cache } = matter as unknown as { cache: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(cache, text)).toBe(false);
  });

  it("returns empty data for text without frontmatter", () => {
    expect(parseFrontmatter("just a body\n").data).toEqual({});
    expect(parseFrontmatter("").data).toEqual({});
  });
});

/** All non-test .ts files under src/. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

describe("frontmatter parsing guard", () => {
  it("routes every parse through parseFrontmatter (a bare matter() call shares gray-matter's mutable cache)", () => {
    const srcDir = join(__dirname, "..");
    const offenders = sourceFiles(srcDir)
      .filter((f) => !f.endsWith(join("lib", "frontmatter.ts")))
      // `matter(` not preceded by an identifier char or a property dot — but a spread `...matter(` counts.
      .filter((f) => /(?<![\w.])matter\(|\.\.\.matter\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
