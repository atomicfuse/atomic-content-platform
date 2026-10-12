import { describe, expect, it } from "vitest";
import { portraitKeysOf } from "../portrait-cleanup";

describe("portraitKeysOf", () => {
  it("picks only this author's content-hashed portraits, not a longer id sharing the prefix", () => {
    const keys = [
      "authors/assets/ann-lee-0123456789.webp",
      "authors/assets/ann-lee-abcdef0123.webp",
      "authors/assets/ann-lee-2-0123456789.webp",
      "authors/assets/ann-leer-0123456789.webp",
    ];
    expect(portraitKeysOf("ann-lee", keys)).toEqual(["authors/assets/ann-lee-0123456789.webp", "authors/assets/ann-lee-abcdef0123.webp"]);
  });
});
