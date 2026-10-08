import { describe, expect, it } from "vitest";
import { versionedAsset } from "../versioned-asset";

describe("versionedAsset", () => {
  it("names the file after its content, so a new logo never overwrites the one production uses", () => {
    const a = versionedAsset("coffeeactually", "logo", Buffer.from("logo-v1"));
    const b = versionedAsset("coffeeactually", "logo", Buffer.from("logo-v2"));
    expect(a.path).toMatch(/^\/assets\/logo-[0-9a-f]{10}\.png$/);
    expect(a.key).toBe(`coffeeactually${a.path}`);
    expect(a.path).not.toBe(b.path);
  });
  it("is stable for the same bytes and supports the footer logo and favicon", () => {
    expect(versionedAsset("s", "logo-footer", Buffer.from("x")).path).toBe(versionedAsset("s", "logo-footer", Buffer.from("x")).path);
    expect(versionedAsset("s", "favicon", Buffer.from("x")).path).toMatch(/^\/assets\/favicon-[0-9a-f]{10}\.png$/);
  });
});
