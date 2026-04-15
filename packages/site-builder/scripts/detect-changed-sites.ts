/**
 * Changed-site detection for CI/CD pipelines.
 *
 * Determines whether a given site needs to be rebuilt based on which files
 * changed in the most recent commit. This allows the build matrix to skip
 * sites whose configuration has not been touched.
 *
 * NOTE on the monetization layer: changes inside `monetization/<id>.yaml`
 * intentionally do NOT trigger any Astro site rebuilds. They only trigger
 * the CDN JSON pipeline (see `generate-monetization-json.ts`) because the
 * static HTML carries no monetization-specific elements — `ad-loader.js`
 * picks up the new config from the regenerated CDN JSON within the cache
 * window. Use {@link affectedSitesForMonetizationChange} to enumerate
 * which sites need their CDN JSON regenerated.
 */

import { execSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Return the list of files changed in the most recent commit by running
 * `git diff --name-only HEAD~1`.
 *
 * If there is no previous commit (e.g. the very first commit in a repo),
 * returns `["*"]` as a sentinel value meaning "everything changed".
 *
 * @returns An array of changed file paths relative to the repo root, or
 *          `["*"]` when the diff cannot be computed.
 */
export function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD~1", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    // Most likely there is no HEAD~1 (first commit).  Signal that everything
    // should be rebuilt.
    return ["*"];
  }
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

const MONETIZATION_FILE_REGEX = /^monetization\/[^/]+\.yaml$/;

/**
 * Decide whether a site needs rebuilding based on which files changed.
 *
 * Rebuild rules:
 *  - Any file inside `sites/{siteDomain}/`          -> YES
 *  - `org.yaml` changed                             -> YES (affects all sites)
 *  - `network.yaml` changed                         -> YES (platform version)
 *  - `groups/{siteGroup}.yaml` changed              -> YES
 *  - The sentinel value `"*"` is in the list        -> YES (first commit)
 *  - `monetization/*.yaml` changed                  -> NO (CDN JSON only,
 *                                                      no static HTML rebuild)
 *  - Changes only in other sites' directories       -> NO
 *
 * @param siteDomain  - The domain slug for the site (e.g. "coolnews.dev").
 * @param siteGroups  - The group ID(s) the site belongs to. Accepts a single
 *                       string (backward compat) or an array of group IDs.
 * @param changedFiles - List of changed file paths from {@link getChangedFiles}.
 * @returns `true` if the site should be rebuilt.
 */
export function shouldBuildSite(
  siteDomain: string,
  siteGroups: string | string[],
  changedFiles: string[],
): boolean {
  // First-commit sentinel: rebuild everything.
  if (changedFiles.includes("*")) {
    return true;
  }

  const groups = Array.isArray(siteGroups) ? siteGroups : [siteGroups];
  const sitePrefix = `sites/${siteDomain}/`;
  const groupFiles = groups.map((g) => `groups/${g}.yaml`);

  for (const file of changedFiles) {
    // Monetization changes never trigger a site rebuild — they're handled
    // by the runtime ad-loader fetching the updated CDN JSON.
    if (MONETIZATION_FILE_REGEX.test(file)) {
      continue;
    }

    // Direct changes to the site's own directory.
    if (file.startsWith(sitePrefix)) {
      return true;
    }

    // Org-level config affects every site.
    if (file === "org.yaml") {
      return true;
    }

    // Network manifest change (e.g. platform_version bump).
    if (file === "network.yaml") {
      return true;
    }

    // Any group config that this site belongs to.
    if (groupFiles.includes(file)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Monetization JSON regeneration detection
// ---------------------------------------------------------------------------

/**
 * Extract the monetization profile ids touched by the changed file list.
 * Returns `["*"]` when `org.yaml` changed, since `default_monetization`
 * may have been updated and every site that inherited it now needs a
 * fresh CDN JSON.
 */
export function changedMonetizationProfiles(
  changedFiles: string[],
): string[] {
  const ids = new Set<string>();
  let orgChanged = false;

  for (const file of changedFiles) {
    if (file === "org.yaml") {
      orgChanged = true;
      continue;
    }
    const match = MONETIZATION_FILE_REGEX.exec(file);
    if (match) {
      const filename = file.split("/").pop()!;
      ids.add(filename.replace(/\.yaml$/, ""));
    }
  }

  if (orgChanged) return ["*"];
  return [...ids];
}

/**
 * Enumerate which site domains need their CDN monetization JSON regenerated
 * given a set of changed files. Reads each site's `site.yaml` to determine
 * the resolved monetization profile.
 *
 * - `monetization/<id>.yaml` change: every site whose effective profile
 *   resolves to `<id>` (either explicitly or via org default).
 * - `org.yaml` change: every site (default_monetization may have shifted).
 * - `sites/<domain>/site.yaml` change: just that site (its `monetization`
 *   field may have been added/removed/changed).
 *
 * @param networkRepoPath - Absolute path to the network data repo root.
 * @param changedFiles    - List of changed paths from {@link getChangedFiles}.
 */
export async function affectedSitesForMonetizationChange(
  networkRepoPath: string,
  changedFiles: string[],
): Promise<string[]> {
  const profiles = changedMonetizationProfiles(changedFiles);
  const orgChanged = profiles.includes("*");

  // Track which sites had their own site.yaml touched.
  const directlyChangedSites = new Set<string>();
  for (const file of changedFiles) {
    const match = /^sites\/([^/]+)\/site\.yaml$/.exec(file);
    if (match) directlyChangedSites.add(match[1]!);
  }

  // Quick exit: nothing monetization-relevant changed.
  if (
    profiles.length === 0 &&
    directlyChangedSites.size === 0
  ) {
    return [];
  }

  // Read org default_monetization once so we can attribute inherited sites.
  let orgDefault = "";
  try {
    const orgRaw = await readFile(
      join(networkRepoPath, "org.yaml"),
      "utf-8",
    );
    const orgParsed = parseYaml(orgRaw) as { default_monetization?: string } | null;
    orgDefault = orgParsed?.default_monetization ?? "";
  } catch {
    // org.yaml missing — leave default empty
  }

  const sitesDir = join(networkRepoPath, "sites");
  let entries: string[];
  try {
    entries = await readdir(sitesDir);
  } catch {
    return [];
  }

  const affected = new Set<string>();
  for (const entry of entries) {
    const sitePath = join(sitesDir, entry);
    let isDir = false;
    try {
      isDir = (await stat(sitePath)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    if (directlyChangedSites.has(entry) || orgChanged) {
      affected.add(entry);
      continue;
    }

    // Did one of the touched profiles match this site?
    if (profiles.length === 0) continue;

    let siteMonetization = "";
    try {
      const siteRaw = await readFile(
        join(sitePath, "site.yaml"),
        "utf-8",
      );
      const siteParsed = parseYaml(siteRaw) as { monetization?: string } | null;
      siteMonetization = siteParsed?.monetization ?? "";
    } catch {
      continue;
    }

    const effective = siteMonetization || orgDefault;
    if (effective && profiles.includes(effective)) {
      affected.add(entry);
    }
  }

  return [...affected].sort();
}
