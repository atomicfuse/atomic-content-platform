import { describe, it, expect } from "vitest";
import { buildR2Key } from "../../lib/r2-upload.js";

describe("buildR2Key", () => {
  it("builds a key with webp extension", () => {
    expect(buildR2Key("tvshowbox", "my-article-slug", "webp")).toBe(
      "tvshowbox/assets/images/my-article-slug.webp"
    );
  });

  it("builds a key with png extension", () => {
    expect(buildR2Key("tvshowbox", "best-movies-2026", "png")).toBe(
      "tvshowbox/assets/images/best-movies-2026.png"
    );
  });

  it("builds a key with jpg extension", () => {
    expect(buildR2Key("scienceworld", "quantum-computing-intro", "jpg")).toBe(
      "scienceworld/assets/images/quantum-computing-intro.jpg"
    );
  });
});
