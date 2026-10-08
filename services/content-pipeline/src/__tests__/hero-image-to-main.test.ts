import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import { heroImageUpdateForMain } from "../agents/content-generation/hero-image-main.js";

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
});
