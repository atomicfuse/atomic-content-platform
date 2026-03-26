/**
 * Main build orchestrator for a single site.
 *
 * Reads the network manifest, resolves the full configuration for the
 * requested site domain, then runs each build step:
 *
 *  1. Validate platform version from network.yaml
 *  2. Resolve config (org -> group -> site merge)
 *  3. Check active flag — emit maintenance page if inactive
 *  4. Generate ads.txt -> public/ads.txt
 *  4a. Symlink public/assets -> site assets dir
 *  5. Inject shared legal pages -> src/pages/
 *  6. Log build summary
 *
 * Can be imported as a library or executed directly as a CLI script
 * via `SITE_DOMAIN` and `NETWORK_DATA_PATH` environment variables.
 */

import { readFile, writeFile, mkdir, rm, symlink, stat, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import type { NetworkManifest } from "@atomic-platform/shared-types";

import { resolveConfig } from "./resolve-config.js";
import { generateAdsTxt } from "./generate-ads-txt.js";
import { injectSharedPages } from "./inject-shared-pages.js";

// ---------------------------------------------------------------------------
// ESM __dirname shim
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimal HTML page served when a site is set to active: false. */
const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Site Maintenance</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
    .card { text-align: center; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h1>We'll be back soon</h1>
    <p>This site is currently undergoing maintenance. Please check back later.</p>
  </div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse a YAML file.
 */
async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return parse(raw) as T;
}

/**
 * Ensure a directory exists, then write a file to it.
 */
async function writeFileWithDir(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Symlink public/assets → {networkDataPath}/sites/{siteDomain}/assets/
 *
 * Idempotent: removes any existing symlink/dir at the target path first.
 * Skips gracefully (logs warning) if the source assets dir does not exist.
 *
 * @param networkDataPath - Root of the network data repo
 * @param siteDomain      - Domain slug (e.g. "coolnews.dev")
 * @param publicDir       - Astro public dir (default: process.cwd()/public)
 */
export async function setupAssets(
  networkDataPath: string,
  siteDomain: string,
  publicDir: string = join(process.cwd(), "public"),
): Promise<void> {
  const linkPath = join(publicDir, "assets");
  const targetPath = join(networkDataPath, "sites", siteDomain, "assets");

  // Check target exists before creating symlink (no dangling links)
  try {
    const s = await stat(targetPath);
    if (!s.isDirectory()) {
      console.warn(`[build-site] Assets path exists but is not a directory: ${targetPath} — skipping`);
      return;
    }
  } catch {
    console.warn(`[build-site] No assets directory found for ${siteDomain} — skipping`);
    return;
  }

  // Remove existing path only if it is a symlink (never silently delete real dirs)
  try {
    const existing = await lstat(linkPath);
    if (existing.isSymbolicLink()) {
      await rm(linkPath, { force: true });
    } else {
      throw new Error(
        `[build-site] ${linkPath} exists and is not a symlink — refusing to overwrite. Remove it manually.`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // ENOENT = nothing there, continue
  }

  await symlink(targetPath, linkPath);
  console.log(`[build-site] Assets linked: ${linkPath} → ${targetPath}`);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full build pipeline for a single site.
 *
 * @param networkDataPath - Absolute path to the network data repository root
 *                          (contains network.yaml, org.yaml, groups/, sites/).
 * @param siteDomain      - Domain slug of the site to build (e.g. "coolnews.dev").
 */
export async function buildSite(
  networkDataPath: string,
  siteDomain: string,
): Promise<void> {
  const startTime = Date.now();
  console.log(`[build-site] Building site: ${siteDomain}`);

  // ---- 1. Read and validate network manifest ----

  const networkPath = join(networkDataPath, "network.yaml");
  const network = await readYaml<NetworkManifest>(networkPath);

  if (!network.platform_version) {
    throw new Error("network.yaml is missing required field: platform_version");
  }
  console.log(
    `[build-site] Platform version: ${network.platform_version}`,
  );

  // ---- 2. Resolve full configuration ----

  const resolvedConfig = await resolveConfig(networkDataPath, siteDomain);
  console.log(
    `[build-site] Config resolved for "${resolvedConfig.site_name}" (group: ${resolvedConfig.group})`,
  );

  // ---- 3. Check active flag ----

  if (!resolvedConfig.active) {
    console.log(
      `[build-site] Site "${siteDomain}" is inactive — writing maintenance page only.`,
    );
    const publicDir = join(process.cwd(), "public");
    await writeFileWithDir(join(publicDir, "index.html"), MAINTENANCE_HTML);
    return;
  }

  // ---- 4. Generate ads.txt ----

  const adsTxtContent = generateAdsTxt(resolvedConfig);
  const adsTxtPath = join(process.cwd(), "public", "ads.txt");
  await writeFileWithDir(adsTxtPath, adsTxtContent);
  console.log(
    `[build-site] Wrote ads.txt (${resolvedConfig.ads_txt.length} entries)`,
  );

  // ---- 4a. Link site assets ----

  await setupAssets(networkDataPath, siteDomain);

  // ---- 5. Inject shared legal pages ----

  const sharedPagesDir = join(__dirname, "..", "shared-pages");
  const pagesOutputDir = join(process.cwd(), "src", "pages");

  await injectSharedPages(resolvedConfig, sharedPagesDir, pagesOutputDir);

  // ---- 6. Summary ----

  const elapsed = Date.now() - startTime;
  console.log(
    `[build-site] Build preparation complete for "${siteDomain}" in ${elapsed}ms`,
  );
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * When executed directly (e.g. `node scripts/build-site.js`), reads
 * SITE_DOMAIN and NETWORK_DATA_PATH from environment variables.
 */
async function main(): Promise<void> {
  const siteDomain = process.env["SITE_DOMAIN"];
  const networkDataPath = process.env["NETWORK_DATA_PATH"];

  if (!siteDomain) {
    console.error("Error: SITE_DOMAIN environment variable is required.");
    process.exit(1);
  }

  if (!networkDataPath) {
    console.error(
      "Error: NETWORK_DATA_PATH environment variable is required.",
    );
    process.exit(1);
  }

  try {
    await buildSite(networkDataPath, siteDomain);
  } catch (err: unknown) {
    console.error("[build-site] Build failed:", err);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  void main();
}
