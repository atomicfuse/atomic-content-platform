import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readlink, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupAssets } from "../build-site.js";

describe("setupAssets", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "build-site-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates symlink pointing to network assets dir", async () => {
    const networkPath = join(tmp, "network");
    const assetsTarget = join(networkPath, "sites", "test.com", "assets");
    await mkdir(assetsTarget, { recursive: true });
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    await setupAssets(networkPath, "test.com", publicDir);

    const link = await readlink(join(publicDir, "assets"));
    expect(link).toBe(assetsTarget);
  });

  it("replaces an existing symlink", async () => {
    const networkPath = join(tmp, "network");
    const assetsTarget = join(networkPath, "sites", "test.com", "assets");
    await mkdir(assetsTarget, { recursive: true });
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    // Create stale symlink first to verify idempotent replacement
    await symlink("/some/old/path", join(publicDir, "assets"));

    await setupAssets(networkPath, "test.com", publicDir);

    const link = await readlink(join(publicDir, "assets"));
    expect(link).toBe(assetsTarget);
  });

  it("skips symlink creation when assets dir does not exist", async () => {
    const networkPath = join(tmp, "network");
    await mkdir(networkPath, { recursive: true }); // no assets subdir
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    await setupAssets(networkPath, "test.com", publicDir);

    // public/assets should not exist
    await expect(lstat(join(publicDir, "assets"))).rejects.toThrow();
  });
});
