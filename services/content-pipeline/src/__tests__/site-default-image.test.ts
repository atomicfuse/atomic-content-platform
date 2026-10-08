import { describe, expect, it, vi } from "vitest";
import { createDefaultImageGuard, defaultImageKey, defaultImagePath } from "../lib/site-default-image.js";

const site = { domain: "hiddenstorydaily", siteName: "Hidden Story Daily", vertical: "Mystery", topics: ["Unexplained Events"] };
const deps = (exists: boolean | null) => ({
  exists: vi.fn(async () => exists),
  generate: vi.fn(async () => Buffer.from("img")),
  upload: vi.fn(async () => true),
});

describe("site default image", () => {
  it("uses the site's own key and path", () => {
    expect(defaultImageKey("hiddenstorydaily")).toBe("hiddenstorydaily/assets/images/hiddenstorydaily-general-article.webp");
    expect(defaultImagePath("hiddenstorydaily")).toBe("/assets/images/hiddenstorydaily-general-article.webp");
  });
  it("generates and uploads the image when it is missing", async () => {
    const d = deps(false);
    await createDefaultImageGuard(d).ensure(site);
    expect(d.generate).toHaveBeenCalledWith(site);
    expect(d.upload).toHaveBeenCalledWith("hiddenstorydaily/assets/images/hiddenstorydaily-general-article.webp", Buffer.from("img"));
  });
  it("does nothing when it exists, and checks each site only once per process", async () => {
    const d = deps(true);
    const guard = createDefaultImageGuard(d);
    await guard.ensure(site);
    await guard.ensure(site);
    expect(d.exists).toHaveBeenCalledTimes(1);
    expect(d.generate).not.toHaveBeenCalled();
  });
  it("never throws or blocks an article — storage or AI errors are only logged", async () => {
    const broken = { exists: vi.fn(async () => { throw new Error("r2 down"); }), generate: vi.fn(), upload: vi.fn() };
    await expect(createDefaultImageGuard(broken).ensure(site)).resolves.toBeUndefined();
    const noImage = { ...deps(false), generate: vi.fn(async () => null) };
    await expect(createDefaultImageGuard(noImage).ensure(site)).resolves.toBeUndefined();
    expect(noImage.upload).not.toHaveBeenCalled();
  });
  it("retries a site next time when generation failed", async () => {
    const d = { ...deps(false), generate: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(Buffer.from("img")) };
    const guard = createDefaultImageGuard(d);
    await guard.ensure(site);
    await guard.ensure(site);
    expect(d.upload).toHaveBeenCalledTimes(1);
  });
  it("skips when existence is unknown (no R2 credentials locally)", async () => {
    const d = deps(null);
    await createDefaultImageGuard(d).ensure(site);
    expect(d.generate).not.toHaveBeenCalled();
  });
});
